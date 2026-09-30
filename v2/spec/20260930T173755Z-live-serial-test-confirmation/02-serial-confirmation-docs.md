# 02 — Operator and catalog documentation

## Problem

Operator docs do not name a live-roster serial confirmation command, so hand recovery falls back to bare `bun test`. Catalog docs still describe jarvis-specific serial retry as bare `bun test`.

## Decisions

- Document two layers when a ready or scoped gate fails: the harness may already rerun the same pooled `test:*` step once; hand confirmation afterward is `bun run test:confirm:live` (aggregate live roster, per-file serial, no `v1/`) before treating the failure as real or chasing flakes — rules out reading recovery as if confirmation replaces or duplicates ready retry.
- Document `bun run test:confirm:live` for operator/agent hand recovery after a scoped `test:*` or ready test-step failure; state explicitly that frozen `v1/` is never part of confirmation — rules out implying bare `bun test` is equivalent.
- `v2/docs/test-writing.md` contrasts scoped `test:*` gates (fast, surface-scoped) with `test:confirm:live` (full live aggregate including integration, serial, no `v1/`); mid-work use follows existing sandbox/integration policy — not a scoped gate substitute and not harness finalization integration — rules out duplicating full roster mechanics at the runner and rules out implicit integration policy after subspec 01 moves agents to this command.
- `v2/docs/v1-behaviors.md` updates only the agent mid-work serial retry and implement-rules migration catalog bullets that still cite bare `bun test` for jarvis-repo confirmation — rules out rewriting unrelated v1 parity entries (e.g. ready-gate retry semantics) in this subspec.
- Ready-gate / `scripts/ready.ts` serial retry behavior is not changed in this spec; doc edits must not claim the ready gate already invokes `test:confirm:live` — rules out false catalog statements reachable on main today.

## Tasks

- [ ] Update `v2/docs/operator-practices.md` gate-failure / recovery workflow with harness pooled retry versus hand `bun run test:confirm:live`, and `v1/` exclusion.
- [ ] Update `v2/docs/operator-runbook.md` recovery sections that describe confirming test failures (e.g. manual gate reruns) with the same two-layer contrast, command, and exclusion.
- [ ] Update `v2/docs/test-writing.md` with when to use `test:confirm:live` versus scoped gates, full aggregate including integration, serial execution, and mid-work sandbox/integration policy.
- [ ] Update `v2/docs/v1-behaviors.md` agent mid-work serial retry and implement-rules entries to cite `bun run test:confirm:live`.
- [ ] Update `v2/docs/prompts.md` to state jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.

## Acceptance criteria

- [ ] `v2/docs/operator-practices.md` and `v2/docs/operator-runbook.md` distinguish harness pooled `test:*` retry from hand `bun run test:confirm:live`, name the command in gate-failure / recovery workflow, and state it excludes frozen `v1/`.
- [ ] `v2/docs/test-writing.md` names `bun run test:confirm:live`, when to use it versus scoped `test:*` gates, that it runs the full live aggregate including integration serially, and that mid-work use follows existing sandbox/integration policy (not a scoped substitute; not harness finalization integration).
- [ ] `v2/docs/v1-behaviors.md` agent mid-work serial retry and implement-rules catalog entries cite `bun run test:confirm:live`, not bare `bun test`, for jarvis-repo serial confirmation.
- [ ] `v2/docs/prompts.md` states jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.
- [ ] `bun run lint:md` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.

## Documentation updates

- As in tasks (this subspec owns all listed doc paths).
