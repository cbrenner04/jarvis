# 00 - `jarvis triage` command + CLI wiring

## Problem

There is no command today that inspects a worktree's state. When `jarvis
run` bails on a dirty worktree, the user reconstructs the situation by
hand from `git status`, `gh pr view`, the spec file, and whatever they
can find in `~/.jarvis/sessions/`. This subspec lands the command shell —
argument parsing, project resolution, worktree enumeration, and the
empty section scaffolding. Section content is filled in by subspec 01.

## Decisions

- New file `src/commands/triage.ts` exporting `triageCommand(opts)`.
  Mirrors the shape of `cleanupCommand` in `src/commands/cleanup.ts`:
  takes `{ projectRoot, io, config }`, returns `number` exit code,
  reads from `<projectRoot>/.worktree/`.
- CLI wiring in `src/cli.ts`: `jarvis triage [worktree-name]`. Reuses the
  same project resolution path as `run` and `cleanup` so `--repo` /
  `--cwd` work the same way. Project resolution failures exit non-zero
  with the existing preflight messages.
- No-arg form: enumerate `readdirSync(.worktree)` (filter `.keep`),
  print a header row plus one line per worktree:
  `<name>  <dirty|clean>  <ahead/behind>  <PR state or "no PR">  <spec X/Y>`.
  Each field degrades to `-` if its source is unavailable (e.g. no spec
  marker, no upstream branch).
- Named form: resolve `<worktree-name>` to `<projectRoot>/.worktree/<name>`.
  Exit non-zero with `unknown worktree: <name>` if the directory does
  not exist. Otherwise print the drill-down (subspec 01 fills the
  sections; this subspec leaves stubs that print section headers and
  `(pending)`).
- Exit codes: `0` on successful inspection (even for dirty worktrees);
  `1` on usage error (unknown worktree, project resolution failure);
  `2` reserved for unexpected internal failures (caught exceptions in
  the section gatherers — surfaced as a section error rather than
  aborting the whole report, but the overall exit goes to 2).
- No interactive prompts. No mutation. `readlineSync` from the cleanup
  IO is not used.

## Implementation hints

- Lift `hasDirtyStatus` from `src/commands/cleanup.ts` into a shared
  helper if convenient — both commands need it. Otherwise duplicate it
  for now and let a later refactor consolidate.
- The no-arg listing should run all per-worktree gatherers in parallel
  where practical (`gh pr view` is the slow one). Cap concurrency at 4
  to avoid hammering `gh`.
- Each per-worktree gatherer must be wrapped so one failure (e.g. a
  worktree that is missing its checkout) does not abort the whole list;
  emit `-` for that field and continue.

## Task Checklist

- [ ] Create `src/commands/triage.ts` with `triageCommand` and a
  `TriageIo` type (`stdout`, `stderr`; no `readlineSync`).
- [ ] Wire `jarvis triage` and `jarvis triage <name>` in `src/cli.ts`,
  reusing project resolution.
- [ ] Implement no-arg enumeration with the one-line summary format
  above. Stub fields can return `-` until subspec 01.
- [ ] Implement named-form scaffold: validate the worktree exists, print
  section headers (`Identity`, `Git`, `Spec`, `PR`, `Session log`,
  `Suggested next moves`), each currently followed by `(pending)`.
- [ ] Tests in `src/commands/triage.test.ts` (or parallel structure to
  existing command tests) covering: unknown worktree name → exit 1;
  empty `.worktree/` → "no worktrees" message and exit 0; one worktree
  present → header + one summary line; named form prints all six
  section headers.
- [ ] Help text updated in whatever surface lists commands.

## Acceptance criteria

- [ ] `jarvis triage` with no arg prints a header and one summary line
  per worktree under `.worktree/`, exits 0.
- [ ] `jarvis triage <name>` for an existing worktree prints the six
  section headers and exits 0.
- [ ] `jarvis triage <unknown>` exits 1 with `unknown worktree: <unknown>`.
- [ ] Project resolution failures surface with the same messages as
  `jarvis run` / `jarvis cleanup`.
- [ ] No worktree, file, branch, or remote state is modified by any
  invocation.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- `README.md`: add `jarvis triage` to the command list with a one-line
  description.
- `docs/worktrees-and-commits.md`: brief note that `jarvis triage` is
  the read-only inspector for dirty/orphaned worktrees.
