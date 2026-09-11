# Bulk terminal-run dismissal in the state store

## Problem

`dismissRun` stamps one known run id. A caller that wants "dismiss everything terminal in this project" must list runs, reproduce `isTerminalRunStatus`, re-check `dismissed_at`, and re-derive which run rows belong to one workflow invocation — all outside the persistence boundary, and non-atomically.

## Behavior

One new `StateStore` op dismisses, in a single transaction, every currently undismissed terminal run row of an exactly-matching project, including terminal run rows that belong to the same workflow invocation as a matched workflow-entry run, and returns how many rows it newly stamped.

## Decisions

- Project matches the durable `runs.project` value exactly, with no normalization; rules out substring/prefix or path-normalized matching.
- Operate over all durable rows, bypassing any list retention window; rules out inheriting `listRuns`/incident-candidate time filtering, which would silently leave old terminal rows undismissable.
- Expand a matched workflow-entry run to the terminal run rows sharing its `workflowSnapshot.invocationId`, even when those rows would not be matched on their own; rules out leaving orphan step rows visible after their entry run is dismissed.
- Expansion stamps only terminal step rows; a nonterminal sibling of a matched invocation stays undismissed; rules out bulk-dismissing live work through invocation expansion.
- Return the count of rows newly stamped (not rows matched); rules out counting already-dismissed rows and makes a repeat call return `0`.
- First-writer-wins per row, same as `dismissRun`: an already-dismissed row keeps its original `dismissedAt`; rules out re-stamping on repeat calls.
- Single transaction for the whole selection; rules out per-row commits that could leave a partially dismissed selection after a fault.
- Single-ID `dismissRun`/`undismissRun` semantics are untouched; bulk undismiss and bulk pipeline dismissal are out of scope.
- Deferred to first consumer: any selector beyond exact project (branch, spec ref, status subset, time bound) and any richer return shape than the newly-dismissed count — pin when a caller needs it.

## Task checklist

- [ ] Add the bulk dismissal op to the `StateStore` interface and its implementation in `v2/src/persistence/state-store.ts`, scoped by exact project, terminal-status filtered, invocation-expanded, transactional, returning the newly-dismissed count.
- [ ] Add state-store regression tests covering selection scope, invocation expansion, nonterminal preservation, count and idempotence, retention bypass, and column isolation.
- [ ] Document the op in `v2/docs/state-store.md`.

## Acceptance criteria

- [x] A test in `v2/src/persistence/state-store.test.ts` proves one exact-project bulk dismissal stamps every matching terminal run row — including terminal run rows reached only by workflow-invocation expansion from a matched entry run — while another project's rows and every nonterminal row (`in-progress`, `queued`, `paused`, `budget-soft-stopped`, and a nonterminal sibling inside a matched invocation) stay undismissed; it fails against the pre-fix store, which exposes only single-ID `dismissRun`.
- [x] A state-store test proves the op returns the number of rows newly dismissed and that an immediate repeat call returns `0` while every `dismissedAt` from the first call is unchanged.
- [x] A state-store test proves the selection bypasses list retention by dismissing a terminal row whose `finished_at`/`created_at` predates the incident-candidate window, and that only `dismissedAt` changes: `status`, `attemptCount`, `workflowSnapshot`, `finishedAt`, `reconciledAt`, and publication columns are byte-identical before and after, and attempt rows are unchanged.
- [x] `v2/docs/state-store.md` documents the op's exact-project selection, terminal-status filter, workflow-step expansion, atomicity, newly-dismissed count, first-writer-wins stamping, retention bypass, and lifecycle non-interference.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/state-store.md` — bulk terminal selection: exact-project scope, workflow-step expansion, atomicity, count semantics, lifecycle invariants.
