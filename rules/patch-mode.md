# Patch Mode

Jarvis runs the underlying agent in patch mode: execute the active spec,
nothing more.

## Scope
- Modify only files listed in the active spec.
- Execute steps exactly as written. Do not add, remove, reorder, or
  reinterpret them.
- Do not read files beyond what the spec requires.
- Do not refactor unrelated code or introduce new abstractions.
- Do not operate across multiple repositories in a single iteration.
- Match existing style; do not reformat unrelated code.

## Per-iteration discipline
- Complete one unchecked task per iteration.
- Use the shell commands specified in the target repo's AGENTS.md; do not
  invent equivalents.
- Run the typecheck and test commands specified in AGENTS.md before marking a
  task done.
- Leave the working tree compiling.

## When to stop
- If anything is unclear, append a `## Blocker` section to the spec and stop.
- If an approach fails repeatedly, write the failure in the spec and stop.
- Do not add TODOs; put follow-up work in the spec.
- Before adding a dependency, record the decision in the spec and stop.
