# Escalate ready auto-fix to check:fix:unsafe

## Problem

The completion gate runs `bun run ready` (full tier): `check:fix` → typecheck → test
→ `check`. Safe `check:fix` cannot resolve biome findings like `noExplicitAny` /
unused-var / non-null-assertion, so the trailing `check` fails red on residuals only
`check:fix:unsafe` clears. A green spec is then blocked and the operator hand-finalizes.

Escalate the full-tier auto-fix step to `check:fix:unsafe` so mechanically-fixable
lint converges in-gate.

What the trailing `check` does and does not guarantee: `check:fix:unsafe` is biome's
own `--unsafe` autofix, so re-running `check` is satisfied by construction for edits
biome just made — `check` catches *residuals biome could not fix*, not *semantics an
unsafe edit changed*. Only `typecheck`/`test` catch a behavior change, and only on
covered code. The accepted residual risk is therefore an unsafe edit to untested
behavior auto-committed to the worktree immediately before merge (see Decisions for
why convergence-first is accepted over surfacing the residual rule+file).

(`noImplicitAny` is a `tsc` diagnostic caught by `typecheck`, not biome; neither
`check:fix` nor `check:fix:unsafe` clears it, and such a residual stays red regardless
of this change.)

## Decisions

- Replace `check:fix` with `check:fix:unsafe` in the full-tier `getReadyCommands` sequence; do not add a second step (unsafe is a superset of safe — a separate safe-then-unsafe pair is redundant churn).
- Keep the trailing `check` step unchanged (rules out trusting biome's unfixable residuals without re-validation — note `check` does not re-validate the semantics of edits biome itself made; see Problem).
- Accept convergence-first over the alternative of surfacing the exact residual rule+file for the next iteration to fix. The residual risk (unsafe edit to untested behavior committed before merge) is bounded by what `check:fix:unsafe` can touch and is preferable to the operator hand-finalizing a green spec every run (rules out the surface-and-defer design).
- The change lands in `bun run ready` full tier, so it applies to every full caller (completion gate, plan-mode ready, manual `bun run ready`) — not a gate-only branch (rules out diverging convergence behavior between callers).
- No change to fast tier (it runs neither `check:fix` nor `check`).
- No change to the commit/recheck mechanics in `ready-gate.ts` — it already commits any dirty auto-fix output and re-checks; unsafe output flows through the same path.
- Leave the `"chore: apply pre-ready check:fix"` commit message and the `ready-gate.test.ts` names unchanged — slightly imprecise after the swap but renaming them is churn outside this subspec's behavior change (rules out a rename that would touch the gate's commit/test surface for no behavioral gain).

## Task checklist

- [x] Swap `check:fix` → `check:fix:unsafe` in the full-tier branch of `getReadyCommands` (`scripts/ready.ts`).
- [x] Update all affected `ready-script.test.ts` sites: every order assertion plus the source-string guard that matches on the `check:fix` literal.
- [x] Update every `v2/docs/v1-behaviors.md` entry naming the old pipeline (completion-gate `:50`, review-phase baseline `:40`, plan-mode ready `:297`, ready-pipeline `:368`).

## Acceptance criteria

- [x] `getReadyCommands("full", { runInstall: true })` returns the auto-fix step as `bun run check:fix:unsafe` (not `check:fix`), positioned before typecheck/test/check.
- [x] The full-tier sequence still ends with `bun run check` as the final step.
- [x] Fast tier is unchanged (`typecheck` then `test`, no auto-fix, no `check`).
- [x] `ready-script.test.ts` order assertions and the source-string guard stay green against the new `["check:fix:unsafe", "typecheck", "test", "check"]` sequence.
- [x] `ready-gate.test.ts` stays green (commit-and-recheck mechanics unchanged by the command swap).

## Documentation updates

- `v2/docs/v1-behaviors.md` — update every entry that names the old `check:fix` pipeline so the parity baseline stays consistent with the swap:
  - completion-gate entry (`:50`) — full-tier auto-fix step is `check:fix:unsafe`; its output is committed and re-checked; a still-red tree after escalation stays red.
  - review-phase baseline entry (`:40`) — sequence is `install → check:fix:unsafe → typecheck → test → check`.
  - plan-mode ready entry (`:297`) — draft PRs run `bun run ready`, committing any `check:fix:unsafe` output.
  - ready-pipeline entry (`:368`) — order is `install → check:fix:unsafe → typecheck → test → check`; also fix the stale `Sources` attribution (order assertions live in `ready-script.test.ts`, not `test-slices.test.ts`).
