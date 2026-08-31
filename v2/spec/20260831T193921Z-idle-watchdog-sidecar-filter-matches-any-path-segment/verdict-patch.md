Validating the advocate's central finding against the code and docs before issuing the verdict.
## Verdict

### 1. Workflow staging directories must remain valid idle-watchdog liveness signals (blocker)

The patch correctly implements the subspec, but the subspec’s central example (`.jarvis-plan-stage/plan-body.md` must not re-arm) conflicts with how plan and intent write steps actually work. For those steps, `.jarvis-plan-stage/` and `.jarvis-intent-stage/` are the sanctioned output surfaces (`expectedArtifactPath`), not harness metadata churn. A stdout-silent agent editing only inside those directories previously re-armed the idle timer via worktree activity; after blanket `.jarvis-*` segment ignore, that liveness path is gone and the agent can settle `idle_output_timeout` / `role_stalled` while still productively editing.

**Required outcome:** Idle-watchdog filtering must distinguish harness metadata sidecars (which should not re-arm) from workflow staging directories (which should re-arm when they are the step’s active work surface). Operators must not lose idle protection for silent-but-editing plan/intent agents. If staging dirs are intentionally excluded, that regression must be an explicit, documented product decision with a stated recovery path — not an accidental side effect of aligning with cleanup’s sidecar definition.

### 2. Narrow `verdict-*.md` matching to the real gap (recommended in same pass)

Segment-level `verdict-*.md` matching adds no practical coverage beyond basename matching (existing paths like `review/verdict-adjudicator.md` already worked pre-fix) and could theoretically ignore all activity under a misnamed directory segment. The actual nested miss was `.jarvis-<dir>/…`, not verdict files.

**Required outcome:** `verdict-*.md` ignore rules must not be broader than necessary to fix the nested-path gap. Basename-level verdict matching is sufficient for known verdict artifacts; segment-level matching is only justified for `.jarvis-` when scoped per outcome 1.

### 3. Test coverage must independently prove nested non-sidecar re-arm (hygiene)

Acceptance criterion 2 (nested non-sidecar paths still re-arm) was satisfied by mutating the existing `"worktree activity re-arms the idle timer for a silent child"` test rather than adding dedicated coverage. Two of three sidecar loop cases already passed pre-fix; only `.jarvis-plan-stage/plan-body.md` is a genuine new regression pin.

**Required outcome:** Tests must independently prove (a) nested non-sidecar activity re-arms, (b) nested metadata-sidecar activity does not re-arm, and (c) top-level non-sidecar activity still re-arms — without conflating “stays green” with rewriting the test that was supposed to stay unchanged. After outcome 1, staging-dir paths must have explicit expected behavior under test.

### 4. Operator-facing docs must reflect the resolved liveness model (if behavior changes)

`v2/docs/write-behavior.md` was updated for segment matching, but `v2/docs/operator-runbook.md` still describes sidecar ignore generically and promises that file activity keeps silent-but-editing roles live. Whatever outcome 1 lands must be reflected in all operator-facing idle-watchdog prose touched by this behavior change, not only `write-behavior.md`.

**Required outcome:** Operator docs must accurately state which path shapes re-arm the idle watchdog and which do not, consistent with the implemented filter and staging-dir treatment.

---

**Do not merge as-is.** Outcome 1 is mandatory before this patch can be considered complete; outcomes 2–4 should be addressed in the same actuator pass once the staging-vs-metadata model is decided.