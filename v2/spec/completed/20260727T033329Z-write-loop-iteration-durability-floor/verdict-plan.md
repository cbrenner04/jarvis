1. Split the oversized subspec into independently testable serial slices for settled-result checkpoints, controlled-loss checkpoints, and ready-repair checkpoints if included. Preserve every original task and acceptance outcome exactly once across the replacements, and link every replacement from `index.md`.

2. Define controlled-loss durability only after the interrupted invocation can no longer mutate the worktree. Require regression evidence that agent-written paths are committed and that no late writes remain dirty after abort/watchdog settlement. Abrupt process death may remain explicitly excluded.

3. Resolve the kill-versus-abort contract. State whether durability is guaranteed at daemon kill acknowledgment or only after write-loop settlement, then align test names and coverage with that promise. A direct abort test is sufficient only for an eventual-settlement guarantee.

4. Define attribution for checkpoints created without a settled invocation result, including fallback attempts. Require coverage proving the interrupted attempt receives the correct commit title and `Jarvis-Agent:` attribution.

5. Specify checkpoint-failure precedence for terminal outcomes, watchdog expiry, and already-persisted kill state: which outcome remains authoritative, which boundary is persisted, whether publication occurs, and what resume must do. The current requirements to preserve real outcomes while reusing a progress-specific failure result are contradictory.

6. Pin all result classes covered by “every git-backed settled iteration,” not only `done`. Coverage must include terminal and failure-like results, including the motivating `idle_output_timeout`. Also decide whether harness mutations made before the boundary, such as a contract-miss blocker append, belong in that checkpoint.

7. Require observable ordering at each boundary: settled checkpoints before `boundary_committed`, watchdog checkpoints before timeout settlement, and abort checkpoints before loop settlement. Checkpoint-before-completion-commit alone does not establish the intended durability boundary.

8. Decide explicitly whether ready-repair iterations receive the same durability floor. If included, require focused settled/loss coverage; if excluded, narrow the runtime and documentation guarantees accordingly.

9. Strengthen the real-git regression beyond a non-empty `base..HEAD` list: verify the agent-written paths and contents are present in the committed tree and absent from the post-quiescence dirty worktree.

10. Tie every newly eligible trigger—settled outcomes, abort, watchdog, and ready-repair if included—to a named regression that turns red when that trigger is disabled or inverted. Keep the existing progress-path ordering, skip classifications, fail-closed behavior, and terminal publication semantics pinned as preservation criteria.
