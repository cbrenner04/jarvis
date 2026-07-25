Verifying implementation against spec claims and advocate/adversary points before issuing the verdict.


## Required outcomes

1. **`v2/docs/v1-behaviors.md` — blocked worktree bullet**  
   The bullet that still says `blocked` is **inspect-and-resume** conflicts with post-patch admission and `v2/docs/operator-runbook.md` (`blocked` → `inspect_spec`, `resumable: false`, re-run the workflow; `jarvis run resume` is not the recovery).  
   **Outcome:** Reword that bullet so it does not read as “resume the blocked row” (e.g. inspect-and-**re-run** / resolve blocker and re-dispatch), while keeping the factual worktree-preservation content unchanged.

---

## Not required for this actuator pass (closure rationale)

- **Subspec 00–02 acceptance criteria** are met: finalization precedence, `wait`/entry `list` projection from admission, stale-log demotion, refusal messages with exhaustive recovery map, and targeted tests/docs called out in the subspecs.  
- **`list` `resumable` on non–workflow-entry rows** was not in subspec 01 tasks; ordinary list rows still omit `resumable` as before; the motivating bug was `wait` vs `terminal_run`. Parity for every durable step row is a follow-up only if product wants it.  
- **Workflow-entry `resume(entryId)` when `resumable: true`** is not required by subspec AC; entry projection and existing wait tests cover the scoped contract.  
- **Parent `intent.md` checkboxes** are harness/process relative to subspec AC; no behavior gap if subspecs and durable docs (after item 1) align.  
- **Helper guard-inversion unit test**, **`<prNumber>` interpolation**, and **`invalid_token` / finalization ordering** are out of scope for this spec and do not reopen the reported `terminal_run` vs advertised resumability split.