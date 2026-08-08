# Terminal stage writes always land a finish time

Authoritative for implement runs: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

`updateStage` applies its patch verbatim, so `patch: { status: "skipped" }` (`v2/src/daemon/pipeline-execution.ts:843`, `:1003`) persists a terminal stage row with `ended_at` null. A finishless terminal stage row is constructible from the store API today, and nothing in the store prevents it.

## Decision ledger

- `updateStage` derives the finish itself: a patch whose `status` is terminal and whose `endedAt` is not a number lands `endedAt = Date.now()`. Rules out auditing the ~6 caller sites, which leaves the next caller free to reintroduce the shape.
- Terminality is the fixed set `succeeded` | `failed` | `interrupted` | `skipped` (`isTerminalStageStatus`), matching the production write vocabulary in `pipeline-stage-dispatch.ts` / `pipeline-execution.ts` and `reconcilePipelines`'s SQL. Rules out "anything that is not `pending` / `running`", which would stamp arbitrary free-form statuses the layer deliberately does not interpret (`updateStage clears a nullable field only when passed explicit null, not when omitted` writes `status: "completed"` as an opaque value).
- A caller-supplied numeric `endedAt` wins; an explicit `endedAt: null` alongside a terminal status is overridden by the stamp. Rules out honoring the explicit clear, which would keep the finishless terminal row constructible.
- Terminal decided-approval statuses are not in the set: `approved` / `rejected` end a gate decision, not a stage run, and get `decided_at` in `02-approval-decided-at.md`. Rules out overloading `ended_at` on gate rows.
- `startedAt` is never synthesized — a stage that failed before start keeps `started_at` null.
- Derivation lives in an exported pure helper (`stageLifecyclePatchWithTerminalFinish(patch, now)`), matching the file's existing exported-predicate style. Rules out inlining it in the SQL builder, where the terminal-vs-approval distinction is untestable in isolation.
- No schema change; `pipeline_stages.ended_at` already exists.

## Prerequisites

- `updateStage` builds its `SET` list from the defined keys of `StageLifecyclePatch` and rejects an empty patch (`v2/src/persistence/state-store.ts`).
- Production stage writes use `running` | `succeeded` | `failed` | `skipped`, and `reconcilePipelines` writes `interrupted` with `ended_at` directly in SQL.
- `reopenFailedPipeline` clears `ended_at` through its own SQL, not through `updateStage`.

## Tasks

- `v2/src/persistence/state-store.ts`, beside the existing exported stage predicates:
  - `const TERMINAL_STAGE_STATUSES: ReadonlySet<string> = new Set(["succeeded", "failed", "interrupted", "skipped"]);` and `export function isTerminalStageStatus(status: string): boolean` returning `TERMINAL_STAGE_STATUSES.has(status)`.
  - `export function stageLifecyclePatchWithTerminalFinish(patch: StageLifecyclePatch, now: number): StageLifecyclePatch` with body, each line kept whole: `if (patch.status === undefined || !isTerminalStageStatus(patch.status)) return patch;` / `if (typeof patch.endedAt === "number") return patch;` / `return { ...patch, endedAt: now };` — the second condition and the final return are mutation anchors.
  - `updateStage` replaces `const patch = args.patch;` with `const patch = stageLifecyclePatchWithTerminalFinish(args.patch, Date.now());`, leaving the empty-patch rejection and SQL builder unchanged.
- Tests — add to `v2/src/persistence/state-store.test.ts`:
  - `updateStage stamps endedAt on a terminal status write`: for each of `succeeded`, `failed`, `interrupted`, `skipped` on its own stage row, patch `{ status }` alone and assert the loaded row has a non-null `endedAt` at or after a captured bound with `startedAt` still null; plus one row whose `startedAt` was set beforehand, asserting the stamp leaves that value untouched. Carries the keystone `// @mutate`.
  - `updateStage leaves endedAt null on a non-terminal status write`: patch `{ status: "awaiting" }` and `{ status: "running" }`, assert `endedAt` stays null. Carries the terminal-set guard `// @mutate`.
  - `updateStage preserves a caller-supplied endedAt on a terminal status write`: patch `{ status: "failed", endedAt: 1_700_000_000_000 }`, assert the stored value is exactly that. Carries the caller-value guard `// @mutate`.
- Update any existing test that asserts a finishless terminal stage row after an `updateStage` write (check `v2/src/daemon/pipeline-execution.test.ts` and `v2/src/daemon/pipeline-stage-dispatch.test.ts` for `patch: { status: "skipped" }` round-trips) to the stamped shape — these are behavior changes this subspec causes, not preservation claims.
- Docs per Documentation updates.
- Run `bun run typecheck`, `bun run check`, `bun run test:v2`, `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage stamps endedAt on a terminal status write` asserts a patch carrying only a terminal `status` lands a non-null `endedAt` for each of `succeeded`, `failed`, `interrupted`, and `skipped`, leaves `startedAt` null on a never-started row, and preserves an already-set `startedAt`; it fails against the pre-fix code, which persists the row finishless.
- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage leaves endedAt null on a non-terminal status write` asserts `awaiting` and `running` writes persist `endedAt` as null, proving the stamp is suppressed off the terminal set.
- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage preserves a caller-supplied endedAt on a terminal status write` asserts the caller's millisecond value survives the write unchanged.
- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage stamps endedAt on a terminal status write`; Keystone checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "return { ...patch, endedAt: now };" -> "return patch;"` inside the test body — baseline semantics where a terminal patch persists finishless — and the mutation turns that regression RED.
- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage leaves endedAt null on a non-terminal status write`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "!isTerminalStageStatus(patch.status)" -> "false"` inside the test body — stamping every status write, including approval and in-flight rows — and the mutation turns that regression RED.
- [ ] `v2/src/persistence/state-store.test.ts` — `updateStage preserves a caller-supplied endedAt on a terminal status write`; Mutation checkpoint: its pinning test carries `// @mutate v2/src/persistence/state-store.ts "typeof patch.endedAt === \"number\"" -> "false"` inside the test body — overwriting the caller's finish time with the write clock — and the mutation turns that regression RED.
- [ ] Existing `updateStage` tests (`updateStage patches the target stage in place, preserving identity and leaving siblings untouched`, `updateStage clears a nullable field only when passed explicit null, not when omitted`, `updateStage rejects an empty patch`, `updateStage rejects a patch whose only fields are undefined`, `updateStage ignores undefined fields alongside a real field, treating undefined as absent`, `updateStage rejects an unknown pipeline or stage target`, `updateStage round-trips millisecond timestamps and a non-null status string across close and reopen`) stay green.
- [ ] `v2/docs/state-store.md` records that `updateStage` derives `ended_at` on a terminal-status write, names the terminal status set, and states that `started_at` is never synthesized.
- [ ] `bun run typecheck`, `bun run check`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` § Schema — the `pipeline_stages` bullet's `status` parenthetical gains the second value set this layer interprets: `succeeded` | `failed` | `interrupted` | `skipped` are terminal for `updateStage`'s `ended_at` derivation.
- `v2/docs/state-store.md` § API — the `updateStage` bullet: a patch with a terminal `status` and no numeric `endedAt` lands `ended_at` at write time (an explicit `null` does not survive); a caller-supplied `endedAt` is preserved; `started_at` is never synthesized, so a stage that failed before start stays terminal with `started_at` null; non-terminal and decided-approval statuses are unaffected.
- `v2/docs/v1-behaviors.md` — record that every terminal stage status write through the store now persists `ended_at`, including `skipped` blocked-suffix rows, and that a finishless terminal stage row is no longer constructible through `updateStage`.
