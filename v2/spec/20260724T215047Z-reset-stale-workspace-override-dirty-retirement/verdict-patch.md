Verifying implementation details cited in the review before issuing the verdict.
## Verdict: required outcomes

1. **Listing-failure refusal copy**  
   When `resetStaleWorkspace` refuses because porcelain listing failed (`could not list worktree changes`), operator-facing `reason` / workflow stderr must **not** present `--reset-despite-dirty` as a viable recovery step. Dirty-worktree refusals must still name commit, discard, `--reset-despite-dirty`, and `jarvis cleanup --abandon <branch>` as today.  
   **Why:** The subspec and durable docs (`operator-runbook`, `v1-behaviors`) state the override skips only the dirty gate; listing failure stays fail-closed even with the flag. Reusing the dirty recovery blob on the error path tells operators to retry with a switch that cannot succeed.

2. **Help text for `--reset-despite-dirty`**  
   The pinned implement/plan workflow flag description must state that porcelain or listing errors still refuse (same rule as runbook), not only “retire when dirty.”  
   **Why:** This slice pins flag name and help; normative behavior is already documented elsewhere—help should not understate the listing-error limit.

---

**Not required for merge (no actuator action):**

- Positive override workflow test vs `cleanup.test.ts` teardown stdout/`status` parity — workflow layer matches the existing clean stale-reset test; seam tests own `resetStaleWorkspace` outcomes.
- Guard inversion without override — covered by workflow teardown mocks + worktree list and by `cleanup.test.ts` dirty refusal tests.
- Plan-only workflow regression — explicit subspec tradeoff (shared seam, one implement workflow AC).
- Override on paths where stale reset does not run — in scope to ignore silently; no AC.
- `skipDirtyWorktreeGate` / duck-typing on `parsed` — maintainability only; behavior is tested (listing error + override still refuses).
- Assert override token on unparseable-porcelain refusal — AC names tracked and untracked tests only; shared recovery already includes the flag; extra assertion is optional hardening.
- Unparseable porcelain + override allowing retirement without path detail — matches “skip dirty refusal only”; line is `error` (git threw), not empty `paths`.
- Combo dirty + live-held/PR with override — out of scope; gate order unchanged.