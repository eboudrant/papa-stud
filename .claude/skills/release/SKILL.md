---
name: release
description: Cut a new Papa Stud release by triggering the GitHub release workflow with the next semver-bumped version. Default bump is patch; pass "minor" or "major" to override.
argument-hint: [patch|minor|major]
disable-model-invocation: true
user-invocable: true
---

The user wants to cut a new release. The release workflow lives at `.github/workflows/release.yml` (`workflow_dispatch`, single input `version` like `0.0.11` — no `v` prefix). It builds arm64 + x64, creates a GitHub Release, tags `vX.Y.Z`, and dispatches to the Homebrew tap.

## Steps

### 1. Resolve the bump type

`$ARGUMENTS` is `patch`, `minor`, or `major`. If empty, default to `patch`. If anything else, ask the user.

### 2. Find the current latest version

```
gh release list --limit 1 --json tagName --jq '.[0].tagName'
```

Strip the leading `v`. If that command returns empty, fall back to:

```
git tag --sort=-v:refname | head -1 | sed 's/^v//'
```

If still empty, treat current as `0.0.0` and ask the user to confirm.

### 3. Compute the new version

Parse `MAJOR.MINOR.PATCH` and bump per the rule:
- `patch` → `MAJOR.MINOR.(PATCH+1)`
- `minor` → `MAJOR.(MINOR+1).0`
- `major` → `(MAJOR+1).0.0`

Pre-release / build-metadata suffixes aren't supported by the release workflow today — strip and warn if the current tag has one.

### 4. Verify pre-conditions

- Working tree is clean: `git status --porcelain` must be empty.
- We're on `main` and up to date: `git fetch origin main && git rev-parse HEAD == git rev-parse origin/main`.
- The new tag doesn't already exist: `gh release view "v<NEW>"` should return non-zero.

If any check fails, surface the specific issue and stop. Don't try to fix it implicitly.

### 5. Confirm with the user

Print: current version, new version, bump type. Wait for explicit confirmation. **Never trigger the workflow without it.**

### 6. Trigger the workflow

```
gh workflow run "Release" --ref main -f version=<NEW>
```

(Workflow name in `gh workflow list` is `Release`; ID `258165398` if `--workflow` is preferred.)

### 7. Watch (optional)

The release workflow has three sequential jobs (build × 2 archs → release → update-homebrew) and takes ~10–15 min. Offer to watch:

```
sleep 3 && gh run list --workflow "Release" --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run watch {}
```

Or use `Monitor` to poll `gh run list --workflow "Release" --limit 1` every 60s, exit on `success | failure | cancelled | timed_out`. Always include the failure alternation so a crashed job doesn't look like "still running".

### 8. Post-release

Once the workflow succeeds:
- Verify the release exists: `gh release view "v<NEW>" --json url`.
- Verify the Homebrew tap update PR/commit on `eboudrant/homebrew-tap`.

## Notes

- The workflow updates `package.json` version in-build via `npm version --no-git-tag-version`; **don't** commit a version bump on `main` first.
- The tag is created by the workflow itself; **don't** create it locally.
- Releases require permission to dispatch the `Release` workflow and the `HOMEBREW_TAP_TOKEN` secret to be valid — both already configured.
