---
name: dismiss-run-rpc
---

# Dismiss Run RPC

## Primary implementation surface

`v2/src/daemon/daemon.ts`

Unsplit rationale: The whole change is the run dismiss/undismiss handlers plus the default-excluding `list` projection on the daemon request module, all backed by the already-landed store operations; there is no second module boundary to split across.

## Prerequisites

- A run carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss run store operations that leave status, attempts, and workflow snapshot untouched.
- The daemon accepts `pipeline_dismiss`/`pipeline_undismiss` and excludes dismissed pipelines from the default `pipeline_list` projection under an `includeDismissed` opt-in, as the request shape to mirror.

## Surface

Daemon.

## Problem

- `list` projects every retained run unconditionally and there is no request that records an operator's dismissal, so every client repaints dead terminal runs until they age out of the terminal-retention window.

## Behavior

- The daemon accepts dismiss and undismiss requests for a known run id, `list` omits dismissed runs by default, and an explicit `includeDismissed` parameter includes them with their dismissal timestamp on the projected run.

## Decisions

- Name the two requests in the unprefixed run-request family alongside `kill`/`pause`/`list`, and reuse the `pipeline_dismiss` params/response shape; rules out a `run_`-prefixed or otherwise bespoke run-dismiss contract that would make operators learn two rules.
- Default `list` to excluding dismissed runs, with `includeDismissed: true` as the opt-in; rules out returning everything and pushing the default filter onto each client, which would leave the CLI and TUI free to drift.
- Apply the dismissal filter independently of the 50-newest-terminal retention window, so dismissing does not consume a retention slot and a dismissed run still resolves by id and under `--since`; rules out implementing dismissal as an early eviction from that window.
- Carry `dismissedAt` on the projected run so opt-in callers can mark and filter rows; rules out an out-of-band second lookup.
- Dismissing a live (non-terminal) run succeeds and the response reports the run's status so the caller can warn; rules out refusing dismissal for live runs.
- Both requests are idempotent and refuse an unknown run id with a named `reason`; rules out silent success on a mistyped id.
- Dismissal never touches execution: no write-loop interruption, no ownership change, no status transition. Rules out reusing the kill path.

## Required verification

- A daemon test dismisses a terminal run and asserts the next default `list` omits it while the `includeDismissed` call returns it with `dismissedAt` set; it fails against the pre-fix daemon.
- A daemon test asserts undismiss restores the run to the default listing.
- A daemon test asserts a dismissed run does not occupy a terminal-retention slot: dismissing one run does not evict a different terminal run from the default listing.
- A daemon test asserts an unknown run id is refused with a named `reason` on both requests.
- A daemon test dismisses a live run and asserts its status is unchanged and it continues executing.

## Documentation updates

- `v2/docs/daemon-host.md` — the two run requests, the default-excluded `list` projection with its `includeDismissed` parameter, `dismissedAt` on the projected run, that dismissal is independent of the terminal-retention window, and parity with `pipeline_list`.
- `v2/docs/v1-behaviors.md` — `list` no longer returns every retained run by default.
