# 03 — Patch-mode rules

## Problem

Jarvis injects rules into every loop prompt by concatenating `rules/style.md`
and `rules/safety.md`. The split is category-based and the content is thinner
than what the agent actually needs. In practice Jarvis only operates in one
mode today (patch mode: execute the active spec, nothing more), and the rules
should reflect that mode directly. Future plan mode will get its own file when
it lands; the current split should not be preserved out of habit.

## Decisions

- Collapse `rules/style.md` and `rules/safety.md` into a single
  `rules/patch-mode.md`.
- Do not create a shared `common.md` yet. Defer that factoring until plan mode
  is designed and the real shared set is known.
- `rules/patch-mode.md` is the only rules file consumed by the loop prompt for
  now.
- Keep rules terse and imperative. They are injected inline into every agent
  invocation.
- Convert "stop and ask" guidance from the source prompts into
  "append a `## Blocker` and stop", matching Jarvis's non-interactive loop.
- Do not add a "restate repo / files / step" preamble. That belongs in
  interactive prompts, not a one-shot loop.

## Behavior

### New file: `rules/patch-mode.md`

Contents:

```markdown
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
```

### Prompt builder update

`src/prompt.ts` currently reads `style.md` and `safety.md` and joins them.
Update it to read `patch-mode.md` only. The surrounding loop prompt text
(`Inspect the target repo...`, `Read the spec at ...`, `Follow these Jarvis
rules:`, `Pick the single most important unchecked task and complete it.`)
does not change.

### File removals

- Delete `rules/style.md`.
- Delete `rules/safety.md`.

## Tasks

- [x] Add `rules/patch-mode.md` with the contents above.
- [x] Update `src/prompt.ts` so `jarvisRules()` reads `patch-mode.md` only.
- [x] Delete `rules/style.md` and `rules/safety.md`.
- [x] Update any prompt-builder tests that assert on the injected rules text.
- [x] Update `AGENTS.md` if it references `rules/style.md` or
  `rules/safety.md` by name.

## Acceptance criteria

- `rules/patch-mode.md` exists with the contents above.
- `rules/style.md` and `rules/safety.md` no longer exist.
- `buildPrompt` produces a prompt whose rules section equals the trimmed
  contents of `rules/patch-mode.md`.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- `AGENTS.md`: replace the "compact rules from rules/style.md and
  rules/safety.md" phrasing in the loop-prompt sketch with a single reference
  to `rules/patch-mode.md`.
