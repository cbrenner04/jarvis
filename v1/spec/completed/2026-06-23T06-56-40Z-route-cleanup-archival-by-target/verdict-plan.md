# Verdict

Both High findings are valid and block implementation-readiness; the Medium and Low findings are valid as precision/scope clarifications. Required refinements:

## Required (blocking)

1. **Pin cross-home routing for *timestamped* specs, with a cited test.** The real archival path resolves a plan spec via the timestamp-prefix scan of its home directory (`<home>/<timestamp>-<name>/` off branch `plan/<name>`), not exact-name match. The current ACs and the single timestamped test exercise only `targetDir == matched home`, so an exact-name-only probe could satisfy every literal AC while breaking every real (timestamped) spec. Add an acceptance criterion for a **timestamped v2 spec archiving to `v2/spec/completed/` while configured `targetDir` is `v1/spec`**, and write it as a citation to the new pinning test rather than paraphrased behavior (per the catalog's "cite the test, don't paraphrase" rule for behavior contracts). The task checklist's "cover the new routing" must point at this specific cross-home timestamped case.

2. **Pin how multi-home probing composes with the two-tier (exact → timestamped) resolution.** "Probe candidate homes, first match wins" is underspecified against the per-home exact-then-scan resolver: when a matching directory could exist in more than one home, the result is ambiguous. Add a decision fixing the order — resolve each home fully (exact then timestamped) before advancing to the next, iterating in configured-`targetDir`, `v1/spec`, `v2/spec` order. This makes the v1-favoring/mixed→v1 guarantee deterministic rather than incidental.

## Required (clarifications)

3. **Correct the `v2/docs/v1-behaviors.md` doc-update instruction.** No `cleanup` archival-destination entry exists today (the only `cleanup` bullet records `--dry-run` and the registration-error exit). Reword the Documentation-updates line from "update the entry" to "add a `cleanup` bullet recording by-home archival routing," and require it to end with the catalog-mandated `Sources:` citation (`v1/src/commands/cleanup.ts`). AC #7's additive wording is already correct; only the prose needs aligning.

4. **Name the coincidental-home risk and bound it.** Hardcoded `v1/spec`/`v2/spec` probes are a new behavior change for non-jarvis projects: a target repo with a coincidental `v1/spec/` directory containing a name-matching spec dir would newly be probed/mis-routed. The "homes are absent" reasoning is a disk-layout assumption, not a guarantee. Add a decision entry naming this risk (gating to the jarvis project is the rejected heavier alternative, acceptable given single-operator scope) and an AC asserting a default-`spec` project with a coincidental `v1/spec/` is not mis-routed.

5. **State the total-miss behavior under multi-home probing.** Specify what the missing-source message names when no home matches (e.g., retains the configured-`targetDir` path), so it isn't left to the implementer.

6. **Acknowledge the in-flight pre-flip gap.** A spec authored under the old plain-`spec/` layout that completes after this ships falls outside the probe set and hits the benign missing-source path (silently unarchived). Migration is correctly out of scope; one sentence noting the operator archives that transitional spec manually keeps the reader from assuming full coverage.

## Rationale

Findings 1–2 are where this spec's correctness actually lives: the headline behavior ("v2 spec archives to `v2/spec/completed/` despite `targetDir: v1/spec`") only works if the timestamped-scan path and probe ordering are specified and pinned by a test — otherwise the spec passes review while broken on every real spec. Findings 3–6 close precision gaps the intent's guarantees lean on (mixed→v1 determinism, default-`spec` non-regression, no silent loss) without expanding scope. The core design — routing by authored home rather than git-diff classification, transitive mixed→v1, flip-independent probing — is sound and needs no change.