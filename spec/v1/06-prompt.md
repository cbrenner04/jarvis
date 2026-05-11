# 06 — Prompt builder

A pure function that produces the per-iteration prompt string given a spec path.

## Tasks

- [x] `src/prompt.ts` exports `buildPrompt(specPath: string): string`.
- [x] Output is the minimal template:

  ```
  Read README.md.
  Read the spec at <SPEC_PATH>.
  Pick the single most important task and complete it.
  Follow the rules linked from the README.
  ```

  with `<SPEC_PATH>` substituted. Path is passed through verbatim — no resolution, no quoting beyond what the agent CLI invocation requires (handled in 07).
- [x] Tests: snapshot or exact-string match for a sample input.

## Acceptance criteria

- Pure function, no I/O, no dependencies on config or filesystem.
- Test passes.

## Documentation updates

- None (internal module). If the prompt template ever changes, it must be reflected in `AGENTS.md` "The loop prompt" section.
