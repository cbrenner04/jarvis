# Claim gate before stale-workspace retirement

## Problem

Incomplete git-enabled `jarvis run workflow implement` or `plan` re-runs call
`resetStaleWorkspace` inside `withConnectDispatch` before daemon `start`. When the
resolved `(project, branch)` is already claimed, retirement can finish and only then
`start` returns `worktree_claimed`, so the guard protects nothing.

## Prerequisites

- The daemon refuses workflow admission with a `worktree_claimed` error when a live run
  holds the `(project, branch)` key.
- `resetStaleWorkspace` runs client-side before workflow dispatch and already refuses on
  live-held, open-PR, and dirty-worktree conditions.

## Decisions

- Consult the same `(project, branch)` claim daemon `start` would refuse before any
  retirement mutation, in the shared `resetStaleWorkspace` pre-mutation block with
  live-held, open-PR, and dirty-worktree gates. Rules out post-retirement-only
  `worktree_claimed` from `start` as the operator recovery signal.
- Pre-mutation claim uses the **same refusal predicate** as daemon workflow admission
  (`handleWorkflowStart` / `worktree_claimed` tests), via shared extraction, dedicated
  RPC, dry-run admission, or an explicitly documented composite — not ad-hoc `list` +
  `isLive` alone (misses queued `isLive: false` and registry-only claims admission
  already rejects). Rules out a probe that passes while `start` would still refuse.
- Gate order inside `resetStaleWorkspace`: existing live-held, then open-PR, then
  claim, then dirty-worktree, then abandonment. Rules out running claim after dirty
  (would surface dirty refusal when both block).
- `resetStaleWorkspace` returns a typed refuse signal for claim (distinct reason/code on
  the reset result); workflow branches on that — not stderr scraping inside cleanup. Claim
  stderr is `worktree_claimed: <message>` (`formatRpcError` parity); other stale-reset
  refusals keep `Cannot re-run incomplete spec: …`. Rules out folding claim into the
  generic wrapper or matching claim text in workflow.
- Wire the connected daemon into `resetStaleWorkspace` from `maybeResetStaleWorkspace`
  (today passes a no-op `DaemonClient`). Rules out a second disconnected claim probe.
- Claim probe **fail-closed** on daemon RPC failure (no retirement without a successful
  claim check). Rules out live-held fail-open parity for this gate.
- Shared seam covers implement and plan; one workflow-level regression on implement,
  direct `resetStaleWorkspace` tests on the seam. Rules out duplicate per-workflow ACs.
- Wedged `in-progress` + `live` rows with no agent activity stay out of scope;
  `ready-intents/every-live-workflow-is-killable` owns that. Rules out changing claim
  liveness semantics here.

## Tasks

- [ ] Extract or invoke the daemon admission claim predicate for the pre-mutation gate;
  thread the connected `DaemonClient` through `maybeResetStaleWorkspace` into
  `resetStaleWorkspace`.
- [ ] Add typed claim refusal on the `resetStaleWorkspace` result; branch in the workflow
  command for `worktree_claimed:` stderr and exit `1` without calling `start`.
- [ ] Add `cleanup.test.ts` coverage: claimed `(project, branch)` refused before
  abandonment, artifacts intact, no retirement subprocess side effects.
- [ ] Add `workflow.test.ts` implement re-run coverage for claimed and claimed+dirty
  (fixtures: pushed remote, open draft PR; claim blocks admission while live-held does
  not fire — e.g. queued/registry-only claim with `isLive: false`).
- [ ] Add guard-inversion coverage via a test-local `DaemonClient` double (unclaimed or
  probe always allows) proving retirement still runs when the gate is not tripped.
- [ ] Update `v2/docs/operator-runbook.md` § Implement workflow and
  `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] `cleanup.test.ts` `resetStaleWorkspace refuses when worktree key is claimed` asserts refuse before abandonment, worktree/local branch/pushed remote/open PR intact, no retirement subprocess calls; fails against pre-fix ordering.
- [ ] `workflow.test.ts` `run workflow implement refuses stale reset when worktree is claimed` asserts exit `1`, stderr `worktree_claimed:` (no `Retirement destroyed artifacts:`), worktree/local branch/pushed remote/open PR intact, no retirement subprocess calls; fixture claims admission without tripping live-held; fails against pre-fix ordering.
- [ ] `workflow.test.ts` `run workflow implement refuses with one pre-mutation error when claimed and dirty` asserts exit `1`, single refusal surface (`worktree_claimed:` only), zero teardown side effects, intact artifacts including pushed remote; fails against pre-fix code.
- [ ] `cleanup.test.ts` `reset removes stale worktree and draft PR before re-run` stays green.
- [ ] Guard inversion: test-local `DaemonClient` double with key unclaimed (or claim probe allowing) still runs stale reset retirement (`cleanup.test.ts` or `workflow.test.ts`); fails when the double is inverted to always refuse claim.

## Documentation updates

- `v2/docs/operator-runbook.md` § Implement workflow — list **pre-mutation** refusals
  before stale retirement: live-held (existing `Cannot re-run incomplete spec:` wrapper)
  and daemon-held `(project, branch)` claim (`worktree_claimed`, artifacts intact). Note
  pre-mutation claim refusal leaves worktree, local/remote branches, and PR untouched
  (contrast post-retirement `start` failure). Revise
  [Workflow reports a stale worktree claim](#workflow-reports-a-stale-worktree-claim) to
  separate: (a) pre-mutation claim refusal, (b) post-retirement `start` failure (bug
  class), (c) claim acquired after retirement but before `start`, (d) guidance when
  partial teardown already happened — not “re-invoke is always safe.” If the client probe
  is stricter than bare post-retirement `start`, document that pre-mutation refusal may
  occur when a later `start` might succeed; acceptable when it prevents destruction.
- `v2/docs/v1-behaviors.md` — extend incomplete implement/plan re-run stale-reset
  refusal list: live-held, open-PR, daemon-held `(project, branch)` claim, dirty
  worktree, then abandonment; cite `resetStaleWorkspace` gate order.
