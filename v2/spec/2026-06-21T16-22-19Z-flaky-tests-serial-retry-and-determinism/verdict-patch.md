## Verdict — One required fix, one doc-accuracy fix

### Required

**1. Cover the serial-green operator signal with a test.**
The spec checks an acceptance criterion that serial-green "emits an operator-visible signal that a parallel-load flake was recovered," and the verdict that shaped this spec specifically promoted serial-retry logging to an AC *so it would not go untested*. The shipped serial-retry tests assert only command ordering and the captured exit code — neither verifies any operator-visible log output. A checked AC must be backed by verification. Outcome: the serial-green-recovers test must assert that the gate emits the distinct flake-recovery / serial-retry log signal (the file already swaps `process.stderr.write` and asserts on captured output in its timeout/tier-warning tests, so the seam exists). The serial-green log line should also actually convey recovery semantics, not just "continuing."

### Required (doc accuracy)

**2. Stop the test-writing doc from asserting coverage that does not exist.**
The convention doc states present-tense that the real OS seams (`reap.ts` `listProcesses`/`kill`) "must have test coverage," yet the cited worked example (`reap.test.ts`) is fully DI'd and no marked real-process test exercises those defaults; the `.sandbox-unrunnable` marker appears on no file, and existing `execFileSync`-spawning tests are unmarked. As written the doc reads as a statement of current fact when it is a forward-looking requirement, and a literal reader would conclude the suite already violates the convention. Outcome: reword to a forward requirement (coverage to be added as seams are converted) and explicitly acknowledge that existing unmarked real-process tests predate the convention and are out of scope to convert. This is a small precision edit that keeps the doc honest — no behavior change.

### Not upheld (no action)

- **Deadline-during-serial-rerun:** the serial run reuses the identical `runCommandFn` deadline path with elapsed carried forward; fail-closed holds by construction. The test-coverage AC names only serial-green and serial-red scenarios — a dedicated deadline test is not required.
- **SIGKILL/`-1` classification triggering one serial retry:** the spec's exclusion decision pins SIGINT/SIGTERM and timeout codes explicitly, not all signals. The residual is one wasteful-but-fail-closed retry, consistent with the written spec. A richer `{code, cause}` seam is a reasonable follow-up, not a blocker.
- **Serial re-run doubling worst-case wall-time under one deadline:** this is the spec's intended shared-deadline tradeoff (a fresh budget was explicitly ruled out) and is correctly fail-closed.
- **Serial-green test discriminator readability:** cosmetic; the test is correct.