# Code review findings — papa-stud

Generated 2026-06-14 from a full read of `src/`, `electron/`, and `static/js/`,
cross-checked against `CHANGES/` and `.claude/rules/` (so nothing here re-proposes
something already deliberately ruled out — chokidar, golden-mtime filtering, Docker).

Ordered by severity. Checkboxes for tracking.

---

## Bugs (high confidence)

- [ ] **1. Dev server binds `0.0.0.0`, contradicting the 127.0.0.1 threat model**
  `src/server.js:15` listens on `0.0.0.0`. The threat model (`.claude/rules/dev_workflow.md`)
  and every CodeQL dismissal assume "server binds 127.0.0.1, no remote attacker". In `npm start`
  (dev) mode this exposes the API to the LAN, including `/api/images` (reads any PNG under project
  roots) and `/api/config/reset`.
  **Fix:** bind `127.0.0.1` in `src/server.js` (Electron already does this in `electron/main.js`).

- [ ] **2. `size=0` query param silently becomes 50 in `GET /api/scans/:id`**
  `src/handler.js:55` — `size: parseInt(size) || 50`. `parseInt('0')` is falsy, so `size=0`
  falls back to 50. The frontend uses `size=0` as a lightweight stats-only check: the watch poll
  in `static/js/review.js` (every 2 s) and `_rescanFromReview` both then transfer 50 full failure
  rows each call. `projects.getScan` itself handles `size=0` correctly.
  **Fix:** parse with `Number.isFinite` so 0 passes through; same for `page`. Add a unit test.

- [ ] **3. Frontend pollers never stop after a job/scan 404s (dead null-guards)**
  `apiGet` *throws* on non-2xx (`static/js/api.js`), so `if (!job)` / `if (!check)` guards are
  unreachable in:
  - `static/js/home.js` `_pollScanJob` — once a job hits the 5-min TTL and is deleted,
    `/api/scan-jobs/:id` 404s → unhandled rejection every 1.5 s forever; Scan button never restored.
  - `static/js/review.js` `_rescanFromReview` — same dead guard; interval is also not registered
    in cleanup, so it survives navigation and hijacks the page when the job completes.
  - `static/js/review.js` `_startWatchPoll` — `if (!check) return` is dead; deleted scan → unhandled
    rejection every 2 s.
  **Fix:** wrap each poll body in try/catch; stop the timer on error (and restore UI). Register
  `_rescanFromReview`'s interval for cleanup; only navigate if the review page is still active.

- [ ] **4. Custom template id can collide with a built-in → shadowed, undeletable template**
  `src/templates.js` `createTemplate` derives the id from the name, so a template named "Paparazzi"
  → id `paparazzi`, colliding with the built-in. `getTemplate` returns the built-in first, the list
  shows a duplicate, and `DELETE /api/templates/paparazzi` 400s. `importTemplates` already guards
  against this; `createTemplate` doesn't.
  **Fix:** reject (400) or suffix colliding ids in `createTemplate`. Add a unit test.

- [ ] **5. Watch mode on swift-snapshot scans wipes xcresult-derived failures**
  `src/scanJobs.js` `startWatching` rescans every module through `processSingleModule` (the
  file-convention path) and never calls the strategy's `parseProjectFailures` (the xcresult path).
  For swift-snapshot (`failures_dir: ''`, no delta prefix/suffix) it walks the whole module tree in
  compare mode, finds ~zero failures, and `updateScanModule` then replaces the real failures with
  that empty list — failures and accept/reject decisions vanish the moment Watch is toggled.
  Conflicts with "rescans preserve user decisions" in `.claude/rules/scanning.md`.
  **Fix:** route watch rescans through the strategy when it defines `parseProjectFailures`, or
  hide/disable Watch for those strategies. Verify against a real swift-snapshot scan.

- [ ] **6. Deleting a project orphans its scans (and re-scan from them breaks)**
  `src/projects.js` `deleteProject` removes the project + xcresult cache but leaves the scan JSON +
  index entry. The home page still lists the scan; Re-scan 404s ("project not found") and
  `_rescanFromReview` (no error handling) sticks at "Scanning…". `POST /api/config/reset` has the
  same gap.
  **Fix:** cascade-delete the project's scans (stop watchers first); clear scans in `/api/config/reset`.
  Add a unit test.

- [ ] **7. `detail.js` `_loadDetail` has no error handling — page stuck on "Loading..."**
  A 404 (stale link) or 500 leaves the detail page on "Loading..." forever — the same half-render
  mode already fixed for the review page (`_renderReviewError`).
  **Fix:** mirror `_renderReviewError` — catch, render an error state with Retry / back links, log.

- [ ] **8. Accept All also overwrites goldens for failures the user explicitly rejected**
  `src/projects.js` `acceptAllBaselines` skips only `status === 'accepted'`, so `rejected` failures
  get their goldens overwritten. Rescans preserve rejections, so clobbering them here is inconsistent.
  **Fix:** skip `rejected` (or report a count + require explicit confirmation). Add a unit test.

---

## Smaller defects

- [ ] **9. Parked `needs_confirmation` jobs expire after only 5 minutes**
  `src/scanJobs.js` applies the same `JOB_TTL` (5 min) to parked jobs. Leaving the compat-mismatch
  `window.confirm` open longer → "job not awaiting confirmation" on OK.
  **Fix:** longer TTL for parked jobs (30–60 min), or reset the clock while the dialog is open.

