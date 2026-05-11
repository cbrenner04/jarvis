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
- Complete exactly one unchecked task per iteration. A "task" is a single
  `- [ ]` checkbox in the spec you were given. Flip exactly one box from
  `[ ]` to `[x]` and then stop, even if:
  - the task was small or felt trivial,
  - the next unchecked task looks related, easy, or "obviously next,"
  - the spec is an index file whose tasks are links to subspecs (each link
    is still one task — do one subspec, then stop and return control to
    jarvis; do not continue down the list).
  Jarvis will re-invoke you for the next iteration. Do not pre-empt that.
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
