# Remove aider end to end

`aider` is no longer a supported agent CLI. Remove adapter wiring, config surface, quota/price classification, docs, and tests. Leave the agent-adapter interface, fallback ladder, and all other agents (`claude`, `codex`, `cursor`, `opencode`) unchanged.

## Decisions

- Single subspec — rules out landing partial removal across multiple PRs that leave failing tests or dangling types.
- Drop `aider` from `AgentName`/`AGENT_NAMES` with no deprecation shim — rules out a dead stub adapter or warn-and-continue path.
- Config entries naming `aider` fail existing `unknown agent` validation — rules out silent remap to another agent.
- Delete `v1/docs/aider-model-warnings.md` — rules out redirect, archive page, or merged appendix elsewhere.
- Grep exclusions: `reports/**`, `v1/spec/completed/**`, self-referential `v1/spec/2026-06-29T07-14-37Z-drop-aider-agent-support/**`, `.gitignore` — rules out rewriting archived specs/reports or renaming `.aider*` to dodge substring matches.
- Sibling spec hygiene in-scope: drop `aider.test.ts` from `v1/spec/2026-06-29T00-00-17Z-spawn-quota-before-model-config/00-quota-before-model-config.md` preservation AC — rules out blanket `v1/spec/**` grep exclusion for stale refs.
- Ready-intent reword: `opencode-ollama-local-model-run.md` drops historical aider comparison phrasing — rules out leaving "dropped aider path" grep hits in active `ready-intents/`.
- Plan-test fixture agent: `opencode` — rules out arbitrary "remaining opt-in agent" choice.
- `plan-no-commit-intent-output`: `opencode` + `nonexistent-for-test` preserves spawn-side draft failure — rules out `unknown agent` config-validation path or naive agent-string rename.
- `plan-command.sandbox-unrunnable`: stub `opencode` fake binary on PATH (exit 1); rename `specDirBasename` to `2026-05-17T123456-opencode-agent` — rules out transferring aider browser-launch stub rationale.
- Telemetry no-price: delete aider case; existing opencode no-price test covers it — rules out duplicate opencode test.
- Strip only `aider` branches from `quota.ts` and `price-keys.ts` — rules out changing shared quota base patterns or other adapters.

## Tasks

- [ ] Delete `v1/src/agents/aider.ts`; remove factory registration, `AgentName` entry, and `DEFAULT_AGENT_MODELS.aider`.
- [ ] Remove `aider` quota/model-config patterns and `price-keys` dispatch branches.
- [ ] Delete `v1/docs/aider-model-warnings.md`; strip aider from `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`, and root `README.md`.
- [ ] De-aider `v2/docs/v1-behaviors.md`: four-adapter catalog, remove all aider bullets/dead `aider-model-warnings.md` links, revise plan no-commit write-access wording.
- [ ] Drop `aider` from `test/setup-fake-agents.ts` fake-binary loop.
- [ ] Delete `v1/test/agents/aider.test.ts`; remove aider cases from `price-keys.test.ts`, `quota.test.ts`, `config.test.ts`, `run.test.ts`, `telemetry-enrichment.test.ts` (delete only — opencode no-price test remains), `pool-contention.test.ts`.
- [ ] `plan-no-commit-intent-output.test.ts`: replace `aider` fixtures with `opencode` + `nonexistent-for-test` (spawn-side draft failure unchanged).
- [ ] `plan-command.sandbox-unrunnable.test.ts`: stub `opencode` on PATH (exit 1); `agentOrder` → `opencode`; `specDirBasename` → `2026-05-17T123456-opencode-agent`.
- [ ] Update `v1/spec/2026-06-29T00-00-17Z-spawn-quota-before-model-config/00-quota-before-model-config.md` preservation AC — drop `aider.test.ts`.
- [ ] Reword `v1/spec/ready-intents/opencode-ollama-local-model-run.md` to remove aider comparison phrasing.

## Acceptance criteria

- [x] `v1/src/agents/aider.ts` is absent and `createAgent("aider", …)` is unreachable (no factory case).
- [x] `AgentName` and config validation allow only `claude`, `codex`, `cursor`, `opencode`; a config with `{ "agent": "aider", … }` rejects with `unknown agent`.
- [x] `v1/docs/aider-model-warnings.md` is absent; `agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`, and root `README.md` document no `aider` agent.
- [x] `grep -rin aider` outside `reports/**`, `v1/spec/completed/**`, `v1/spec/2026-06-29T07-14-37Z-drop-aider-agent-support/**`, and `.gitignore` reports no matches.
- [x] `v2/docs/v1-behaviors.md` records four supported adapters and no aider-specific runtime behavior or dead links.
- [x] `v1/test/agents/claude.test.ts`, `codex.test.ts`, `cursor.test.ts`, and `opencode.test.ts` stay green (other adapters unchanged).
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- Delete `v1/docs/aider-model-warnings.md`.
- Strip aider from `v1/docs/agents.md`, `config.md`, `plan-mode.md`, `run-loop.md`, `quota-signals.md`, and root `README.md`.
- Update `v2/docs/v1-behaviors.md` (behavior change): remove all aider bullets and dead links; four-adapter catalog; revised plan no-commit write-access wording.
