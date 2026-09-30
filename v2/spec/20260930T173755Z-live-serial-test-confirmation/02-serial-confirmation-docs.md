# 02 — Operator and catalog documentation

## Problem

Operator docs do not name a live-roster serial confirmation command, so hand recovery falls back to bare `bun test`. Catalog docs still describe jarvis-specific serial retry as bare `bun test`.

## Decisions

- Document two layers when a ready or scoped gate fails: `scripts/ready.ts` already reruns the identical pooled test step once; hand confirmation afterward is `bun run test:confirm:live` (aggregate live roster, serial, never frozen `v1/`) before treating the failure as real — rules out reading confirmation as replacing ready retry or as equivalent to bare `bun test`.
- `v2/docs/test-writing.md` contrasts scoped `test:*` gates (fast, surface-scoped) with `test:confirm:live` (full live aggregate including `*.sandbox-unrunnable.test.ts`, serial); in-sandbox use follows existing integration policy — rules out implying it substitutes for scoped gates or harness finalization integration.
- `v2/docs/v1-behaviors.md` updates only the agent mid-work serial retry and implement-rules migration catalog bullets that still cite bare `bun test` for jarvis-repo confirmation — rules out rewriting unrelated v1 parity entries (e.g. ready-gate retry semantics) in this subspec.
- Ready-gate / `scripts/ready.ts` serial retry behavior is not changed in this spec; doc edits must not claim the ready gate already invokes `test:confirm:live` — rules out false catalog statements reachable on main today.

## Tasks

- [x] Update `v2/docs/operator-practices.md` gate-failure / recovery workflow with harness pooled retry versus hand `bun run test:confirm:live`, and `v1/` exclusion.
- [x] Update `v2/docs/operator-runbook.md` recovery sections that describe confirming test failures (e.g. manual gate reruns) with the same two-layer contrast, command, and exclusion.
- [x] Update `v2/docs/test-writing.md` with when to use `test:confirm:live` versus scoped gates, full aggregate including integration, serial execution, and mid-work sandbox/integration policy.
- [x] Update `v2/docs/v1-behaviors.md` agent mid-work serial retry and implement-rules entries to cite `bun run test:confirm:live`.
- [x] Update `v2/docs/prompts.md` to state jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.

## Acceptance criteria

- [x] `v2/docs/operator-practices.md` and `v2/docs/operator-runbook.md` distinguish harness pooled `test:*` retry from hand `bun run test:confirm:live`, name the command in gate-failure / recovery workflow, and state it excludes frozen `v1/`.
- [x] `v2/docs/test-writing.md` names `bun run test:confirm:live`, when to use it versus scoped `test:*` gates, that it runs the full live aggregate including integration serially, and that mid-work use follows existing sandbox/integration policy (not a scoped substitute; not harness finalization integration).
- [x] `v2/docs/v1-behaviors.md` agent mid-work serial retry and implement-rules catalog entries cite `bun run test:confirm:live`, not bare `bun test`, for jarvis-repo serial confirmation.
- [x] `v2/docs/prompts.md` states jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.
- [x] `bun run lint:md` passes.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes (branch diff includes subspec 00's root tooling).

## Documentation updates

- As in tasks (this subspec owns all listed doc paths).
