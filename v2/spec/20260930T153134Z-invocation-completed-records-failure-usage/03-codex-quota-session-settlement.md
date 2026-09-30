# Codex retains session settlement on spawn-settled quota

`runCodexBinding` returns spawn-settled non-`ok` results at `agents.ts` ~1051–1052 without running `resolveCodexSessionUsage`, so quota exits drop session-measured usage that ok paths would attach after the same invocation.

## Decisions

- After `runAgent`, when the spawn result is `quota`, run session correlation/finalize settlement and spread onto the `quota` result — rules out leaving the `kind !== "ok"` early return untouched for quota while fixing Claude/Cursor spawn paths only.
- Reuse existing codex session finalize outputs (`usage`, `usage_source`, `cost_usd`, `cost_source`, `warnings`) on the non-ok result — rules out a parallel codex telemetry shape.
- AC uses `spawnWritingCodexRollout` with a matched `token_count` rollout and a spawn settle that classifies `quota` (e.g. stderr usage-limit pattern on non-zero or zero exit per existing classifier tests) — rules out an unreachably synthetic path.
- When correlation fails on a quota exit, omit settlement fields on the binding result — rules out inventing usage on quota without session proof.

## Tasks

- Replace or narrow the non-`ok` early return in `runCodexBinding` so quota results can carry session settlement when correlation succeeds.
- Add `agents.test.ts` coverage: matched rollout plus quota-classified spawn exit retains priced session `usage` on the `quota` result.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` — Codex binding with matched session rollout and spawn exit classified `quota` (reachable quota classifier fixture, not ok-only finalize) returns `usage` with `usage_source: "agent"` on the quota result; fails against the pre-fix `if (result.kind !== "ok") return result` path in `runCodexBinding`.
- [ ] `shared/invocation/agents.test.ts` — `codex binding with matched rollout settles priced session usage and computed list-price cost` stays green.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — codex shared binding may attach session-resolved usage/cost on quota exits when correlation succeeds (coordinate with subspec 00; cite `shared-invocation.md` codex bullets).
