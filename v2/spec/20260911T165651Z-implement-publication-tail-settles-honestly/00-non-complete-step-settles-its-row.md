# A workflow step that ends non-`complete` settles its own row

## Problem

`executeWorkflow`'s step loop returns on `stepResult.kind !== "complete"` without touching the durable row or the log. When the write loop has already settled that row `completed` — which it does for every workflow write step, because `prepareWorkflowStep` forces `publishCompletion: false` — the row keeps a status that implies PR evidence it does not have, and no record anywhere says otherwise. The daemon then discards the returned result, so the workflow-level verdict is lost too.

## Decisions

- The step loop settles the owning run row before returning a non-`complete` outcome, mapping the outcome kind to a status the same way the write loop's `terminalMapping` does: `blocked` and `contract_miss` settle `blocked`, everything else settles `failed`. Rules out inventing a second status vocabulary for the same outcomes.
- Settlement is skipped when the run id resolves to no row. Routing that fails before any link ran mints a `crypto.randomUUID()` that was never persisted, and settling it would throw inside the step loop. Rules out converting a silent bug into a crash.
- Routing that fails **after** a link's write loop completed reuses that link's real run id instead of minting one. That row exists and is sitting `completed`; an orphaned id would leave the identical lie one branch over. Found by independent review of this change. Rules out fixing only the benign half of the routing-failure path.
- The settled row is not resumable, matching the `inspect_spec` recovery a write-loop-native `contract_miss` over unticked criteria already gets. Re-dispatch is the recovery. Rules out advertising a resume that would re-enter a write loop whose criteria the agent already declined to tick.
- The hidden shrink early return is out of scope and stays unsettled. It replaces the workflow result at the implement step on a different path, and folding it in here would widen the change past the one call site this spec covers. Named in the docs so it is a known gap rather than an oversight.
- Settlement applies **only** to a row currently reading `completed` — the lie this spec exists to correct. Every other status belongs to the write loop and survives untouched. This is load-bearing, not conservatism: `budget-exhausted` and `paused` rows are deliberately non-terminal so the next dispatch resumes the step, and settling them terminal silently destroys resume. Caught by `preserves resume behavior when freshDispatch is absent` while building this. Rules out correcting statuses the write loop owns.
- The failure detail carries the step's `routingFailure` when it has one, else its invocation-failure message, else the outcome kind. Rules out a settled row whose message says nothing an operator can act on.
- The daemon logs the workflow-level verdict when `executeWorkflow` resolves non-`complete`, naming the step index, step id, and detail. Rules out the result being discarded a second time at the daemon boundary.
- Out of scope: keeping a workflow write step's row `in-progress` across the publication tail, and any change to which outcomes the linked-implement finalizers produce.

## Acceptance criteria

- [x] A test in `v2/src/execution/workflow-runner-debate.test.ts` drives a linked implement pass whose agent reports `done` without ticking its subspec criterion, and proves the `implement~link-0` row settles `blocked` with `terminalCause: "contract_miss"` and a failure detail naming `implement.link_incomplete`; it fails against the pre-fix code, where that row is `completed`.
- [x] A test proves a run id that resolves to no row is skipped without throwing, so a routing-failure outcome carrying a never-persisted id still returns its result and its `routingFailure`.
- [x] A test proves that when routing fails after a link's write loop completed, the outcome carries that link's real run id and its row settles `blocked` rather than staying `completed`; it fails against a freshly minted id.
- [x] The existing `preserves resume behavior when freshDispatch is absent` case in `v2/src/execution/workflow-runner-publication.test.ts` stays green: a `budget-exhausted` step row is not settled terminal, so the next invocation still resumes it. This case fails against a settlement that keys on the outcome kind rather than on the row reading `completed`.
- [x] The existing `stops workflow when step ends blocked` case in `v2/src/execution/workflow-runner-core.test.ts` stays green — a write loop that settles its own row honestly is unaffected.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- [x] `v2/docs/workflow-runner.md` — a non-`complete` step result settles the owning row before `executeWorkflow` returns, and what status each outcome kind takes.
- [x] `v2/docs/v1-behaviors.md` — record that a workflow step ending non-`complete` no longer leaves a prematurely-`completed` row.
