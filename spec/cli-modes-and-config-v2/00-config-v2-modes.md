# 00 — Config v2: enforced `modes` shape

## Problem

Flat `agentOrder` plus optional `planAgentOrder` forced fallback branches,
duplicate `jarvis config` plumbing, and review churn. The harness should
treat patch and plan as peers under an explicit `modes` object with **no**
implicit defaults between them.

## Decisions

- **`version` is `2`.** Any config with `version !== 2` is rejected at load
  with a clear error pointing at this spec (and at the operator task below).
- **Removed keys (hard error if present):** `agentOrder`, `planAgentOrder`.
  Suggestion text in the error may list the replacement shape.
- **Required object `modes`** with exactly these child keys (names as
  written): `patch` and `plan`. Each value is an object with **required**
  `agentOrder: AgentName[]` (same agent name universe and validation rules as
  today’s `agentOrder`: non-empty, no duplicates, only known agents).
- **No cross-mode fallback.** Code that needs “which agents for plan?” reads
  `modes.plan.agentOrder` only; patch reads `modes.patch.agentOrder` only.
- **Bootstrap / default file.** On first run, the harness may write a **v2**
  config that **explicitly** includes both mode orders (implementation may
  use the same initial sequence for patch and plan so a fresh install runs
  without hand-editing). That is not a “fallback”; it is explicit data on
  disk.
- **No migrator in code.** There is no runtime that rewrites v1 files.

## Operator task (local only)

- **You** (single operator) convert `~/.jarvis/config.json` **once** to v2
  before or immediately after pulling the implementation: set `"version": 2`,
  remove `agentOrder` / `planAgentOrder`, add `modes.patch.agentOrder` and
  `modes.plan.agentOrder` with the lists you want. Keep all other keys the
  implementation still supports. If a key is unknown after implementation,
  follow the load error and adjust.

## Tasks

- [ ] Bump `Config` / validation: `version === 2`, `modes.patch.agentOrder`,
  `modes.plan.agentOrder` as specified; reject legacy keys and v1.
- [ ] Update `DEFAULT_CONFIG` / auto-bootstrap to emit **only** v2 shape.
- [ ] Update every in-repo consumer of `agentOrder` / `planAgentOrder` to the
  new paths (patch loop, plan stubs, factories, tests).
- [ ] Tests: reject v1; reject missing `modes`; reject empty `agentOrder`;
  reject duplicates; happy path load + round-trip.

## Acceptance criteria

- [x] Loading a v1 config or a file containing `agentOrder` or
  `planAgentOrder` fails with a deterministic error.
- [x] A valid v2 config loads; both mode orders are required and validated.
- [x] Bootstrap writes v2 only (no legacy keys).
- [x] `bun run typecheck`, `bun test`, `bun run check` pass.

## Documentation updates

- None in this subspec. Subspec 02 updates `docs/config.md` and cross-refs.
