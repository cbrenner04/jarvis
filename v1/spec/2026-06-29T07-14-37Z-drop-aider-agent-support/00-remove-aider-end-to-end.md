# Remove aider end to end

`aider` is no longer a supported agent CLI. Remove adapter wiring, config surface, quota/price classification, docs, and tests. Leave the agent-adapter interface, fallback ladder, and all other agents (`claude`, `codex`, `cursor`, `opencode`) unchanged.

## Decisions

- Single subspec — rules out landing partial removal across multiple PRs that leave failing tests or dangling types.
- Drop `aider` from `AgentName`/`AGENT_NAMES` with no deprecation shim — rules out a dead stub adapter or warn-and-continue path.
- Config entries naming `aider` fail existing `unknown agent` validation — rules out silent remap to another agent.
- Delete `v1/docs/aider-model-warnings.md` — rules out redirect, archive page, or merged appendix elsewhere.
- `grep` exclusion limited to `v1/spec/completed/**` — rules out rewriting archived spec/verdict trees; active tree must be clean.
- Remove consumed `v1/spec/ready-intents/drop-aider-agent-support.md` and reword remaining ready-intent aider mentions — rules out exempting `ready-intents/` from the grep AC.
- Strip only `aider` branches from `quota.ts` and `price-keys.ts` — rules out changing shared quota base patterns or other adapters.

## Tasks

- [ ] Delete `v1/src/agents/aider.ts`; remove factory registration, `AgentName` entry, and `DEFAULT_AGENT_MODELS.aider`.
- [ ] Remove `aider` quota/model-config patterns and `price-keys` dispatch branches.
- [ ] Delete `v1/docs/aider-model-warnings.md`; strip aider from `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`.
- [ ] Update `v2/docs/v1-behaviors.md` for four supported adapters and revised plan no-commit write-access wording.
- [ ] Delete `v1/test/agents/aider.test.ts`; remove aider cases from `price-keys.test.ts`, `quota.test.ts`, `config.test.ts`, `run.test.ts`, `telemetry-enrichment.test.ts`, `pool-contention.test.ts`, `plan-no-commit-intent-output.test.ts`, and `plan-command.sandbox-unrunnable.test.ts` (replace plan-test agent fixtures with a remaining opt-in agent where needed).
- [ ] Remove consumed ready-intent; reword any other active ready-intent aider references so `grep` passes outside `v1/spec/completed/**`.

## Acceptance criteria

- [ ] `v1/src/agents/aider.ts` is absent and `createAgent("aider", …)` is unreachable (no factory case).
- [ ] `AgentName` and config validation allow only `claude`, `codex`, `cursor`, `opencode`; a config with `{ "agent": "aider", … }` rejects with `unknown agent`.
- [ ] `v1/docs/aider-model-warnings.md` is absent; `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, and `quota-signals.md` document no `aider` agent.
- [ ] `grep -rin aider` reports no matches outside `v1/spec/completed/**`.
- [ ] `v2/docs/v1-behaviors.md` records four supported adapters and no aider-specific runtime behavior.
- [ ] `v1/test/agents/claude.test.ts`, `codex.test.ts`, `cursor.test.ts`, and `opencode.test.ts` stay green (other adapters unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- Delete `v1/docs/aider-model-warnings.md`.
- Strip aider from `v1/docs/agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`.
- Update `v2/docs/v1-behaviors.md` (behavior change).