- [ ] **10. Cancelling scan-from-url doesn't abort the in-flight download; no size cap**
  `src/scanJobs.js` `runFetch` checks `_cancelFn()` only after `downloadToTemp` resolves;
  `src/remoteFetch.js` `downloadToTemp` has no size cap/timeout.
  **Fix:** pass an `AbortController` signal into `fetch`, abort from `cancelJob`; enforce a max size/timeout.

- [ ] **11. Video export tmpdir leaks if the client disconnects mid-stream**
  `src/handler.js` `/api/scans/:id/video` cleans up on `finish`/`error` but not `close`.
  **Fix:** also hook `res.on('close', ...)` (idempotent), or `stream.pipeline` with finally.

- [ ] **12. `_profileEditing` is a global index — edit state leaks across projects**
  `static/js/home.js` keeps a single global `_profileEditing` while `_editingProfiles` is per-project.
  **Fix:** key the editing index by project id, or reset on opening a different project's panel.

- [ ] **13. Status update endpoints accept arbitrary status strings**
  `src/projects.js` `updateFailureStatus` / `batchUpdateStatus` write any string; `computeStats`
  only counts `pending|accepted|rejected`, so junk distorts stats.
  **Fix:** validate against the allowed set in the handlers; 400 otherwise.

- [ ] **14. A corrupt JSON data file breaks every route**
  `src/jsonStore.js` `readJson` throws on bad JSON; `readIndex`/`listProjects` turn that into 500s
  everywhere. Mostly partial files from a crash.
  **Fix:** catch in `readJson`, move the bad file aside (`*.corrupt-<ts>`), log, return `null` so
  callers fall back to empty/rebuild.

- [ ] **15. ffmpeg discovery is Unix-only (and duplicated)**
  `src/video.js` and `src/imageSlice.js` each carry a diverged `findFfmpeg` using `which` +
  Homebrew/`/usr/bin` paths; on Windows ffmpeg is never found.
  **Fix:** extract `src/ffmpeg.js`; probe with `where` on win32 (or `spawnSync('ffmpeg', ['-version'])`).

- [ ] **16. `express.json()` default 100 kB limit can reject large config imports**
  `src/handler.js` `createApp`. A big export can exceed it → 413 surfaced as a generic import error.
  **Fix:** `express.json({ limit: '5mb' })`.

---

## Refactoring

- [ ] **17. Centralize the `'delta-'` default and profile field normalization**
  Repeated across `src/templates.js`, `src/scanner.js`, `static/js/home.js` (incl.
  `f === 'delta_prefix' ? 'delta-' : ''` ternaries).
  **Fix:** one shared constant + a `normalizeProfile()` helper.

- [ ] **18. `junitParser` parses every JUnit XML twice per module**
  `src/scanner.js` `processSingleModule` calls `parseJunitXml` then `parseDiffPercentages`, each
  re-reading + re-parsing the same `TEST-*.xml`.
  **Fix:** single pass in `src/junitParser.js` returning `{ stats, mtime, diffPcts }`.

- [ ] **19. Replace inline `onclick` string-building with event delegation (escaping bug)**
  `static/js/home.js` / `review.js` build `onclick="_fn('${escAttr(x)}')"`. `escAttr`'s `&#39;` is
  HTML-decoded back to `'` before the JS parses, so a quote in a module/template/profile name breaks
  the handler (reachable — module names come from dir names; also injectable in theory).
  **Fix:** event delegation with `data-*` attributes. Needs a screenshot-baseline check.

- [ ] **20. `detail.js` refetches the whole scan (`size=10000`) on every prev/next**
  Each arrow press re-runs `showDetail` → `_loadDetail` → full scan download + parse.
  **Fix:** cache `_detailFailures` keyed by scanId; skip the refetch when only the filename changed.

---

## Optimisation

- [ ] **21. Cache `getScan` reads (mtime-keyed) — hottest path under watch polling**
  `src/projects.js` `getScan` re-reads + `JSON.parse`s the whole scan file every request (2 s watch
  poll + grid loads).
  **Fix:** small mtime-keyed cache; invalidate on write/mtime change.

- [ ] **22. `resolveImagePath` rebuilds the project-root allowlist on every image request**
  `src/handler.js` reads `projects.json` + `realpathSync`s every root per request — ×50 thumbnails
  per grid page.
  **Fix:** cache realpathed roots for a few seconds (or invalidate on project add/delete).

---

## Test coverage

- [ ] **23. Add direct unit tests for untested modules** (all fit the `node:test` + tmpdir pattern)
  - `src/junitParser.js` — stats aggregation, diff-% extraction, malformed XML
  - `src/scanJobs.js` — job lifecycle, cancellation, `needs_confirmation` parking/TTL, tarball-cleanup invariant
  - `src/templates.js` — CRUD, built-in id collision (#4)
  - `src/dataMigration.js` — v1→v2 migration, backups, idempotency
  - `src/video.js` — pure parts (PNG encoder, crc32, overlay dimensions)
  - Regressions once fixed: `size=0` passthrough (#2), delete-project scan cascade (#6),
    Accept-All-skips-rejected (#8)

---

### Suggested first batch

Small, safe, no pixel changes (except #7's error state): **#1, #2, #3, #7**. Then **#5** after
confirming swift-snapshot Watch behavior against a real scan.

> Note: a `gh issue create` script for all 23 (one issue each) is also available — the GitHub
> integration in the originating session lacked Issues:write, so they couldn't be filed directly.
