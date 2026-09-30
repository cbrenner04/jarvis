# Rollback clears handoff-origin supersede and reopens admission

`rollback` in `createHandoffHandlers` (`v2/src/daemon/daemon.ts`) skips `setAdmitting` when `wasSuperseded()` is true. During a pending handoff the successor's own `supersede` sets that flag, so a successful rollback rebind leaves `runControlContext.retiring` true and every new-work RPC answers `daemon_superseded` indefinitely even though the incumbent again owns the stable public listener.

## Decisions

- Rollback on a pending handoff may clear only `supersede` that arrived after this transaction's `changeover` and before rollback settles — covers the handoff successor and any non-successor peer during that same pending window — rules out clearing every `supersede` on any pending rollback (would erase a pre-`changeover` external retire) and rules out never clearing a non-successor peer supersede during the pending window (would leave the incumbent non-admitting after rollback when only that peer set the flag).
- `supersede` received while no handoff is pending still blocks rollback from reopening admission — rules out clearing an external retire with no active transaction.
- `supersede` received before this transaction's `changeover` still blocks rollback from reopening admission even if a handoff is pending when rollback runs — rules out treating a pre-handoff retire as handoff-origin.
- `tickWatch` on committed handoffs keeps reopening admission unconditionally and does not use `wasSuperseded()` — rules out reintroducing the rollback guard on the committed-watch path fixed in the committed-successor-watch spec.
- Export `createHandoffHandlers` (or an equivalent focused test seam matching `createChangeoverHandler`) for fake-driven unit coverage — rules out relying only on sandbox socket tests to pin the `wasSuperseded` gate.

## Task checklist

- [ ] Scope supersede clearing to handoff-origin supersede during the active pending transaction in `startDaemonRuntime` / `createHandoffHandlers` wiring.
- [ ] Export `createHandoffHandlers` or add a `createChangeoverHandler`-parity focused seam for fake-driven rollback coverage.
- [ ] Add a focused handoff-handler unit test with fakes: `changeover` → `supersede` → `handoff_rollback` → assert admission reopens and a subsequent admitted call succeeds.
- [ ] Update `rollback` / `tickWatch` inline comments and docblocks in `v2/src/daemon/daemon.ts` to match post-fix admission policy (no pre-fix-only `wasSuperseded()` gating on pending rollback).
- [ ] Align `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] Exported `createHandoffHandlers` or a `createChangeoverHandler`-parity focused seam exists so the regression below can run without sandbox sockets (structure is the contract).
- [ ] A focused handoff-handler regression with fakes drives changeover → `supersede` → rollback and asserts `retiring` is false and a subsequent start is admitted; it fails against the pre-fix code.
- [ ] `rollback` / `tickWatch` comments and docblocks in `v2/src/daemon/daemon.ts` describe post-fix admission policy, not pre-fix `wasSuperseded()` skip-on-rollback behavior.
- [ ] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` "rollback after supersede rebinds the public listener but leaves the incumbent non-admitting" stays green (supersede before the pending handoff still blocks rollback admission reopen).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- [ ] `v2/docs/daemon-host.md` § Handoff changeover at the public address — rollback on a pending handoff reopens admission after a successful rebind even when the handoff successor already called `supersede`; supersede before or outside that transaction still blocks reopen.
- [ ] `v2/docs/operator-runbook.md` § Daemon lifecycle — sole daemon answering `daemon_superseded` after `Self-handoff failed` when rollback should have restored admission; `jarvis daemon start` as manual fallback.
- [ ] `v2/docs/v1-behaviors.md` — update the `[v2-only]` handoff-transaction bullet to record rollback reopening admission after handoff-origin `supersede`.
