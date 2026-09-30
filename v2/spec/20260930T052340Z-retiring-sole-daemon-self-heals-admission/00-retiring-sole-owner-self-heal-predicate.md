# Retiring sole-owner self-heal predicate

`startDaemonRuntime` skips every self-handoff sampling tick while `isRetiring()` (`v2/src/daemon/daemon.ts`), so a generation that still owns the public listener but never cleared `retiring` never reaches digest sampling or backoff retry. The fix needs a testable gate for when that stranded shape may reopen admission without a process restart.

## Decisions

- Export one pure predicate beside the other stable-digest guards in `v2/src/daemon/stable-digest-trigger.ts` — rules out embedding the condition only in the `setInterval` callback (not unit-testable without a real timer) and rules out a daemon-only helper that duplicates the stable-digest module's predicate home.
- Predicate is `retiring && publicBound && !handoffPending && !blocksRollbackReopen && retireCause === "handoff_origin"` — rules out self-heal while a handoff transaction is open, while the public listener is released, while a genuine external `supersede` must keep the generation retiring, and for any non-handoff retire.
- No public liveness probe conjunct: while this process holds the public listener (`publicBound`) and no handoff is pending, no successor can be serving the public address — rules out `probePublicServer` / `daemonAnswersAt` (a health RPC the bound incumbent answers itself, making the predicate dead in production) and any probe-based liveness.
- Inputs are in-process state only, so there is no inconclusive path — rules out a tri-state / timeout branch.
- Add an explicit recorded `retireCause: "handoff_origin" | "terminal" | null` in `daemon.ts` runtime state beside `firstRetireTrigger`: `changeover` sets `handoff_origin` when null; operator `shutdown`/`sigterm`/`sigint`, a `supersede` that sets `blocksRollbackReopen`, and handoff commit set `terminal`, which is sticky — rules out deriving cause from `firstRetireTrigger` (it cannot tell successor-origin from external `supersede`), rules out self-heal after operator stop or non-successor supersede, and rules out self-heal after a committed handoff (a successor owns the address; the incumbent must not rebind or reopen).
- A `supersede` whose `handoffId` matched a now-finished transaction (`pendingHandoffId` undefined) is blocking: `recordSupersedeForRollbackAdmission` already sets `blocksRollbackReopen`, and cause becomes `terminal` — rules out reopening on a stale successor id.
- Predicate inputs are plain values passed from wiring — rules out hiding IPC or probe calls inside the predicate.

- `retireCause` resets to `null` wherever admission reopens (`setAdmitting` after a successful rebind, rollback, or self-heal), so a daemon that reopened after a committed-handoff watch rebind can self-heal a later failed handoff — rules out a sticky `terminal` permanently barring future self-heal.

## Task checklist

- [ ] Add `retireCause` recording at each retire trigger / supersede / handoff commit site.
- [ ] Add the exported predicate and document the non-obvious rollback-block conjunct in a one-line doc-comment only if name + parameters are insufficient.
- [ ] Extend `stable-digest-trigger.test.ts` with truth and falsity cases for each conjunct and one fully true case.
- [ ] Unit-test `retireCause` transitions via handler fakes (`createSupersedeHandler`, handoff handlers, signal/shutdown recorders) with injected state only.

## Acceptance criteria

- [ ] A test proves `retireCause` returns to `null` when admission reopens after a committed-handoff watch rebind, and a subsequent failed handoff then self-heals.
- [ ] `stable-digest-trigger.test.ts` exercises the exported self-heal predicate in both truth directions (at least one matching case and one case per blocking conjunct, including `retireCause` `terminal` and `null`).
- [ ] Tests with injected state show `retireCause` becomes `terminal` (sticky) after operator stop, non-successor `supersede`, and handoff commit, and stays `handoff_origin` after `changeover` followed by rollback/fallback.
- [ ] A test shows a `supersede` carrying a `handoffId` that matched a now-finished transaction (`pendingHandoffId` undefined) sets `blocksRollbackReopen` and the predicate is false.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None: no operator-visible behavior until [01-stable-digest-sampling-self-heal-wiring.md](01-stable-digest-sampling-self-heal-wiring.md).
