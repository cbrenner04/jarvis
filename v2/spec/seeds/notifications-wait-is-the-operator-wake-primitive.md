---
name: notifications-wait-is-the-operator-wake-primitive
---

# Operator notifications have no blocking consumer, so every operator re-invents polling

## Problem

`notificationSinkCommand` derives operator-actionable incidents and spawns a shell command with one JSON incident on stdin, fire-and-forget. That is a genuine push — but it **terminates at whatever the command does**, and the command cannot wake a sleeping consumer. In practice every operator wires the sink to append to a file and then invents a way to watch that file.

The point of the notification system is to remove polling and to keep work from stalling unattended. It does not currently do either, because there is no first-class way to *block until the next incident*.

Observed consequences in one operator session (2026-09-02):

- The operator agent wired the sink to `>> notifications.jsonl` and watched it with `tail -n +N -f … | head -1`. That waiter **self-terminates after one line**, so it had to be manually re-armed after every single incident.
- One re-arm was missed and the session went **idle for ~10.5 hours** with three implement lanes in flight. Two burned `iteration_timeout` unattended and one wedged; all three needed hand recovery. Nothing was wrong with the harness — nothing woke the operator.
- Reading by line offset was the only thing preventing lost incidents between waiters: an incident delivered while no waiter was armed is invisible to a plain `tail -f`.

## Decisions

- Add a blocking consumer — `jarvis notifications wait` — that returns when the next operator-actionable incident is owed, prints it as JSON, and exits `0`. This is the primitive an agent or shell can block on; when it returns, the caller is awake with the incident in hand. It replaces every hand-rolled tail.
- **No lost wakeups.** `wait` is backed by the same durable delivery ledger as the sink, and accepts `--since <cursor|duration|timestamp>` so an incident delivered while no consumer was waiting is returned immediately by the next `wait`. A consumer that reconnects must never miss a boundary — this is the property a bare `tail -f` cannot provide.
- Add `jarvis notifications list [--since …]` for catch-up and `--follow` for a long-lived stream, sharing the ledger and JSON shape with `wait`.
- Filtering by incident kind (`--kind terminal:failed,run-blocked,pipeline-awaiting-approval`) so a consumer can block only on actionable boundaries rather than every terminal run row.
- `notificationSinkCommand` stays as-is for push into external systems; `wait` is the pull side of the same ledger, not a replacement.

## Follow-on (same surface, observed alongside)

- **Entry-run terminals fire early.** `run-ad-hoc-terminal` fires when a workflow's *entry* run reaches terminal, while its review and publication rows are still live — so "completed" arrives before the workflow has produced a PR. Repeatedly observed: plan runs notified `terminal:completed` with the review row still `live` and no PR for minutes afterward.
- **One incident per terminal run row is chatty for multi-row invocations.** A single workflow emits an incident per row; an invocation-level rollup would make the actionable subset legible. (The existing seed's one-incident dedup targets pipelines, not standalone runs.)

Both are worth resolving with `wait`, since a blocking consumer makes premature and duplicate incidents actively misleading rather than merely noisy.

## Acceptance criteria

- [ ] `jarvis notifications wait` blocks until the next owed operator-actionable incident, prints it as one JSON line on stdout, and exits `0` — pinned by a test that writes an incident after the wait begins.
- [ ] An incident delivered while no consumer was waiting is returned by the next `jarvis notifications wait --since <prior cursor>` rather than lost — pinned by a test.
- [ ] `--kind` restricts blocking to the named incident kinds; a non-matching incident does not wake the wait — pinned by a test.
- [ ] `jarvis notifications list --since <duration>` returns prior incidents from the durable ledger without blocking — pinned by a test.
- [ ] `bun run typecheck` and the `test:v2` pair pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Deciding a workflow is finished / § Operator notifications: `jarvis notifications wait` is the supported wake primitive; remove the guidance that operators should reach for `run list` loops when a notification is missed.
- `v2/docs/daemon-host.md` — the delivery-ledger contract shared by the sink and `wait`.
