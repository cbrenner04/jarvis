# Machine-profile changes never reach a running daemon

## Problem

Editing `config/machines/<profile>.json` — the committed home of every role→model rung — has no
effect on a daemon that is already running. The daemon resolves the profile once and keeps it, and
the one mechanism that would refresh it does not fire: **supersede keys on the executable digest**,
and a profile edit changes a JSON data file, not the executable. So the digest is unchanged, no new
daemon starts, and dispatches keep using the rungs the daemon booted with.

The operator gets no signal. `jarvis daemon status` reports `running` with a loaded digest that is
genuinely current. Nothing reports which profile revision is live, and nothing warns that the file
on disk and the rungs in use have diverged.

## Evidence

2026-07-25. Daemon pid 70925 started 01:01 UTC. Two rung changes merged after it:

- `config: raise claude implement rung from haiku to sonnet-5` (#2133, 02:26 UTC)
- `config: order actuator rungs sonnet then opus` (#2135, 02:40 UTC)

Primary checkout at the time of the next dispatch, on `main`, both changes present:

```console
$ python3 -c "import json; d=json.load(open('config/machines/home.json')); \
  print([r['adapterModel'] for r in d['models']['claude']['implement']['rungs']])"
['claude-sonnet-5']
```

The dispatch launched at 02:52 UTC nevertheless ran the old rung (telemetry):

```text
02:55:27 implement implement claude-haiku-4-5-20251001 dur=468254 ok
```

`DEFAULT_MACHINES_DIR` (`v2/src/config/machine-profile-loader.ts:35`) resolves to the primary
checkout's `config/machines/`, and `readMachineProfileDocument` does a plain `readFileSync` with no
cache of its own — so the staleness is above that layer, in whatever resolves and holds the profile
for the daemon's lifetime.

Cost: two config fixes were merged, verified on disk, and silently did nothing. The operator only
noticed by reading `adapterModel` in telemetry.

## Decisions

- A machine-profile change must reach dispatch without an operator-initiated daemon restart —
  re-read the profile per dispatch, or detect the file change and refresh. Rules out "restart the
  daemon after editing rungs" as the contract, which is undiscoverable and currently undocumented.
- If a restart genuinely must remain the mechanism, `jarvis daemon status` must report the live
  profile revision and say when it differs from the file on disk. Rules out a `running` that is
  truthful about the digest and silent about stale rungs.
- Supersede must not be assumed to cover config: it keys on the executable digest, and a data-file
  edit does not move it. Rules out relying on the existing auto-bounce for this class of change.
- Telemetry already records the resolved `adapterModel` per invocation; that is the only current way
  to tell which rungs are live. Surface it somewhere an operator would look before a run, not only
  after. Rules out leaving telemetry archaeology as the detection method.
- Out of scope: the rung values themselves, and `~/.jarvis/config.json` (`agents`, `machineProfile`),
  which may or may not share this staleness — check both when planning.

## Acceptance criteria

- [ ] A dispatch issued after a machine-profile edit uses the edited rung with no daemon restart; a
      test that edits the profile mid-daemon and asserts the new `adapterModel` fails against the
      pre-fix code.
- [ ] The unchanged case is unaffected: with no edit, repeated dispatches resolve the same rung and
      the profile is not needlessly re-read on every invocation if the fix caches with invalidation.
- [ ] If a restart remains required, `jarvis daemon status` names the live profile revision and flags
      divergence from disk; inverting the divergence check fails a test.
- [ ] `~/.jarvis/config.json` changes (`agents`, `machineProfile`) are covered by the same contract or
      explicitly documented as requiring a restart, with a test pinning whichever holds.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — when a rung edit takes effect, and how to confirm which rungs are
  live.
- `v2/docs/operator-runbook.md` § Overlapping daemons — supersede covers executable changes only; it
  does not refresh machine-profile config.

## Prerequisites

None.
