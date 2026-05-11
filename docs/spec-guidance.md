# Spec Guidance for Agents

This file is stable guidance for agents that need to create, migrate, or work
from Jarvis specs.

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

- [ ] [00 - First task](./00-first-task.md)
- [ ] [01 - Second task](./01-second-task.md)
```

Run Jarvis against the index:

```sh
jarvis run spec/<feature>/index.md
```

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

## Migrating Flat Specs

A flat spec is a single Markdown file with implementation tasks directly in one
checklist. Migrate it to the index-routed shape before normal Jarvis runs:

1. Create a directory for the spec, such as `spec/<feature>/`.
2. Create `spec/<feature>/index.md`.
3. Move or split the flat checklist into numbered subspec files.
4. Add index checklist links to those subspec files.
5. Keep each subspec independently implementable and testable.
6. Preserve useful context from the original flat spec in the new index or
   subspec files.

If the flat spec contains many unrelated tasks, split by independently
verifiable behavior rather than by file name or implementation layer.

## Direct Spec Escape Hatch

Passing a non-index spec to `jarvis run`, such as
`spec/<feature>/01-task.md`, is an escape hatch. Jarvis asks for confirmation
and, if confirmed, runs that direct spec for one successful agent iteration.

Use this only for deliberate one-off work on a specific subspec. It is not the
normal workflow for creating or completing a feature spec.
