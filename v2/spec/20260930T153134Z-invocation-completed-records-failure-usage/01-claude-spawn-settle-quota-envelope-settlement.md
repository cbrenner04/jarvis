# Claude spawn settle retains settlement on zero-exit quota envelope

On main, Claude zero-exit quota envelopes settle in `runAgent` `settleZeroExit` (`agents.ts` ~634–638) as `{ kind: "quota", stderr: outBuf }` before `finalizeClaudeInvocationResult` runs; measured usage on the terminal `type: "result"` frame is dropped there today.

## Decisions

- For Claude zero-exit quota envelopes, parse settlement from accumulated stdout (`outBuf`) at `settleZeroExit` immediately before `settle({ kind: "quota", ... })` — rules out relying on `finalizeClaudeInvocationResult` (unreachable once spawn settle returns `quota`).
- Reuse subspec-00 settlement field names on the returned `InvocationQuota` — rules out ad-hoc shapes.
- Fixture with a parseable terminal `result` frame must include `usage` (and optional `total_cost_usd`) on that frame; the AC asserts `usage_source: "agent"` (and agent cost fields when `total_cost_usd` is present) on the quota result — rules out asserting agent provenance without parser input.
- Quota envelope stdout with no parseable counters omits settlement fields on the binding result; `usage_source: "unavailable"` on `invocation_completed` comes from subspec-00 mapper defaults only — rules out binding-side `"unavailable"` when counters were never recovered.
- Deferred to first consumer: opencode stream-json `step_finish` usage before stderr-only quota classification — pin when a main-reachable path needs it.

## Tasks

- In `settleZeroExit` Claude quota-envelope branch, spread parsed settlement from `outBuf` onto the quota result (shared helper with `parseClaudeJsonOutput` / envelope extraction is fine).
- Extend `shared/invocation/agents.test.ts` `claude zero-exit quota envelope returns quota`: one case with `usage` on the envelope asserts settlement on the quota result; one case without counters asserts no settlement fields on the quota result.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` — Claude zero-exit quota envelope (`fakeSpawn` settle code `0`, reachable via spawn `settleZeroExit`, not `finalizeClaudeInvocationResult`) with `usage` on the terminal `type: "result"` frame returns `kind: "quota"` and retains `usage` with `usage_source: "agent"`; fails against the pre-fix `settle({ kind: "quota", stderr: outBuf })` path that drops counters.
- [ ] `shared/invocation/agents.test.ts` — `claude zero-exit normal output and text with quota phrases are not text-matched` stays green.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — Claude shared binding retains parsed usage/cost on zero-exit quota envelope classification (coordinate with subspec 00; point at `shared-invocation.md` for the field catalog).
