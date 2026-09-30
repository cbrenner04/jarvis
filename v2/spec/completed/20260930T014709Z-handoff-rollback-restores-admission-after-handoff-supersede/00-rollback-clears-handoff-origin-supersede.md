# Rollback clears handoff-origin supersede and reopens admission

`rollback` in `createHandoffHandlers` (`v2/src/daemon/daemon.ts`) skips `setAdmitting` when `wasSuperseded()` is true. During a pending handoff the successor's own `supersede` sets that flag, so a successful rollback rebind leaves `runControlContext.retiring` true and every new-work RPC answers `daemon_superseded` indefinitely even though the incumbent again owns the stable public listener.

## Decisions

- Rollback on a pending handoff may clear only a `supersede` whose caller identity matches this transaction's own successor (received after `changeover`, before rollback settles) — rules out clearing a genuine external `supersede` arriving in the same pending window (incumbent stays retiring) and rules out clearing every `supersede` on any pending rollback (would erase a pre-`changeover` external retire).
- `supersede` received while no handoff is pending still blocks rollback from reopening admission — rules out clearing an external retire with no active transaction.
- `supersede` received before this transaction's `changeover` still blocks rollback from reopening admission even if a handoff is pending when rollback runs — rules out treating a pre-handoff retire as handoff-origin.
- `tickWatch` on committed handoffs keeps reopening admission unconditionally and does not use `wasSuperseded()` — rules out reintroducing the rollback guard on the committed-successor-watch path fixed in the committed-successor-watch spec.
- Export `createHandoffHandlers` (or an equivalent focused test seam matching `createChangeoverHandler`) for fake-driven unit coverage — rules out relying only on sandbox socket tests to pin the `wasSuperseded` gate.

## Task checklist

- [x] Scope supersede clearing to a `supersede` from the pending transaction's own successor (identity match) in `startDaemonRuntime` / `createHandoffHandlers` wiring.
- [x] Export `createHandoffHandlers` or add a `createChangeoverHandler`-parity focused seam for fake-driven rollback coverage.
- [x] Add a focused handoff-handler unit test with fakes: `changeover` → `supersede` → `handoff_rollback` → assert admission reopens and a subsequent admitted call succeeds.
- [x] Update `rollback` / `tickWatch` inline comments and docblocks in `v2/src/daemon/daemon.ts` to match post-fix admission policy (no pre-fix-only `wasSuperseded()` gating on pending rollback).
- [x] Align `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [x] Exported `createHandoffHandlers` or a `createChangeoverHandler`-parity focused seam exists so the regression below can run without sandbox sockets (structure is the contract).
- [x] A focused handoff-handler regression with fakes drives changeover → `supersede` → rollback and asserts `retiring` is false and a subsequent start is admitted; it fails against the pre-fix code.
- [x] A focused fake-driven regression drives changeover → `supersede` from a non-successor peer → rollback and asserts `retiring` stays true and new work answers `daemon_superseded`.
- [x] `rollback` / `tickWatch` comments and docblocks in `v2/src/daemon/daemon.ts` describe post-fix admission policy, not pre-fix `wasSuperseded()` skip-on-rollback behavior.
- [x] `v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` "rollback after supersede rebinds the public listener but leaves the incumbent non-admitting" stays green (supersede before the pending handoff still blocks rollback admission reopen).
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.
- [x] `bun run test:integration:v2` passes.

## Documentation updates

- [x] `v2/docs/daemon-host.md` § Handoff changeover at the public address — rollback on a pending handoff reopens admission after a successful rebind even when the handoff successor already called `supersede`; supersede before or outside that transaction still blocks reopen.
- [x] `v2/docs/operator-runbook.md` § Daemon lifecycle — sole daemon answering `daemon_superseded` after `Self-handoff failed` when rollback should have restored admission; `jarvis daemon start` as manual fallback.
- [x] `v2/docs/v1-behaviors.md` — update the `[v2-only]` handoff-transaction bullet to record rollback reopening admission after handoff-origin `supersede`.
