## Verdict: refinements required before merge

### 1. Pin multi-pass omitted `reviewBehavior` → light

The spec requires omitted `reviewBehavior` to default to `light` for **every** intent run with `passes > 0`, including multi-pass runs. Builder code does this (`reviewBehavior ?? "light"` after the zero-pass gate), but tests only cover single-pass omission and explicit debate. A test must prove that positive `reviewPasses` with omitted behavior selects light review (`behavior: "review"`) with `maxCycles` matching the pass count—not debate.

**Why:** This is the widest semantic shift in the spec (replacing the old `?? "debate"` fallback everywhere on intent). Without a multi-pass pin, the decision is only partially verified and could regress unnoticed.

### 2. Finish `v1-behaviors.md` cross-section alignment

Overview (lines 10–12) and the intent review bullet (line 193) are correct, but other sections still contradict the consolidation:

- **Alias defaults (lines 15–17):** Legacy-alias text still reads as if `intent-reviewed` carries a distinct one-light default separate from bare `intent`. After collapse, both are behaviorally identical; only CLI alias injection and migration hint differ.
- **Preset cardinality (line 284):** Wording that `intent` “retains its exact cardinality” is accurate for preset resolution (one authored write step) but reads as if bare `intent` is still a single runtime step end-to-end. Clarify preset write-step cardinality vs builder-appended review.
- **Reviewed-intent builder (line 287):** Still frames reviewed-intent in isolation without noting bare `intent` now defaults to review-on with the same builder path.

**Why:** The subspec scope and documentation AC require cross-section consistency within `v1-behaviors.md`, not only the overview and one bullet. Remaining lines mislead operators about alias redundancy and default runtime shape.

### 3. Restore preset-cardinality maintainability guidance

`workflow-runner.test.ts` `"retains exact cardinality for intent preset"` is still correct—it validates `resolveWorkflowPreset("intent")` requires exactly one **authored write** step, not total runtime step count. The removed in-code comment that explained this distinction (preset length 1 vs builder-appended review) should be restored or replaced with equivalent guidance (e.g., pointer to `workflow-runner.md`).

**Why:** Without this, future readers may “fix” the test to expect two steps and break preset resolution. The spec AC wording implying the test was updated for “default two-step intent” oversells what changed; the test body is fine—the missing explanation is not.

---

**Not required for this merge** (valid follow-up, not blockers):

- `first-workflow-walkthrough.md` still describes split-only `intent` and zero default passes—operator-facing debt, but outside this subspec’s named documentation AC.
- `intent-reviewed` migration hint still suggests `--review-passes 1 --review-behavior light` when bare `intent` suffices—explicitly deferred in the verdict-plan.
- Intent debate path without `landing` is pre-existing asymmetry, not introduced by this change.
- Optional editorial refresh of operator-runbook troubleshooting lead (lines 53–58); breaking-change posture and `--review-passes 0` opt-out are already documented elsewhere in that file.
