1. Clarify `commit: false` scope in one place. The spec must define whether it bypasses all committed-mode handoffs and runs intent, refine, draft, and review continuously. This is observable workflow behavior.

2. Pin seed interpretation edge cases. Specify how missing path-looking strings are treated, and add coverage for that behavior. File vs inline routing is now the single fresh-plan entry point.

3. Define file-seed frontmatter handling. The spec must say whether existing `name:` is preserved, normalized, or replaced by the intent step.

4. Define seed preservation. “Preserved seed content” must mean either exact recoverability or intentional rewrite; otherwise implementation can satisfy opposite behaviors.

5. Strengthen naming outcomes. Cover invalid/missing names, normalization, branch/worktree collision suffixing, and temp-worktree cleanup if those remain required.

6. Scope PR open/update behavior. State the intended update case so the work does not expand into broad rerun/idempotency semantics.

7. Cover committed `--refine-turns 0` handoff. After `plan: intent`, it should say whether PR opens, exit is `0`, and next steps match the refine handoff.

8. Define legacy synthetic blocker handling on `--resume-draft`. The spec must say whether old generated gate blockers are ignored or treated as genuine blockers.

9. Refine telemetry outcome semantics. Intent success needs a clear value, or `refined` must be explicitly generalized. Failed attempts must specify whether outcome is omitted, nullable, or set.

10. Include telemetry consumer compatibility. If scripts or reports consume plan telemetry, the spec must require compatibility beyond run summaries.

11. Align documentation homes with `v2/docs/documentation-standard.md`. Operator/workflow behavior and design decisions belong in durable `v2/docs/` homes with cross-links, not duplicated ad hoc.

12. Prune decision ledgers. Keep only load-bearing choices that rule out plausible costly alternatives; move implementation tasks out of `## Decisions`.
