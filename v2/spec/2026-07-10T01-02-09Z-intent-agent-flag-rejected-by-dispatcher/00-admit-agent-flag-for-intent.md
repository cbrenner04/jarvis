# 00 - Admit --agent for intent in the CLI dispatcher

`jarvis1 intent --agent <name>[:<model>]` currently exits with
`intent: --agent is not supported` before `intent.ts`'s own `--agent` parsing
and override logic ever runs, because `v1/src/cli.ts:183`'s
`AGENT_FLAG_SUBCOMMANDS` guard omits `"intent"`.

## Decisions

- Add `"intent"` to `AGENT_FLAG_SUBCOMMANDS` in `v1/src/cli.ts` — the
  parse/override path already exists in `intent.ts`, so no new parsing logic
  is needed.
- Update the two stale tests in `v1/test/cli.test.ts` that assert the current
  broken behavior: the `"intent"` case in `"unsupported subcommands reject
  --agent"` (~line 293) and `"intent --agent exits 1 with usage error"`
  (~line 766) — both must change to reflect that `intent --agent` is now
  accepted.
- Add a test asserting `jarvis1 intent --agent codex:gpt-5.5 <seed>` parses
  successfully and applies the agent override to `modes.plan.agentOrder`.

## Out of scope

- Adding `--agent` to any subcommand that does not support it.
- Changing the override semantics documented in `agents.md`.

## Acceptance criteria

- [ ] `jarvis1 intent --agent <name>[:<model>] <seed>` no longer errors with
      `intent: --agent is not supported`; the override applies to
      `modes.plan.agentOrder`.
- [ ] `v1/test/cli.test.ts` no longer asserts `intent --agent` is rejected;
      a passing case (parse succeeds, override applied) replaces it.
- [ ] `config --agent claude show` still errors with `--agent is not
      supported` (unsupported subcommand behavior unchanged).

## Documentation updates

- `v2/docs/v1-behaviors.md`: note that the CLI dispatcher now admits
  `--agent` for `intent` (previously rejected before reaching intent's own
  parser).
