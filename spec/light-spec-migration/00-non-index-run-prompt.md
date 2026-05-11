# 00 — Non-index run prompt

## Problem

When `jarvis run` is pointed at a spec whose basename is not `index.md`, it
currently asks "Run <SPEC_PATH> for one agent iteration anyway? [y/N]" and, on
yes, runs a single iteration against the supplied spec. This escape hatch
encourages bypassing the index-routed workflow and gives users no path to fix
a non-compliant spec.

The non-index branch should instead steer the user toward compliance.

## Decisions

- Remove the "run anyway" option entirely. There is no path that runs a
  non-index spec directly through the normal loop.
- The new prompt offers up to three choices, each on its own line:
  - `s` — switch to the sibling `index.md` (only shown when one exists in the
    same directory as the supplied spec) and proceed with a normal run against
    that index.
  - `m` — migrate the supplied spec in place to the index-routed shape (handed
    off to the migration run mode in subspec 01).
  - `e` — exit without running.
- Default on empty input is `e` (exit). Unrecognized input re-prompts once,
  then exits.
- The prompt text and parsing live in `src/commands/run.ts`. The migration
  invocation itself is implemented in subspec 01; this subspec is responsible
  only for the branching and for calling into whichever entry point subspec 01
  exposes.
- Sibling-index detection uses `existsSync` on
  `<dirname(specPath)>/index.md`. If the supplied spec *is* itself in a
  directory whose `index.md` is the supplied spec, that case is impossible
  here because the basename check already excluded it.

## Behavior

Suggested prompt text when a sibling index exists:

```text
<SPEC_PATH> is not an index spec.
  [s] switch to ./index.md and run normally
  [m] migrate this spec to the index-routed shape
  [e] exit
Choice [e]:
```

When no sibling index exists, drop the `[s]` line.

On `s`: re-resolve `specPath` to the sibling `index.md` and continue into the
existing index-spec code path. No additional confirmation.

On `m`: hand off to the migration run mode (subspec 01). After it returns,
`jarvis run` exits with that mode's exit code. The normal loop does not run
afterward.

On `e` or empty: return exit code 0 without running anything.

## Tasks

- [ ] Replace the existing non-index `confirmRun` block in
  `src/commands/run.ts` with the three-way prompt described above.
- [ ] Detect sibling `index.md` and conditionally include the `[s]` option.
- [ ] Wire the `s` branch to swap `specPath` to the sibling and fall through
  to the existing index loop.
- [ ] Wire the `m` branch to the migration entry point (placeholder import is
  acceptable here; subspec 01 will land the implementation).
- [ ] Wire `e` and unrecognized input to clean exit.

## Acceptance criteria

- Pointing `jarvis run` at a non-index spec inside a registered project no
  longer offers "run anyway".
- When `<dir>/index.md` exists, the prompt offers `s` and choosing it runs the
  index normally.
- When `<dir>/index.md` does not exist, the prompt omits `s`.
- Choosing `e` or pressing enter exits 0 without invoking any agent.
- Choosing `m` invokes the migration entry point exactly once.
- `bun run typecheck` and `bun test` pass. Existing tests that asserted the
  old `[y/N]` prompt are updated to the new shape.

## Documentation updates

- None in this subspec; doc changes land in subspec 02 once both behaviors are
  implemented.
