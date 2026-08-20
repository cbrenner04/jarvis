---
name: dismiss-pipeline-rpc
---

# Dismiss Pipeline RPC

## Prerequisites

- A pipeline carries a nullable durable dismissal timestamp that survives reopening the state store, with dismiss/undismiss store operations that leave stage records and derived state untouched.

## Surface

Daemon.

## Problem

- `pipeline_list` projects every stored pipeline unconditionally and there is no request that records an operator's dismissal, so every client repaints abandoned pipelines forever.

## Behavior

- The daemon accepts `pipeline_dismiss` and `pipeline_undismiss` for a known pipeline id, `pipeline_list` omits dismissed pipelines by default, and an explicit opt-in parameter includes them with their dismissal timestamp on the snapshot.

## Decisions

- Default `pipeline_list` to excluding dismissed pipelines, with an opt-in request parameter to include them; rules out returning everything and pushing the default filter onto each client, which would leave the CLI and TUI free to drift.
- Carry `dismissedAt` on the projected pipeline snapshot so opt-in callers can mark and filter rows; rules out an out-of-band second lookup.
- Dismissing a `running` pipeline succeeds and the response reports the pipeline's derived state so the caller can warn; rules out refusing dismissal for live pipelines.
- Both requests are idempotent and refuse an unknown pipeline id with a named error; rules out silent success on a mistyped id.
- Dismissal never touches execution: no stage dispatch, no gate settlement, no ownership change. Rules out reusing the reject/kill path.

## Required verification

- A daemon test dismisses a pipeline and asserts the next default `pipeline_list` omits it while the opt-in call returns it with `dismissedAt` set; it fails against the pre-fix daemon.
- A daemon test asserts `pipeline_undismiss` restores the pipeline to the default listing.
- A daemon test asserts an unknown pipeline id is refused on both requests.
- A daemon test dismisses a running pipeline and asserts its stage records and derived state are unchanged and its execution continues.

## Documentation updates

- `v2/docs/daemon-host.md` — the two requests, the default-excluded `pipeline_list` projection with its opt-in parameter, `dismissedAt` on the snapshot, and that durable state retains dismissed pipelines.
- `v2/docs/v1-behaviors.md` — `pipeline_list` no longer returns every stored pipeline by default.
