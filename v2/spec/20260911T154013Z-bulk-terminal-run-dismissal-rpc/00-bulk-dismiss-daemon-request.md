# Bulk terminal dismissal on the daemon `dismiss` request

## Problem

`dismiss` in `v2/src/daemon/daemon-run-lifecycle-handlers.ts` reads only `{ runId }`, so no client can reach `StateStore.dismissTerminalRunsForProject` — clearing a project's terminal history takes one `list` plus one RPC per row, and nothing verifies the store's invocation-expansion behavior over the wire.

## Decisions

- The bulk path takes an exact `project` string; no prefix, glob, or multi-project selector — rules out inventing a match grammar the store does not implement. Invocation expansion can still dismiss terminal step rows whose own project differs from the selector, because a matched invocation's terminal siblings are dismissed with it — the selector bounds which invocations match, not which project every dismissed row carries.
- Exactly one of `runId` or `project` must be present; both set, or neither, refuses `invalid_params` before any store call — rules out precedence rules that silently ignore one selector.
- The applied result returns the store's count verbatim as `dismissedCount`; do not recount from `list` — the `list` projection applies retention and would undercount.
- A `project` matching no undismissed terminal rows returns `applied` with `dismissedCount: 0`, not a refusal — rules out inventing a `project_not_found`-style refusal the store's count-returning contract doesn't need.
- Bulk applies carry no `runId` and no `status` — a bulk request names no single row. Deferred to first consumer: `parseRunDismissalOutcome` in `v2/src/commands/run.ts` does not parse this shape yet — do not widen the outcome type or synthesize a `runId` until a caller needs to consume bulk applies.
- `undismiss` keeps its `{ runId }`-only contract; it shares `handleRunDismissalHandler` today, so split the bulk branch into `dismiss` only rather than generalizing both — enforced by the `undismiss { project }` refusal AC below, not just left implicit.
- Blank or non-string `project` refuses `invalid_params`, matching the existing empty-`runId` treatment.
- No `daemon_superseded` guard and no `activeRuns` interaction, unchanged from single-id dismiss.

## Task checklist

- [ ] Parse `runId` / `project` in the `dismiss` handler and enforce the exclusive-selector refusal.
- [ ] Delegate the bulk path to `store.dismissTerminalRunsForProject({ project })` and return the count, including the no-match-returns-zero case.
- [ ] Confirm `undismiss` still parses only `{ runId }` and refuses a `project` selector.
- [ ] Add daemon regression tests for the bulk apply, the no-match case, the competing-selector refusal, and the `undismiss` refusal.
- [ ] Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A daemon test issues `dismiss { project }` against a store holding terminal runs, terminal workflow step rows of a matched entry invocation (including a step row whose own project differs from the selector), and nonterminal rows, and asserts every terminal row and matched step row is dismissed while every nonterminal row keeps a null `dismissedAt`, stays in the default `list` projection, and stays out of `activeRuns`; it fails against the pre-fix `{ runId }`-only handler.
- [ ] A daemon test asserts `dismiss { project }` returns the store-reported `dismissedCount`, including rows the default `list` projection's retention omits, rather than a count derived from `list`; it fails against the pre-fix handler.
- [ ] A daemon test asserts `dismiss { project }` against a project with no matching undismissed terminal rows returns `applied` with `dismissedCount: 0` and mutates no row.
- [ ] A daemon test asserts `dismiss` carrying both `runId` and `project` refuses with `invalid_params` and leaves every row's `dismissedAt` unchanged; it fails against the pre-fix handler, which dismisses the named run.
- [ ] A daemon test asserts `dismiss` carrying neither selector, and `dismiss { project: "" }`, each refuse with `invalid_params`.
- [ ] A daemon test asserts `undismiss { project }` refuses with `invalid_params` and mutates no row.
- [ ] `v2/src/daemon/daemon-run-dismiss.test.ts` stays green (single-id dismiss and undismiss unchanged).
- [ ] `v2/docs/daemon-host.md` documents the `dismiss` bulk selector, exclusive-selector `invalid_params` refusal, the no-match `dismissedCount: 0` outcome, store-owned terminal-only selection stating plainly that a matched invocation's terminal step rows are dismissed even when their own project differs from the selector, and the `dismissedCount` response.
- [ ] `v2/docs/v1-behaviors.md` records the additive bulk `dismiss` request contract.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — `dismiss` row: bulk `project` selector, exclusive-selector validation, no-match `dismissedCount: 0`, terminal-only store delegation (including cross-project sibling step-row dismissal), `dismissedCount`.
- `v2/docs/v1-behaviors.md` — additive bulk daemon `dismiss` contract entry.
