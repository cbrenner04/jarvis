# Cursor spawn settle retains settlement on zero-exit quota

Cursor zero-exit quota from a terminal non-success `type: "result"` frame on stdout settles in spawn `settleZeroExit` / quota classification (`agents.test.ts` `cursor binding classifies zero-exit quota patterns`, `quotaZeroExitResult` fixture) without spreading `usage` from that frame today.

## Decisions

- Spread parsed cursor stream settlement onto the classified `quota` result at the spawn settle choke point that already produced the quota classification — rules out a finalize-only spread when spawn settle returned `quota` first.
- Reuse subspec-00 settlement field names — rules out per-agent telemetry shapes.
- AC fixture: zero-exit spawn with terminal `result` frame `is_error: true`, quota-shaped `result` text, and `usage` on the frame; assert `usage_source: "agent"` on the quota binding result — rules out agent provenance without frame counters.
- Frame without `usage` omits settlement fields on the quota result (mapper defaults apply downstream) — rules out zero-filled usage objects.

## Tasks

- At the cursor spawn-settle path that classifies zero-exit quota from scoped stdout/result text, parse terminal frame usage and spread onto the `quota` result.
- Add or extend `agents.test.ts` beside `cursor binding classifies zero-exit quota patterns` for a `quotaZeroExitResult`-style fixture that includes `usage` on the result line.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` — Cursor zero-exit quota from terminal non-success `result` stdout (spawn settle path exercised by `cursor binding classifies zero-exit quota patterns`) retains `usage` and `usage_source: "agent"` on the `quota` result when the frame carries `usage`; fails against the pre-fix quota settle that returns only `stderr` / `diagnostics` without settlement.
- [ ] `shared/invocation/agents.test.ts` — existing cursor quota classification tests without parsed usage stay green (no spurious settlement fields).
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — cursor shared binding retains terminal-frame usage on spawn-settled quota when present (brief; defer field catalog to `shared-invocation.md`).
