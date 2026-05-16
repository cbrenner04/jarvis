# 08 — `codex` adapter

Implement the `codex` adapter against the interface from spec 07.

## Tasks

- [x] `src/agents/codex.ts` — invokes the `codex` CLI in one-shot/non-interactive mode. Document the chosen invocation in the file header.
- [x] Honors `cwd`.
- [x] Quota detection stubbed (real detection lands in spec 10).
- [x] Tests mirror spec 07's shape.

## Acceptance criteria

- Adapter conforms to the `Agent` interface.
- Tests pass.

## Documentation updates

- Add `codex` to the "Agents" section in `README.md`.
