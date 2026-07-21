# Executable-tree revision guard

## Problem

The revision guard compares Git HEAD SHAs. A merge that touches only non-executable paths (`v2/spec/**`, `v2/docs/**`, …) changes HEAD without changing daemon code, so dispatch refuses or tries to bounce while live runs block restart.

## Decisions

- Gate mismatch on an executable-tree digest over `v2/src/**`, `shared/**`, and the repo manifests that resolve them (`package.json`, lockfile, root/tsconfig paths); rules out HEAD SHA equality that false-positives on docs/spec merges and rules out weakening the guard for real code changes.
- `status.loadedRevision` stays the daemon's recorded Git HEAD; the guard compares executable digests, not HEAD strings; rules out replacing HEAD reporting with an opaque digest label.
- When digests match but HEAD differs, advance `loadedRevision` to the invoking HEAD in-process before admitting work — no bounce, no refusal; rules out requiring restart for non-executable merges.
- Executable-digest mismatch preserves today's auto-bounce, live-run refusal, `--no-auto-bounce` refusal, one retry, and exempt observation/steering paths; rules out dispatching against genuinely stale daemon code.
- `jarvis daemon status` reports `stale` only on executable-digest mismatch, not HEAD mismatch alone; rules out false `stale` on docs-only merges.
- CLI and TUI work-dispatch guards share the same digest comparison and advance contract; rules out TUI refusing docs-only merges while CLI proceeds.
- Path classification is pinned by a fixture table mapping changed paths to bounce-required vs not; rules out ad-hoc per-caller path checks.
- Deferred to first consumer: draining or migrating live runs across a bounce.

## Work

- Add shared executable-tree digest and path-classification helpers with the fixture-backed table.
- Capture the daemon startup executable digest at boot; retain startup HEAD as `loadedRevision`.
- Extend the daemon status/guard path so a digest match with HEAD drift advances `loadedRevision` without lifecycle mutation.
- Route `guardWorkDispatch`, TUI start/resume guard, and `getDaemonStatus` through digest comparison.
- Add regression coverage for docs-only dispatch (including with live runs), revision advance, genuine-code bounce/refusal, classification fixtures, and preservation of existing stale-daemon cases.
- Align operator docs and the v1-parity catalog; remove the operator-runbook seed that documents docs-only dispatch halt.

## Acceptance criteria

- [ ] After a merge touching only `v2/spec/**`, `v2/docs/**`, or other non-executable paths, CLI `run start`, `run resume`, and `run workflow` dispatch proceed with no bounce and no mismatch error while one or more `isLive` rows exist.
- [ ] In that case the daemon's `loadedRevision` advances to the invoking HEAD before the mutating request is sent.
- [ ] After a merge touching `v2/src/**` or `shared/**`, an idle daemon auto-bounces and retries once, as `run.test.ts` already covers for HEAD-only mismatch.
- [ ] After a merge touching `v2/src/**` or `shared/**` with a live run, dispatch refuses, names every live run ID, and performs no lifecycle mutation, as `run.test.ts` already covers for HEAD-only mismatch.
- [ ] `--no-auto-bounce` on a genuine executable-digest mismatch still refuses with restart guidance and sends no mutating request, as `run.test.ts` and `workflow.test.ts` already cover for HEAD-only mismatch.
- [ ] A fixture table maps representative changed paths to bounce-required vs not, with unit coverage that fails against the pre-fix classification.
- [ ] `run.test.ts` adds a docs-only-merge dispatch regression that fails against the pre-fix HEAD guard and passes after the change.
- [ ] `tui-daemon-client.test.ts` revision-mismatch cases for a genuine executable-digest drift stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/operator-runbook.md` states when a merge requires a daemon bounce vs not and removes the docs-only dispatch-halt seed.
- [ ] `v2/docs/daemon-host.md` documents the executable-digest comparison basis and HEAD-advance semantics on non-executable merges.
- [ ] `v2/docs/v1-behaviors.md` records the changed v2 revision-guard behavior.

## Documentation updates

- `v2/docs/operator-runbook.md` — bounce vs no-bounce merge guidance; remove docs-only halt seed.
- `v2/docs/daemon-host.md` — executable-digest comparison basis and `loadedRevision` advance.
- `v2/docs/v1-behaviors.md` — v2 revision-guard parity entry.
