# A docs-only merge halts all dispatch until every live run finishes

## Problem

The daemon revision guard compares HEAD SHAs. Any merge moves HEAD, so any merge makes the running
daemon "stale" — including merges that change no executable code at all.

Observed 2026-07-21, immediately after merging #1857, a **markdown-only** PR touching only
`v2/spec/seeds/*.md`:

```console
$ jarvis run workflow intent --seed v2/spec/seeds/implement-pr-body-omits-the-spec-template.md
daemon revision mismatch: loaded=61b7d94c current=5bea3256; cannot restart while live runs:
  b424b81b-…, 24ec2dfd-…

$ jarvis run workflow intent --seed … --no-auto-bounce
daemon revision mismatch: loaded=61b7d94c current=5bea3256; restart the daemon before starting or
  resuming work
```

Both paths refuse. The auto-bounce path cannot bounce (two live implement runs); `--no-auto-bounce`
refuses outright. So the operator is deadlocked: **no new run can be dispatched until every live
run finishes**, and implement runs take 20+ minutes. Merging landed work — the thing the operator
does constantly — is what stops the pipeline, and it stops it for a change the daemon does not
execute.

The guard's intent is real (`daemon-runs-stale-code-until-restarted`): a daemon running old code
silently produces wrong behavior. But SHA equality is the wrong test for it.

## Decisions

- Gate the mismatch on whether the daemon's **executable** tree changed, not on HEAD equality:
  compare a digest over the code paths the daemon actually loads (`v2/src/**`, `shared/**`, and the
  manifests that resolve them), not `v2/spec/**`, `v2/docs/**`, `v1/**`, `reports/**`, or `README`.
- A merge that leaves that digest unchanged advances the daemon's recorded revision without a
  bounce and without refusing dispatch.
- A genuine code-tree change keeps today's behavior exactly: auto-bounce when idle, refuse when
  live runs exist.
- Rules out dropping or weakening the guard for real code changes, and rules out dispatching
  against a daemon whose code is genuinely stale.
- Deferred to first consumer: draining or migrating live runs across a bounce.

## Acceptance criteria

- [ ] After a merge touching only `v2/spec/**`, `v2/docs/**`, or other non-daemon paths, dispatch
      proceeds with no bounce and no mismatch error, including while runs are live.
- [ ] The daemon's recorded revision advances to the new HEAD in that case.
- [ ] After a merge touching `v2/src/**` or `shared/**`, an idle daemon auto-bounces as today.
- [ ] After a merge touching `v2/src/**` or `shared/**` with a live run, dispatch still refuses and
      names the live run IDs, as today.
- [ ] `--no-auto-bounce` still refuses a genuine code mismatch.
- [ ] Coverage pins the path classification: a fixture list of changed paths maps to
      bounce-required vs. not.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — when a merge requires a daemon bounce and when it does not;
  update the "bounce after merging any v2 change" instruction.
- `v2/docs/daemon-host.md` — the revision guard's comparison basis.
