# fix: pair swift-snapshot triplets to on-disk goldens via SnapshotTesting description

**Date:** 2026-05-06
**Type:** Fix

## Intent

Real-world iOS projects (e.g. iosui-argo) bundle `__Snapshots__` as Xcode resources, which re-encodes PNGs at build time. The reference attachments inside `.xcresult` are byte-different from their on-disk source goldens — sometimes even with different dimensions — which broke the SHA-256 hash-match introduced in `#85`. With hash-match falling through, the alphabetical-enumeration fallback assigned each row the wrong golden file, and the UI showed an Expected image that had nothing to do with the Actual.

The canonical mapping is right there in the xcresult: SnapshotTesting writes a `Complete Issue Description.txt` per failure containing `@−\n"file:///path/to/golden.png"`. We mine the path off that line. XCTest emits the image triplets in REVERSE manifest order vs the descriptions, so we reverse-zip them.

While there, deleted the now-superseded hash-match path entirely (it was the prior failed fix) — eliminates the eager 17 MB-scale read+SHA on every scan and drops `crypto`, the module-level cache, and the `referencePath` field from the pair shape.

### Prompts summary

1. Reported a wrong Expected image for `testVariants.layouts-right-to-left` after re-running the Hawkins suite
2. Asked to re-run the test (granted xcodebuild + iosui-argo edit permission via settings.json)
3. Diagnosed: bundled `__Snapshots__` resource processing breaks byte-equivalence; hash-match never matches
4. Switched to description-mining + reverse-zip; verified end-to-end on 85 Hawkins failures
5. `/simplify` pass — deleted dead hash-match path

## Changes

### `src/xcresultParser.js`
- New `extractGoldenPathFromDescription()` parses the `@−` line (Unicode minus U+2212; ASCII `-` accepted as a fallback).
- `classifyAttachment()` recognises `Complete Issue Description.txt` as `role: 'description'`.
- `groupManifestByTest()` reads each description txt and stashes the mined path on the item.
- `pairAttachmentsForTest()` collects description paths in manifest order and reverse-zips them onto triplets so each pair carries its canonical `goldenPath`.

### `src/strategies/swift-snapshot.js`
- `bucketFailures()` prefers `pair.goldenPath` over the alphabetical-enum fallback. The hash-match branch, the `_goldenHashCache`, the `hashGoldens()` helper and the `crypto` import are gone.

### Tests
- `tests/node/xcresultParser.test.js` — covers `extractGoldenPathFromDescription`, the new `description` role, the reverse-zip pairing, and the count-mismatch guard.
- `tests/node/swiftSnapshotStrategy.test.js` — covers `pair.goldenPath` precedence; deleted the obsolete hash-match test.

## Files modified

| File | Change |
|------|--------|
| `src/xcresultParser.js` | description-role classification + goldenPath mining + reverse-zip |
| `src/strategies/swift-snapshot.js` | prefer pair.goldenPath; delete hash-match path |
| `tests/node/xcresultParser.test.js` | new tests for description handling and reverse-zip |
| `tests/node/swiftSnapshotStrategy.test.js` | swap hash-match test for goldenPath-precedence test |
