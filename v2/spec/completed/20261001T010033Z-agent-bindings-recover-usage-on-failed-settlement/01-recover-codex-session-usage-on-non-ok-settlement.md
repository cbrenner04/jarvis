# Recover codex session usage on non-ok settlement

`runCodexBinding` returns immediately when `result.kind !== "ok"`, so quota, error, model_config, stall, and abort paths never run `resolveCodexSessionUsage` / `finalizeCodexInvocationResult` even when the correlated session JSONL already recorded `token_count` events.

## Decisions

- After `runAgent` settles non-ok, codex runs the same session correlation and rollout read path as today’s `ok` branch (before snapshot, invocation marker, unique match, last non-null `token_count`) — rules out a second correlation algorithm or reclassifying non-ok to `ok` when usage appears.
- Recovered settlement merges optional fields onto the classified non-ok result without changing `kind`, diagnostics, or authFailure — rules out skipping finalize warnings when rollout read fails.
- Correlation miss, ambiguous match, null-only `token_count`, or unextractable shapes keep today’s unavailable/no-usage defaults with resolver/finalize warnings — rules out blocking settlement or changing exit kind.
- List-price `computeCost` when `priceKey` and recovered fields allow; catalog failures settle `no-price` like the ok path — rules out subscription-billed spend fields.
- Out of scope: changing codex classifier or session marker format — rules out drive-by codex spawn argv edits.

## Tasks

- Remove the non-ok early return guard in `runCodexBinding`; reuse `finalizeCodexInvocationResult` (or equivalent merge) to attach settlement on non-ok results per decisions.
- Extend `shared/invocation/agents.test.ts` with injected codex session directory fixtures proving non-ok quota, error, model_config, stall, and idle-stall paths recover rollout usage and cost, keep separate usage per fallback attempt, and leave usage null when correlation fails; no ambient `~/.codex` or machine config.
- Align docs with stream-binding subspec (`00-recover-stream-binding-usage-on-non-ok-settlement.md`) so codex non-ok recovery is documented once in `shared-invocation.md`.

## Acceptance criteria

- [x] `shared/invocation/agents.test.ts` — codex non-ok session recovery regression (injected sessions dir, quota/error/model_config/stall/idle-stall with matched rollout usage, distinct fallback-attempt usage, null when correlation or counters missing) fails against pre-fix `runCodexBinding` non-ok early return.
- [x] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding recovers session rollout usage on non-ok settlement with the same correlation and terminal `token_count` selection as `ok`; note bounded teardown does not delay settlement.
- `v2/docs/v1-behaviors.md` — amend shared codex invocation bullet so failed settlement can carry recovered session usage before telemetry (pair with claude/cursor/opencode edits from subspec 00); cross-reference or defer to the single-owner non-ok recovery section in `shared-invocation.md` so out-of-order merges do not contradict stream-binding doc edits from subspec 00.
