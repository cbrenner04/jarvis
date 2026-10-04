---
name: docs-only-merge-does-not-halt-dispatch
---

# A docs-only merge does not halt dispatch

Merging paths the daemon does not execute (`v2/spec/**`, `v2/docs/**`, and other non-daemon paths) must not refuse or bounce dispatch while runs are live. Merging `v2/src/**` or `shared/**` keeps today's stale-daemon guard: auto-bounce when idle, refuse with live run IDs when not.

## Decisions

- Gate mismatch on an executable-tree digest over `v2/src/**`, `shared/**`, and the manifests that resolve them; rules out HEAD SHA equality that false-positives on docs/spec merges and rules out weakening the guard for real code changes.
- When the digest is unchanged, advance the daemon's recorded revision without bounce or refusal; rules out requiring restart for non-executable merges.
- A genuine executable-tree change keeps today's auto-bounce, live-run refusal, and `--no-auto-bounce` refusal unchanged; rules out dispatching against a daemon whose code is genuinely stale.
- Deferred to first consumer: draining or migrating live runs across a bounce.

## Acceptance criteria

- [ ] After a merge touching only `v2/spec/**`, `v2/docs/**`, or other non-daemon paths, dispatch proceeds with no bounce and no mismatch error, including while runs are live.
- [ ] The daemon's recorded revision advances to the new HEAD in that case.
- [ ] After a merge touching `v2/src/**` or `shared/**`, an idle daemon auto-bounces as today.
- [ ] After a merge touching `v2/src/**` or `shared/**` with a live run, dispatch still refuses and names the live run IDs, as today.
- [ ] `--no-auto-bounce` still refuses a genuine code mismatch.
- [ ] Coverage pins the path classification: a fixture list of changed paths maps to bounce-required vs. not.
- [ ] A regression test fails against the pre-fix code and passes after the change.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — when a merge requires a daemon bounce and when it does not; update the "bounce after merging any v2 change" instruction.
- `v2/docs/daemon-host.md` — the revision guard's comparison basis.
- `v2/docs/v1-behaviors.md` — changed v2 revision-guard behavior.

## Prerequisites

- Dispatch compares the daemon's loaded source revision with the invoking CLI revision and refuses mismatches before admitting work.
- An idle daemon auto-bounces on mismatch and retries dispatch once; live runs block bounce and refuse with their IDs.
