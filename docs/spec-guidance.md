# Spec Guidance for Agents

This file is stable guidance for agents that need to create or work from
Jarvis specs.

Jarvis specs should use an index-routed shape for normal work:

```text
spec/<feature>/index.md
spec/<feature>/00-first-task.md
spec/<feature>/01-second-task.md
```

The `index.md` file is the routing file. It contains a GitHub-style task list
whose items link to atomic subspec files:

```md
# <Feature>

repo: /absolute/path/to/target-repo

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

Run Jarvis against the index:

```sh
jarvis run spec/<feature>/index.md
```

Specs may live anywhere, but every runnable spec must include `repo:` with an
absolute path to the target repository. Jarvis reads that field first and uses
it as the working repository path.

## Land the spec before implementing it

New specs must be merged to `main` before any implementation work on them
begins. Jarvis runs against the spec file on disk, so a spec that only exists
on a feature branch will drift from whatever the implementation branch
eventually does. The workflow is:

1. Create the spec on a branch and open a PR with **only** the spec files.
2. Get the spec PR merged.
3. Start a separate run/branch (typically via `jarvis run`) for the
   implementation work.

Do not bundle spec authoring and implementation in the same PR.

## Subspecs

Each subspec should be independently implementable and testable. A good subspec
has:

- the problem or behavior it covers
- decisions needed to keep the work bounded
- a task checklist for that one slice of work
- acceptance criteria
- required documentation updates

Keep subspecs atomic. If one unchecked item requires unrelated code paths,
multiple product decisions, or verification that cannot run independently, split
it into separate numbered subspec files and link each one from `index.md`.

## Agent Workflow

When an agent is asked to work from a Jarvis spec:

1. Read the target repo guidance first.
2. Read `spec/<feature>/index.md`.
3. Pick the single most important unchecked subspec from the index.
4. Read that subspec before editing.
5. Complete only that subspec.
6. Run the verification required by the subspec and repo guidance.
7. Check only that subspec's checkbox in `index.md`.

Do not check unrelated index items. Do not keep working through the rest of the
index after one subspec is complete.

## Non-index spec handling

Passing a non-index spec to `jarvis run`, such as `spec/<feature>/01-task.md`,
prompts for one of these actions:

- `s`: switch to a sibling `index.md` and run the normal loop from there (only
  offered when a sibling `index.md` exists)
- `e`: exit without running an agent

Normal implementation work should run from `index.md`.
