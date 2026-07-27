## Verdict: required refinements

1. **Align `intent.md` with subspec dry-run scope**  
   Narrow intent acceptance criteria and decisions so dry-run parity means **open-home stranded archival** when the owning worktree is in the retire-preview (or actually retired) set—not full-command equivalence across worktree preview, sockets, post-confirm shrink, or eligibility races. Intent must not promise more than the subspec can test.

2. **Pin the regression fixture in tasks or acceptance criteria**  
   The failing-test AC must require a scenario where: a complete spec lives at the **open** spec home (stranded discoverable); pre-retirement stranded inspect **refuses** because a materialized owner still exists; **retirement-path** archival does **not** already move that tree; a single apply pass retires the owner and archives via the **post-retirement stranded** path into `completed/`. Without this, a test can pass by duplicating existing retirement-path coverage.

3. **Resolve the ownership-refusal wording conflict**  
   Decisions say ownership refusal **wording stays unchanged**; acceptance criteria ask for refusal that **names** the materialized owner. Today’s behavior is the stock ownership category message, not a specific worktree path. Rewrite guard-inversion acceptance (and matching intent text) to require **refusal with the existing ownership message** and **no archival while a non-retired materialized owner remains**. Do not expand stdout copy in this spec; note serial dependency on any follow-up that adds richer refusal detail.

4. **Commit on “unknowable preview” or drop it**  
   Decisions promise stdout when preview cannot know post-retirement ownership without applying retirement, but there is no task, test, or acceptance criterion. Either **remove or soften** that decision until a follow-up defines it, or **add** a minimal verifiable outcome (one concrete case with test, or an explicit human-only criterion). Leaving it in decisions without verification lets implementers ignore it.

5. **Document all behavior surfaces the change touches**  
   Add **`v2/docs/write-behavior.md` § Cleanup** (or equivalent CLI contract section) to documentation updates with the same facts as the runbook: post-retirement materialized list for apply stranded ownership; retire-preview-adjusted list for dry-run stranded preview. Spec guidance expects `v1-behaviors.md` for behavior changes; prior cleanup work also used write-behavior—omission risks doc drift.

6. **Bound dry-run / apply parity in decisions**  
   State explicitly that **post-confirm worktree eligibility recheck** and preview/apply races on merged-PR eligibility stay **unchanged** and are **out of scope** for dry-run parity acceptance. Prevents implementers from treating this spec as full dry-run ≡ apply for worktree retirement.

7. **Optional but recommended (not blocking merge if omitted)**  
   - One line on partial retirement: post-retirement materialized list reflects **successful** retirements only.  
   - Idempotency note if retirement and stranded passes target the same open-home identity.  
   - Dry-run must not claim “nothing to clean” when effective stranded inspect would archive after retire-preview adjustment.  
   - A short “related / serial intents” note on shared cleanup refusal stdout seams.

**Rationale:** Core diagnosis (stale pre-retirement `discovered` for stranded ownership) and fix (re-discover after retirement; dry-run uses retire-preview-adjusted materialized set) are sound and match the intent. Gaps are **contract precision**: intent over-promises dry-run scope; regression AC does not exclude the wrong code path; refusal AC contradicts preservation of copy; “unknowable preview” is an unverified second behavior; docs list is incomplete. Spec guidance requires failing tests for behavior change, guard inversion with consistent wording, and behavior-catalog updates—items 1–5 close those holes. **No subspec split required** if item 4 scopes out or verifies the unknowable branch; apply reorder and dry-run adjustment stay one phased change in `runCleanupCommand`.