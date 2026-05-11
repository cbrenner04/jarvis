# 10 — Quota detection

Replace the stubbed quota detection in each adapter with a real implementation.

## Research phase (do first)

For each of `claude`, `codex`, `cursor`, determine how the CLI signals that the user has hit a usage/quota limit. Capture findings in `docs/quota-signals.md`. For each agent, record:

- The exit code observed when quota is exhausted.
- The stderr (and/or stdout) text emitted.
- Whether the signal is distinguishable from generic errors (auth failure, network failure, etc.).
- Source of the finding (CLI source, observed output, vendor docs link).

If any agent's signal cannot be reliably distinguished from a generic error, document the ambiguity and the chosen heuristic.

## Implementation phase

- [x] Per-agent quota matchers in `src/agents/quota.ts`, exported as `isQuotaSignal(name: AgentName, exitCode: number, stderr: string): boolean`.
- [x] Each adapter calls `isQuotaSignal` after the child exits and returns `{ kind: "quota" }` when it matches; otherwise falls back to `ok` / `error` as before.
- [x] Tests feed sample stderr/exit-code pairs (captured during research) and assert correct classification.

## Acceptance criteria

- `docs/quota-signals.md` exists and covers all three agents.
- `isQuotaSignal` is unit-tested per agent with at least one positive and one negative case.

## Documentation updates

- Link `docs/quota-signals.md` from `README.md` "Agents".
- Note in `AGENTS.md` "Core decisions" that quota detection is per-agent and points at `docs/quota-signals.md`.
