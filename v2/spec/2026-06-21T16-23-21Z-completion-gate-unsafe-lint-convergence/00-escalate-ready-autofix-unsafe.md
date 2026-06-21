# Escalate ready auto-fix to check:fix:unsafe

## Problem

The completion gate runs `bun run ready` (full tier): `check:fix` → typecheck → test
→ `check`. Safe `check:fix` cannot resolve `noImplicitAny` / `noExplicitAny` /
unused-var / non-null-assertion findings, so the trailing `check` fails red on
residuals only `check:fix:unsafe` clears. A green spec is then blocked and the
operator hand-finalizes.

Escalate the full-tier auto-fix step to `check:fix:unsafe` so mechanically-fixable
lint converges in-gate. The trailing `check` is retained as the red gate: any
residual or behavior-breaking unsafe edit fails typecheck/test/check, `bun run
ready` exits non-zero, and the existing commit-and-recheck path (`ready-gate.ts`)
leaves nothing committed and the tree red.

## Decisions

- Replace `check:fix` with `check:fix:unsafe` in the full-tier `getReadyCommands` sequence; do not add a second step (unsafe is a superset of safe — a separate safe-then-unsafe pair is redundant churn).
- Keep the trailing `check` step unchanged as the post-fix red gate (rules out trusting unsafe edits without re-validation).
- The change lands in `bun run ready` full tier, so it applies to every full caller (completion gate, plan-mode ready, manual `bun run ready`) — not a gate-only branch (rules out diverging convergence behavior between callers).
- No change to fast tier (it runs neither `check:fix` nor `check`).
- No change to the commit/recheck mechanics in `ready-gate.ts` — it already commits any dirty auto-fix output and re-checks; unsafe output flows through the same path.

## Task checklist

- [ ] Swap `check:fix` → `check:fix:unsafe` in the full-tier branch of `getReadyCommands` (`scripts/ready.ts`).
- [ ] Update `ready-script.test.ts` pipeline-order expectations to the new sequence.
- [ ] Update `v2/docs/v1-behaviors.md` completion-gate and ready-pipeline entries.

## Acceptance criteria

- [ ] `getReadyCommands("full", { runInstall: true })` returns the auto-fix step as `bun run check:fix:unsafe` (not `check:fix`), positioned before typecheck/test/check.
- [ ] The full-tier sequence still ends with `bun run check` as the final step.
- [ ] Fast tier is unchanged (`typecheck` then `test`, no auto-fix, no `check`).
- [ ] `ready-script.test.ts` pipeline-order assertions stay green against the new `["check:fix:unsafe", "typecheck", "test", "check"]` sequence.
- [ ] `ready-gate.test.ts` stays green (commit-and-recheck mechanics unchanged by the command swap).

## Documentation updates

- `v2/docs/v1-behaviors.md` — update the completion-gate entry (`:50`) and ready-pipeline entry (`:368`) to record that the full-tier auto-fix step is `check:fix:unsafe`, that its output is committed and re-checked, and that a still-red tree after escalation stays red.
