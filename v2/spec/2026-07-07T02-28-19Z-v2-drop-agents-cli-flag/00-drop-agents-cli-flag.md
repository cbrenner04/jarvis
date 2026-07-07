# Drop --agents flag from write/run start

`jarvis write` and `jarvis run start` currently accept `--agents <csv>`
(`v2/src/cli.ts`, `v2/src/execution/write-loop-input.ts`), which overrides the
machine config's `agents` order for that invocation. Remove the flag; fallback
precedence becomes config-only: `~/.jarvis/config.json` `agents` when present,
else the built-in `DEFAULT_WRITE_AGENTS`.

## Decisions

- Drop `--agents` entirely rather than keep it as a deprecated no-op — an
  unused flag left parsing is dead CLI surface with no caller.
- Remove the now-orphaned `agents`/CSV-parsing plumbing in
  `write-loop-input.ts` (`WriteLaunchFieldValues.agents`, `parseAgents`'s raw
  branch) — the CLI flag was its only caller once dropped.
- `write-behavior.md` on `main` already has no qwen/local-model
  terminal-fallback prose (only `v2-architecture.md`, `v2-build-order.md`,
  `v2-vision.md` mention qwen, and those are forward-looking vision docs, not
  current CLI behavior) — no removal needed there.

## Task checklist

- [ ] Remove `agents` from `parseWriteArgs`'s option map in `v2/src/cli.ts`;
      drop `[--agents <csv>]` from `WRITE_USAGE`.
- [ ] Remove the CLI-only `agentsFromCli` branch in `parseWriteCliInput`;
      always resolve fallback agents from `loadMachineConfig`.
- [ ] Remove `agents` from `WriteLaunchFieldValues` and the raw-CSV branch in
      `parseAgents` (`v2/src/execution/write-loop-input.ts`); fallback
      resolution becomes `fallbackAgents ?? DEFAULT_WRITE_AGENTS` only.
- [ ] Update `v2/src/cli.test.ts` and
      `v2/src/execution/write-loop-input.test.ts`: drop tests asserting
      `--agents` overrides config/defaults; keep/adjust tests for config-only
      fallback and default-agent behavior.
- [ ] Update `v2/docs/write-behavior.md`: drop `--agents` from the `Command`
      usage block and the `run start` mapping table row; rewrite the fallback
      bullet to state config-only precedence (`~/.jarvis/config.json` `agents`
      → `DEFAULT_WRITE_AGENTS`).

## Acceptance criteria

- [ ] `jarvis write` and `jarvis run start` reject `--agents` as an unknown
      option instead of accepting it.
- [ ] Agent fallback order for both commands is `~/.jarvis/config.json`
      `agents` when present, else `DEFAULT_WRITE_AGENTS`, with no per-invocation
      override path.
- [ ] `bun run typecheck` and `test:v2` (+ `test:integration:v2`) pass.

## Documentation updates

- `v2/docs/write-behavior.md`: usage block, `run start` mapping table, and
  fallback-precedence bullet updated to the config-only order, `--agents`
  references removed.
