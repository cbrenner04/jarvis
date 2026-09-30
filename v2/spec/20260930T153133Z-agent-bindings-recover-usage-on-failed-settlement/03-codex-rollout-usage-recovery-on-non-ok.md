# 03 — Codex binding recovers session rollout usage on non-ok settlement

`runCodexBinding` returns immediately when `runAgent` settles non-`ok`, so `resolveCodexSessionUsage` / `finalizeCodexInvocationResult` never run and codex quota/error exits drop rollout token counters before telemetry.

## Decisions

- On every settled codex result (`ok` and non-`ok`), run the existing session correlation + terminal `token_count` selection path — rules out keeping the early `if (result.kind !== "ok") return result` guard.
- Reuse today's unique-match, terminal non-null `token_count`, list-price `computeCost`, and warning strings; recovery errors add warnings only — rules out new correlation heuristics or reclassifying exit kind.
- When correlation or extraction fails on non-`ok`, leave usage absent with existing unavailable warnings — rules out synthetic usage on miss.
- Tests use injectable `sessionsDir` / `randomUUID` and temp session JSONL fixtures only — rules out ambient `~/.codex/sessions` reads.

## Tasks

- Remove the non-`ok` short-circuit in `runCodexBinding`; apply `finalizeCodexInvocationResult` (or shared codex usage attachment) for non-`ok` the same as `ok` when a session file resolves.
- Extend `agents.test.ts` with codex-session fixtures: non-`ok` exit (quota and generic error) after a changed session file with terminal `token_count` carries recovered usage on the settled result; missing session leaves usage null; multi-match refuses with existing warning and null usage.
- Align `v2/docs/shared-invocation.md` codex paragraph with non-`ok` recovery; finish `v2/docs/v1-behaviors.md` codex/telemetry bullets if subspec 02 left them partial.
- Run `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared`.

## Acceptance criteria

- [ ] `agents.test.ts` — codex binding with injected session dir: non-`ok` exit after rollout `token_count` settles with recovered usage and `usage_source: "agent"` on the result; fails against pre-fix early return on `kind !== "ok"`.
- [ ] `agents.test.ts` — codex non-`ok` quota exit with injected session retains recovered usage; missing session dir leaves usage null; multi-match session correlation keeps existing warning and null usage.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding runs session rollout usage resolution on non-`ok` settlements as well as `ok`; unchanged correlation/uniqueness warnings.
- `v2/docs/v1-behaviors.md` — codex non-`ok` invocations can emit recovered usage on `invocation_completed` rows when session correlation succeeds.
