# 06 - Plan mode aider wiring

Plan mode invokes agents during name-only, interview, draft, and review phases.
Once [`03-aider-patch-agent.md`](./03-aider-patch-agent.md) introduces
`AiderAgent`, plan phases must instantiate it from `modes.plan.agentOrder`
and pass explicit file scope into `Agent.run` so aider receives `--file` /
`--read` arguments analogous to patch mode.

Plan prompts stay unchanged; scope is supplied structurally via
`AgentRunOptions.patchScope` (same shape as parsed `## Patch scope`, built by
the harness — not read from Markdown).

Depends on **03** (`aider` registered and `AiderAgent` implemented).

## Decisions

- Each plan phase computes a deterministic `PatchScope` from the active spec
  directory (`spec/<name>/`, repo-relative paths):
  - **Name-only** and **Interview**: `editable` is exactly
    `spec/<name>/intent.md`; `readOnly` empty unless the phase explicitly adds
    read-only paths later.
  - **Draft** and **Review**: `editable` uses the directory convention from
    subspec **04**: `spec/<name>/` with trailing slash so nested markdown files
    are editable without enumerating filenames before draft creates them.
  - `outOfScope` string empty unless future prompts require fixed guidance text.
- Pass the computed scope on **every** plan-phase `agent.run(...)` invocation,
  even when the agent ignores it (`claude`, `codex`, `cursor`, `opencode`). Keep
  branching minimal.
- Extend each plan phase's local `createAgent` helper with an `aider` branch
  mirroring [`src/modes/patch/run.ts`](../../src/modes/patch/run.ts). Prefer a
  small shared helper under `src/modes/plan/` only if duplication becomes
  unmaintainable during implementation — avoid speculative abstraction.
- Do **not** relax [`src/modes/plan/boundary.ts`](../../src/modes/plan/boundary.ts):
  writes remain confined under `spec/<name>/`; scope passed to aider must stay
  consistent with that boundary.

## Patch scope

### Editable

- src/modes/plan/draft.ts
- src/modes/plan/interview.ts
- src/modes/plan/review.ts
- src/modes/plan/name-only.ts
- test/modes/plan/ (extend existing tests or add focused modules as needed)

### Read-only context

- src/agents/aider.ts
- src/agents/types.ts
- src/modes/plan/boundary.ts
- src/modes/patch/run.ts

### Out of scope

- Do not change plan prompts (`prompts/*.md`) unless interview/tool-use behavior
  with aider proves incompatible with acceptance criteria below — then narrow
  prompt tweaks only with updated tests.
- Do not change patch-mode run wiring except imports/types shared verbatim.

## Task checklist

- Wire `PatchScope` construction per phase (shared helper acceptable).
- Ensure each phase passes `{ cwd, patchScope }` into `agent.run`.
- Add regression tests that mock/stub argv or spy `AiderAgent` construction so
  plan phases supply expected editable paths for interview vs draft/review.
- Confirm behavior matches boundary enforcement:
  intent-only phases scope only `intent.md`; tree phases scope `spec/<name>/`.

## Acceptance criteria

- [ ] Name-only, interview, draft, and review phases resolve `modes.plan`
      entries through the same agent factory shape as today, including `aider`.
- [ ] Each phase passes harness-built `patchScope` into `Agent.run` with the
      editable paths described above (`intent.md` vs `spec/<name>/`).
- [ ] No plan phase invokes aider without non-empty **editable** scope (matches
      adapter precondition from **03**).
- [ ] Tests cover scope construction or argv-equivalent assertions for at least
      one intent-only phase and one tree-wide phase.

## Verification

- Run `bun run typecheck`.
- Run `bun test`.

## Documentation updates

- None in this slice; **05** owns user-facing docs.
