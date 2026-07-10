# 00 - Admit --agent for intent in the CLI dispatcher

`jarvis1 intent --agent <name>[:<model>]` currently exits with
`intent: --agent is not supported` before `intent.ts`'s own `--agent` parsing
and override logic ever runs, because `v1/src/cli.ts:183`'s
`AGENT_FLAG_SUBCOMMANDS` guard omits `"intent"`.

## Decisions

- Add `"intent"` to `AGENT_FLAG_SUBCOMMANDS` in `v1/src/cli.ts` — the
  parse/override path already exists in `intent.ts`, so no new parsing logic
  is needed.
- Remove only the `"intent"` row from the `"unsupported subcommands reject
  --agent"` table in `v1/test/cli.test.ts` (~line 293); leave the `config`
  row asserting rejection unchanged.
- Replace `"intent --agent exits 1 with usage error"` (~line 766) — it calls
  `run(["intent", "--agent", "claude", "seed.md"])` with a nonexistent
  `seed.md`, so once `--agent` is admitted the run still exits 1, now for
  seed resolution, not flag rejection. Replace it with a test asserting
  `cap.err()` no longer contains `--agent is not supported` for that same
  invocation (do not assert success, since `seed.md` isn't a real seed).
- Add a `parseArgs`-level test mirroring the existing `"prompt with --agent
  colon model"` case (~line 274 in `v1/test/cli.test.ts`): assert
  `parseArgs(["intent", "--agent", "codex:gpt-5.5", "seed.md"])` returns
  `agentFlag: "codex:gpt-5.5"` on the parsed `"intent"` result — this is the
  observable CLI-layer seam; the override actually reaching
  `modes.plan.agentOrder` is already covered end-to-end by
  `v1/test/intent-agent-override.test.ts`, which this subspec does not need
  to duplicate.

## Out of scope

- Adding `--agent` to any subcommand that does not support it.
- Changing the override semantics documented in `agents.md`.

## Acceptance criteria

- [ ] `jarvis1 intent --agent <name>[:<model>] <seed>` no longer errors with
      `intent: --agent is not supported`.
- [ ] `parseArgs(["intent", "--agent", "codex:gpt-5.5", "seed.md"])` returns
      `agentFlag: "codex:gpt-5.5"` on the parsed result.
- [ ] `config --agent claude show` still errors with `--agent is not
      supported` (unsupported subcommand behavior unchanged).

## Documentation updates

- `v2/docs/v1-behaviors.md`: note that the CLI dispatcher now admits
  `--agent` for `intent` (previously rejected before reaching intent's own
  parser).
