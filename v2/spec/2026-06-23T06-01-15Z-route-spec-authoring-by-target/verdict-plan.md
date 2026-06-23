## Verdict

The spec is structurally sound — routing mechanics, threading sites, validation parity with `jarvis plan`, and subspec doc-ownership boundaries all hold. Four refinements are required; one finding is correctly scoped already.

### Required refinements

1. **State current config reality and sequence the operator flip (subspec 01 + index).**
The jarvis project's live `plan.targetDir` is `v2/spec` today, while `CLAUDE.md` already asserts `v1/spec` — doc and config diverge *now*, independent of this spec. Since subspec 01 rewrites exactly that `CLAUDE.md` section, it must make the docs honest: note that the route-by-target default is realized only after the operator flips the live config, and sequence that flip relative to merge (so the merged docs don't read as fact during a gap). This is a doc-honesty/ordering note only — do not add an AC asserting machine-local config (subspec 01 Decision 2 correctly forbids that). *Rationale:* per spec guidance, merged conventions must describe true state, not aspirational state; the single-operator/jarvis-on-jarvis context makes the divergence window narrow but real.

2. **Pin the no-commit behavior with an AC (subspec 00).**
Decision 3 makes a deliberate behavioral claim — in `commit:false`, `--target-dir` shifts only the `<dir>/wip-intents/` seed-input check while external ready-intent output stays flat at `~/.jarvis/specs/<id>/ready-intents/` — but every existing AC grades only the committed path. A called-out behavior with no AC can silently regress. Add one AC covering this case.

3. **Grade the usage/help string (subspec 00).**
The task checklist adds `--target-dir` to intent usage, but no AC verifies it appears there. Discoverability/parity is part of the stated goal; add an AC asserting the flag surfaces in usage. Fold into the #2 AC pass.

4. **Soften the v1-behaviors.md doc AC wording (subspec 00, optional/nit).**
Intent's flag info is not a single consolidated entry the way plan's is. Reword the doc AC from "update the entries" to "record that intent accepts `--target-dir`" so it doesn't presume a discrete entry that doesn't exist. Non-blocking.

### Confirmed safe (no change)

- **"v1 wins for both-surfaces specs" as prose-only.** This lives correctly in subspec 01's doc AC and index narrative as documentation, never as an asserted `--target-dir` auto-selection mechanism. Framing is correct as-is.