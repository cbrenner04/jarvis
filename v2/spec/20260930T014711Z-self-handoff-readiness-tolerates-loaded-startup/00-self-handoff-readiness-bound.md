# Self-handoff readiness bound under load

## Problem

Autonomous self-handoff's default successor closure calls `startDaemon` without `readinessTimeoutMs`, so it shares the 5s `DEFAULT_DAEMON_READINESS_TIMEOUT_MS` budget with manual `jarvis daemon start`. A live successor that answers `health` only after that window is killed, `startDaemon` rolls back, and the incumbent can stay `daemon_superseded` through the fallback/admission chain. The incumbent's `DEFAULT_HANDOFF_FALLBACK_MS` is derived from the same 5s readiness constant, so it can roll back a slow-but-live successor before the extended budget would have allowed a commit.

## Decisions

- Add a named self-handoff readiness constant in `v2/src/daemon/daemon-changeover.ts` strictly greater than `DEFAULT_DAEMON_READINESS_TIMEOUT_MS` — rules out inflating `DEFAULT_DAEMON_READINESS_TIMEOUT_MS` for every `startDaemon` caller including manual `daemon start`.
- The default self-handoff successor closure in `startDaemonRuntime` (`v2/src/daemon/daemon.ts`) passes that constant as `readinessTimeoutMs` — rules out only documenting a longer bound without wiring it on the autonomous path.
- Manual `jarvis daemon start` (`v2/src/commands/daemon.ts`) keeps omitting `readinessTimeoutMs` — rules out widening CLI-invoked upgrades by default.
- Derive the production daemon's incumbent `handoffFallbackMs` from the same successor-readiness budget using the existing release + readiness + resolution + slack shape (`DEFAULT_HANDOFF_FALLBACK_MS` today) — rules out a fixed fallback duration that can still fall below the self-handoff readiness window.
- Set that derived `handoffFallbackMs` only on the production self-handoff opt-in path (`daemon-entrypoint.ts` / `enableSelfHandoff`) — rules out changing fallback timing for embedded or test runtimes that never autonomous-handoff.
- `enableSelfHandoff` outside `daemon-entrypoint.ts` is unsupported unless the caller also sets incumbent `handoffFallbackMs` from the same successor-readiness budget — rules out constructible long readiness with legacy `DEFAULT_HANDOFF_FALLBACK_MS` on embed paths.
- Deferred to first consumer: exact millisecond value for the self-handoff readiness constant — pin when choosing a value with headroom under observed load without widening unrelated budgets.

## Tasks

- [ ] Export the self-handoff readiness constant and a small helper (or paired constant) for handoff fallback ms from a successor readiness budget beside the existing changeover timing exports.
- [ ] Pass the self-handoff readiness constant into `startDaemon` from the default `spawnSelfHandoffSuccessor` closure.
- [ ] Wire production `handoffFallbackMs` from the helper applied to the self-handoff readiness constant.
- [ ] Add a fast unit test through the default `spawnSelfHandoffSuccessor` / `startDaemonRuntime` wiring with injected `socketProber` / `processProber` seams: child stays alive while readiness stays false through `DEFAULT_DAEMON_READINESS_TIMEOUT_MS` then succeeds; assert `startDaemon` completes without readiness rollback.
- [ ] Add a direct unit test on the fallback-vs-readiness ordering helper in both directions (no real timers).
- [ ] Extend `v2/src/commands/daemon.test.ts` so an injected `startDaemon` capture proves `daemon start` omits `readinessTimeoutMs`.
- [ ] Update `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` per documentation updates below.

## Acceptance criteria

- [x] `daemon-self-handoff-readiness.test.ts` (or the test title added there) exercises the default `spawnSelfHandoffSuccessor` closure from `startDaemonRuntime` (not an isolated `startDaemon` call with a hand-set `readinessTimeoutMs`): injected probers keep readiness false through `DEFAULT_DAEMON_READINESS_TIMEOUT_MS`, then succeed while the spawned child stays alive, and autonomous self-handoff successor startup completes `startDaemon` without readiness rollback; fails against the pre-fix code.
- [x] A unit test on the exported fallback budget helper asserts incumbent fallback ms stays strictly beyond the self-handoff readiness window (release + readiness + resolution + slack); it fails against the pre-fix code if the helper is missing or mis-ordered.
- [x] `v2/src/commands/daemon.test.ts` asserts manual `daemon start` does not pass `readinessTimeoutMs` into `startDaemon`; fails against the pre-fix code if that assertion is absent.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` pending-handoff / fallback deadline prose — scope `DEFAULT_HANDOFF_FALLBACK_MS` as derived from the default manual-start `startDaemon` readiness budget; state production autonomous self-handoff sets incumbent `handoffFallbackMs` from the extended self-handoff readiness budget instead.
- `v2/docs/daemon-host.md` § Autonomous self-handoff — document the explicit self-handoff `startDaemon` readiness bound above the default manual-start budget, production incumbent `handoffFallbackMs` derivation from that budget, and that `enableSelfHandoff` off the production entrypoint must pair matching fallback timing.
- `v2/docs/v1-behaviors.md` — extend the `[v2-only]` autonomous self-handoff bullet with the explicit readiness bound above the default `startDaemon` budget and the matching incumbent fallback derivation.
