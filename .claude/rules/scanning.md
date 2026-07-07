# Scanning and watching

Non-obvious behavior of `src/scanner.js` and `src/watcher.js` that bit us in real bugs and shouldn't be undone without thought.

## Watcher: polling, not chokidar

`src/watcher.js` polls directory `mtime`s every `POLL_INTERVAL=5000` ms and rediscovers modules every `DISCOVERY_EVERY_N_TICKS` (~30 s). It does **not** use `chokidar` or `fs.watch`.

**Why:** Gradle monorepos can have 700+ modules × multiple watch dirs each. FD-based watchers blow past macOS' file-descriptor limit (`EMFILE`) and the watch silently dies. Polling has a predictable resource profile (~2k stats / 5 s) and zero FD cost.

**Don't:** Reintroduce chokidar / `fs.watch` without first solving the FD scaling problem and providing a fallback.

## Stale-delta filtering: trust JUnit, not golden mtime

When a tool emits a JUnit XML report and the report says zero failures, **all** delta files in the failures dir are stale leftovers — drop them. Without JUnit, fall back to `mtime` clustering of the deltas themselves (60 s tolerance) to separate the current run's output from earlier runs.

**Don't** filter by comparing each delta's mtime against the corresponding golden's mtime. Roborazzi (and Paparazzi with `recordPaparazzi`) update goldens in the same Gradle invocation that produces deltas, so the goldens are *newer* than the deltas — golden-mtime filtering produces false negatives. This was a real regression; see `CHANGES/2026-04-11_fix-stale-delta-zero-failures.md`.

## Rescans preserve user decisions

When a Watch tick or manual Re-scan re-runs the scanner, `updateScanModule` (in `src/projects.js`) keeps any `accepted` / `rejected` status on a re-detected failure (matched by `filename`). New failures default to `pending`; failures that disappeared go away.

**Don't** rebuild scan failure lists from scratch on rescan — that silently resets every prior accept/reject.

## Result-source per profile

Each profile declares `result_source: 'junit' | 'files'`. JUnit-driven profiles trust the XML's pass/fail summary (e.g. Paparazzi, Compose Screenshot Testing). File-only profiles use mtime clustering alone (legacy fallback for tools without JUnit). Adding a new tool means picking the right `result_source` — don't assume one or the other.

## Overlaying CI artifacts: URL vs uploaded files

Two ways to pull a CI run's `build/` outputs onto a project before scanning, both landing in the same `runScan` after overlay:

- **Scan from URL** (`src/remoteFetch.js`, `scanJobs.startScanFromUrl`): download one `.tar`/`.tar.gz`, extract selected `<module>/build` dirs straight from the tar.
- **Scan from uploaded files** (`src/localArchive.js`, `scanJobs.startScanFromUploads`): accept several `.zip`/`.tar`/`.tar.gz` files (raw-streamed via `POST /api/uploads` → temp file → opaque id), fully extract each to a stage dir, then **merge**.

**Uploads merge + conflict rule:** the same archive-internal path appearing in two archives is fine **iff** the bytes are identical (sha256) — merged silently. Differing bytes is a **conflict**: the job aborts with `status:'failed'` + a `conflicts:[{path, archives}]` list and **writes nothing to the project**. Don't "resolve" conflicts by last-wins; the whole point is that we can't know which delta is authoritative.

**Why full extraction for uploads (not tar member-selection like the URL flow):** we need file contents on disk to hash for conflict detection, it unifies zip+tar behind one pipeline, and it sidesteps the `[bracket]`-glob problem in Paparazzi parameterized names. Overlay copies only `<matchedRoot>/build` subtrees via `fs.cpSync` — never `src/`/goldens. Format is chosen by **magic-byte sniff**, not extension. Zip extraction shells out to `unzip` (macOS + Linux CI have it; Windows does not — zip-on-Windows is out of scope).

The `needs_confirmation` park/resume and per-terminal-state temp cleanup are shared with the URL flow via the kind-aware `confirmScanJob` / `finishJob` in `src/scanJobs.js`.
