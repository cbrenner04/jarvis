Confirmed: the only new `--target-dir` tests exercise `parseIntentArgs` (parse/validation at lines 468–522); no `intentCommand` invocation anywhere in the suite passes `targetDir`. The end-to-end routing thread has zero coverage.

## Verdict

The spec decisions and implementation logic are correct — flag-first precedence, the shared seed-input check, committed-output/PR/next-steps threading, and the flat external-root behavior in `commit:false` all match the spec. The defect is test coverage: two acceptance criteria are checked as satisfied but assert end-to-end coverage that was never written. Checking an AC whose stated guarantee does not exist lets the threading silently regress and misrepresents completion.

### Required outcomes

1. **End-to-end routing must be tested (subspec 00, final AC).** Add `intentCommand`-level coverage that invokes the command with `--target-dir <dir>` and verifies the override (not project/global `plan.targetDir`) governs the full thread: a file seed is accepted under `<dir>/wip-intents/`, the rejection message for a misplaced seed names the overridden `<dir>`, committed authored intents land under `<dir>/ready-intents/`, and the printed next-steps `jarvis1 plan ...` path references `<dir>/ready-intents/<name>.md`. The existing `parseIntentArgs` cases verify only parse/validation and do not satisfy this AC.

2. **No-commit behavior must be pinned by a test (subspec 00, `commit:false` AC).** Add coverage in `commit:false` mode passing `--target-dir <dir>` that asserts both halves of the deliberate behavioral claim: the seed-input check shifts to `<dir>/wip-intents/`, while external ready-intents remain flat at `~/.jarvis/specs/<id>/ready-intents/` and are *not* nested under `<dir>`. This is the regression guard the AC promises and currently lacks.

3. **Usage-string assertion (minor, fold into the above).** The `--target-dir` flag does appear in intent usage output, so that AC is satisfied by inspection and is not falsely checked. A cheap assertion that the flag surfaces in usage should be folded into the test pass above, but its absence alone is not blocking.

Rationale: the affected ACs are checked `[x]` while the coverage they describe is absent; the implementation is sound, so only the test suite must catch up to what the ACs already claim. No spec or code logic changes are required.