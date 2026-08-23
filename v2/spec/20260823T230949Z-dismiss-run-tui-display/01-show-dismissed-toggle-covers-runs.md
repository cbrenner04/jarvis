# `D` widens the run `list` request to dismissed runs

## Problem

`refreshRuns` already parameterizes one of its two per-daemon requests off the session toggle — `client.pipelineList({ includeDismissed: currentState.showDismissed === true })` — but the run request beside it is still `await client.list()`, and `TuiDaemonClient.list()` takes no parameters at all (`v2/src/tui/tui-daemon-client.ts`). The daemon's `list` handler reads `params?.includeDismissed === true` and excludes dismissed runs otherwise (`v2/src/daemon/daemon.ts`), so pressing `D` reveals dismissed pipelines while dismissed runs stay unfetched: after `00` the projection is willing to paint them and the daemon never sends them.

`v2/docs/operator-runbook.md` § Run dismiss and undismiss still records the pre-fix state — that a dismissed run stops being returned by the default `list` RPC "but the TUI's last-good snapshot merge can keep painting it until the `dismiss-run-tui-display` ready intent lands" — and `v2/docs/v1-behaviors.md` still claims the TUI work tree passes no `includeDismissed`.

## Decision ledger

- `D` and `TuiMonitorState.showDismissed` widen to cover runs; rules out a second key and a second state field, which would let the two halves of one work tree disagree about what is shown.
- The `list` parameter is optional on `TuiDaemonClient`, but every caller now passes an explicit value: `refreshRuns` passes the session toggle, and `resolveOwningSocket` (`tui-log-follow-entry.tsx`) passes `includeDismissed: true` unconditionally, matching `resolveRunOwnerSocket`'s existing precedent for the same owner-lookup problem in `v2/src/commands/run.ts`. Rules out leaving that call parameterless: a dismissed run's `runId` matches no row in a default `list()` result on any socket, so `resolveOwningSocket` finds no owner and `jarvis tui log <dismissed-run>` silently falls back to the invoking socket instead of the run's actual owner.
- The request always carries an explicit `includeDismissed` boolean while the toggle is off; rules out omitting the parameter when off, since the daemon reads `params?.includeDismissed === true` and absent and `false` are identical on the wire.
- `{ includeDismissed: false }` is safe to send unconditionally because `includeDismissed` is not a filter field (`listRpcRequestIsFiltered` in `v2/src/commands/run-list-rpc.ts` ignores it); rules out the concern that a parameterized request diverts the daemon off the fifty-newest-terminal retention path onto the filtered 200-row path.
- With the toggle on, dismissed terminal runs re-enter the same fifty-newest-terminal retention pool as undismissed ones (the daemon's dismissal filter is a no-op once `includeDismissed: true` makes every run pass it, so `retainListedRuns` caps across dismissed and undismissed runs together), so an opt-in refresh can evict an undismissed terminal run's retained slot to make room for a dismissed one. Accepted as bounded, toggle-scoped behavior — it self-corrects the moment `D` toggles back off and the next refresh's default request re-fills the fifty slots from undismissed runs alone — rather than guarded, which would need daemon-side changes out of this subspec's TUI-only scope.
- Toggling off relies on `00`'s projection filter to drop the dismissed rows already retained in `lastGoodListBySocketPath` from the last opt-in response; rules out evicting them from the retained map, which would blank rows the operator can still see until the next successful refresh.
- The existing `toggleShowDismissed` control needs no change: it already flips the flag and calls `refreshRuns()`, which reissues both requests; rules out a run-specific refresh path.
- The toggle stays session-only; rules out persisting an operator preference to config or the state store, which this spec has no consumer for.

## Task checklist

- Give `TuiDaemonClient.list` an optional `{ includeDismissed: boolean }` parameter and forward it into the `list` request frame (`v2/src/tui/tui-daemon-client.ts`).
- Pass `{ includeDismissed: currentState.showDismissed === true }` on the `client.list()` call in `refreshRuns` (`v2/src/tui/tui-entry.tsx`).
- Pass `{ includeDismissed: true }` unconditionally on the `client.list()` call in `resolveOwningSocket` (`v2/src/tui/tui-log-follow-entry.tsx`).
- Add the tests below with their in-body `// @mutate` directives to `v2/src/tui/tui-entry.test.tsx` and `v2/src/tui/tui-log-follow-entry.test.tsx`; extend the entry suite's fake daemon client to record `list` request parameters.
- Update `v2/docs/operator-runbook.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] A TUI entry test asserts that pressing the show-dismissed toggle issues a `list` request carrying `includeDismissed: true`, and that the requests issued before the toggle carry `includeDismissed: false`; it fails against the pre-fix entry, which always issues the parameterless `list` request.
- [ ] A TUI entry test asserts toggling a second time returns to `includeDismissed: false` requests and that the dismissed run leaves the painted work tree again, without any eviction from the retained last-good run lists.
- [ ] A TUI entry test asserts that with the toggle on, the daemon's opt-in run list paints the dismissed run's row in the work tree carrying the `(dismissed)` marker.
- [ ] A TUI entry test asserts the toggle widens both requests of the same refresh: the `list` and the `pipeline_list` request issued after the keystroke both carry `includeDismissed: true`.
- [ ] A fresh monitor session starts with dismissed runs hidden: the first `list` request of a session carries `includeDismissed: false` regardless of any prior session (asserted in the entry tests above; nothing is read from config or the state store).
- [ ] A TUI log-follow entry test asserts `resolveOwningSocket` resolves a dismissed run's owning socket by sending `includeDismissed: true` on its `list()` call regardless of caller display state; it fails against the pre-fix parameterless call, which finds no row for a dismissed run on any socket and silently falls back to the invoking socket.
- [ ] Existing tests in `v2/src/tui/tui-entry.test.tsx`, `v2/src/tui/tui-daemon-client.test.ts`, and `v2/src/tui/tui-log-follow-entry.test.tsx` stay green (the `D` binding, refresh scheduling, retained-list behavior, and undismissed-run owner resolution are unchanged).
- [ ] `v2/src/tui/tui-entry.test.tsx` — `the show-dismissed toggle requests the opt-in run list snapshot`; Keystone checkpoint: an in-body `// @mutate` directive rewriting the parameterized `client.list(...)` call in `refreshRuns` back to the parameterless form restores baseline semantics (the TUI never asks for dismissed runs) and turns this test red.
- [ ] `v2/src/tui/tui-entry.test.tsx` — `a fresh monitor session requests the default run list snapshot`; Mutation checkpoint: an in-body `// @mutate` directive replacing the request's `includeDismissed` expression with a constant `true` makes every default-session request widen and turns this test red — the negative case proving the untoggled session suppresses dismissed runs at the request as well as at the projection.
- [ ] `v2/src/tui/tui-log-follow-entry.test.tsx` — `resolveOwningSocket resolves a dismissed run's owner`; Mutation checkpoint: an in-body `// @mutate` directive rewriting the parameterized `client.list(...)` call in `resolveOwningSocket` back to the parameterless form restores baseline semantics (owner lookup never finds a dismissed run) and turns this test red.
- [ ] `v2/docs/operator-runbook.md` — § Run dismiss and undismiss replaces its stale "the TUI's last-good snapshot merge can keep painting it until the `dismiss-run-tui-display` ready intent lands" sentence with the shipped behavior: dismissed runs are hidden in `jarvis tui` by default (including rows retained from an earlier list result or in flight during a toggle-off refresh), **`D`** in tree focus shows them for this session only by re-requesting `list` with `includeDismissed: true` alongside `pipeline_list`, dismissed run rows paint with the `(dismissed)` marker, **`D`** again hides them without waiting for eviction, the toggle is not persisted, and `jarvis tui log <run>` resolves a dismissed run's owning daemon regardless of the toggle; the § Pipeline dismiss and undismiss description of **`D`** is amended to say the one toggle covers runs and pipelines together.
- [ ] `v2/docs/v1-behaviors.md` — the existing `[v2 behavior change]` daemon-`list` dismissed-exclusion entry's claim that "`jarvis run list` … and the TUI work tree pass no `includeDismissed`" is amended: the TUI multi-daemon merge now passes `includeDismissed` on every `list` request, `true` only while the session's **`D`** show-dismissed toggle is on, that parameter does not divert the request onto the filtered path but does let dismissed terminal runs compete for the fifty-newest-terminal retention slots alongside undismissed ones while the toggle is on, and `resolveOwningSocket` always passes `includeDismissed: true` for log-follow owner resolution independent of the toggle.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — replace the stale ready-intent note in § Run dismiss and undismiss; amend the **`D`** toggle description in § Pipeline dismiss and undismiss to cover runs; note that `jarvis tui log` resolves a dismissed run's owner independent of the toggle.
- `v2/docs/v1-behaviors.md` — amend the daemon-`list` dismissed-exclusion entry for the TUI opt-in, its retention-slot competition while the toggle is on, and the log-follow owner-resolution `includeDismissed: true` call.

## Implementer notes

- Suggested shape, keeping the guard quotable by one single-line `@mutate` directive:

  ```ts
  // tui-daemon-client.ts
  list(params?: { includeDismissed: boolean }): Promise<DaemonListResult>;
  // …
  async list(params) {
    return parseListRuns(await transport.request("list", params)) as DaemonListResult;
  },

  // tui-entry.tsx, in refreshRuns
  const result = await client.list({ includeDismissed: currentState.showDismissed === true });
  ```

  Keeping the parameter optional means the mutated parameterless form still typechecks, so the keystone directive applies cleanly.

  ```ts
  // tui-log-follow-entry.tsx, in resolveOwningSocket
  const result = await client.list({ includeDismissed: true });
  ```

- `currentState.showDismissed === true` will occur twice in `tui-entry.tsx` after this change (the `list` call and the existing `pipelineList` call), so both directives must quote the whole `const result = await client.list(...)` line, which stays unique within that file; `tui-log-follow-entry.tsx`'s `const result = await client.list(...)` line is a separate, independently unique anchor in its own file.
- `refreshRuns` writes each successful result into `lastGoodListBySocketPath` and merges that retained map, so a run listed under the toggle survives in `state.runs` after the toggle flips off; `00`'s projection filter is what hides it again.
- The daemon's `list` handler filters dismissed runs out ahead of retention slicing (`v2/src/daemon/daemon.ts`), but that filter is a no-op once `includeDismissed: true` is set — with the toggle on, `retainListedRuns` runs across dismissed and undismissed terminal runs together, so a dismissed terminal run can consume a retention slot an undismissed one would otherwise have kept. This is bounded to the toggle-on session and self-corrects on the next default-request refresh; see the decision ledger.
