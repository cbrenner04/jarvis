# Machine config carries hot and cold session retention boundaries

## Problem

`~/.jarvis/config.json` exposes one deletion window as `cleanup.sessionLogRetentionDays`, read by `readCleanupSessionLogRetentionDays` in `v2/src/config/machine-config-loader.ts`. Tiered retention needs two boundaries resolved together, and a second source of truth for the same window would drift.

## Decisions

- One global `retention.sessions` block with `hotDays` and `coldDays`; rules out project-scoped retention and rules out two sibling top-level keys.
- Committed loader defaults are `hotDays: 14`, `coldDays: 90` when the block, `retention`, or an individual field is absent; rules out requiring the block and rules out inheriting the old key's single default for both tiers.
- Repointing the reaper at `coldDays` (default `90`) is a deliberate retention-window widen, not a no-op: an override-free config today reaps at 14 days and will reap at 90 days after this change, retaining more disk by default until an operator sets an explicit value. Rules out the false claim that removal is behavior-neutral, and rules out silently keeping a 14-day default under the new key to avoid the widen.
- `coldDays` must be strictly greater than `hotDays`; equal values fail validation. Rules out persisting a config where the "cold" tier isn't actually longer than the "hot" tier, which would silently invert the tiering contract for the first consumer that reads `hotDays` (e.g. a future compression cadence), even though no consumer reads it yet.
- Validation stays result-shaped (`{ ok: false, error }`) rather than throwing, so the cleanup slice keeps refusing in isolation while other slices proceed; rules out promoting retention misconfiguration to a launch-time throw.
- Exact validation messages: a per-field failure (non-integer, zero, negative, non-number) reads `retention.sessions.hotDays must be a positive integer` or `retention.sessions.coldDays must be a positive integer`; a non-record `retention` or non-record `retention.sessions` reads `retention.sessions.hotDays and retention.sessions.coldDays must be positive integers` (naming both, since the whole block is unusable — same treatment the current loader gives a non-record `cleanup`); the ordering failure reads `retention.sessions.coldDays must be greater than retention.sessions.hotDays`. Rules out a generic "invalid retention config" string and rules out inventing a distinct container-level message.
- `cleanup.sessionLogRetentionDays` is removed with no migration or deprecation read; a config still carrying it silently gets the defaults. Rules out dual-read fallback.
- The rewrite preserves three behaviors of the current reader unrelated to the key rename: a non-record top-level config throws (`must be a JSON object`, same as `readMachineConfigDocument`) rather than returning `{ ok: false }` — the distinct `catch` branch in `discoverExpiredSessionLogs` (`v2/src/commands/cleanup.ts`) that emits "Failed to load machine config" depends on this and goes dead otherwise; a nonexistent config file resolves to the defaults; unrelated keys (e.g. `agents`) are not validated by this reader. Rules out routing the rewrite through `readMachineConfigDocument` (which validates `agents` as a side effect) and rules out converting the top-level throw into an `{ ok: false }` result.
- No consumer reads `hotDays`; wiring it into deletion, compression, or any other behavior is out of scope.
- Deferred to first consumer: what `hotDays` gates (compression, roll, or pruning) — pin when a caller needs it.

## Task checklist

- [ ] Replace `readCleanupSessionLogRetentionDays` with a reader returning `{ ok: true; hotDays: number; coldDays: number }` or `{ ok: false; error: string }`, resolving `retention.sessions` with the `14`/`90` defaults, positive-integer validation per field, the `coldDays > hotDays` constraint, and the exact messages above — preserving the top-level non-record throw, the absent-file default, and indifference to unrelated keys.
- [ ] Point `discoverExpiredSessionLogs` in `v2/src/commands/cleanup.ts` at `coldDays`.
- [ ] Update `v2/src/config/machine-config-loader.test.ts` and the session-retention cases in `v2/src/commands/cleanup.test.ts` to the new keys.
- [ ] Apply the documentation updates below.

## Acceptance criteria

- [x] `v2/src/config/machine-config-loader.test.ts` proves an absent `retention` block and an absent individual field resolve to `hotDays: 14` / `coldDays: 90`, positive-integer overrides return unchanged, a non-integer / zero / negative / non-number value for either field yields `{ ok: false, error: "retention.sessions.<field> must be a positive integer" }`, a non-record `retention` or non-record `retention.sessions` yields `{ ok: false, error: "retention.sessions.hotDays and retention.sessions.coldDays must be positive integers" }`, and `coldDays <= hotDays` (including equality) yields `{ ok: false, error: "retention.sessions.coldDays must be greater than retention.sessions.hotDays" }`; it fails against the current single-window loader.
- [x] `v2/src/config/machine-config-loader.test.ts` proves `cleanup.sessionLogRetentionDays` is no longer a retention source: a config setting only that key resolves to the `14`/`90` defaults; it fails against the pre-change loader.
- [x] `v2/src/config/machine-config-loader.test.ts` stays green on the preserved behaviors carried over from the current `readCleanupSessionLogRetentionDays` cases (non-record top-level config throws naming "JSON object", unparseable JSON throws, a nonexistent config path resolves to defaults, an invalid unrelated key such as `agents: "invalid"` does not affect the retention result).
- [x] `v2/src/commands/cleanup.test.ts` proves the session-log reaper's deletion cutoff comes from `retention.sessions.coldDays` (an override changes which logs are reaped) and that an invalid `retention.sessions` value skips session-log reaping only, with stderr naming the offending key and other cleanup slices proceeding; it fails against the pre-change wiring.
- [x] `v2/src/commands/cleanup.test.ts` proves a non-record top-level machine config still hits the distinct "Failed to load machine config" stderr branch in `discoverExpiredSessionLogs` (not the retention-error branch) while other cleanup slices proceed.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` § Cleanup — replace the `cleanup.sessionLogRetentionDays` row with `retention.sessions.hotDays` (default `14`, positive integer, currently has no runtime effect — reserved for a future hot-tier consumer) and `retention.sessions.coldDays` (default `90`, positive integer, must exceed `hotDays`, is the session-log deletion window) rows; note the default deletion window widens from the prior single-window default of `14` days to `90`; document the exact validation messages and that invalid values refuse only session-log reaping; note the block is global and hand-edited.
- `v2/docs/v1-behaviors.md` — update the cleanup session-log retention entry: the deletion window is `retention.sessions.coldDays` (default `90`, changed from the prior `14`-day default), `hotDays` (default `14`) has no deletion effect, and `cleanup.sessionLogRetentionDays` no longer exists.
- `v2/docs/operator-runbook.md` § Cleanup — update the retention-window paragraph (default now `90` days via `retention.sessions.coldDays`) and the invalid-config paragraph (new key names and messages) to the new keys.
- `v2/docs/telemetry-capture.md` — update the `inbound_stderr` backstop's time bound to reference `retention.sessions.coldDays` and its `90`-day default.
