# 02 - Interactive disambiguation prompt

## Problem

Resolution (subspec 01) can produce zero matches or more than one match
against registered projects. The user wants an interactive picker rather than
a hard error, but only when a human is actually present.

## Decisions

- Trigger conditions:
  - Spec has no `repo:` line and is not inside any registered project or
    git checkout.
  - Spec `repo:` URL/slug loose-matches more than one registered project.
  - `--repo <value>` is given but matches more than one registered project.
- Prompt lists registered projects with index, name, root, and origin (or
  `(no origin)`), then reads a single line from stdin: project number, project
  name, or `q` to quit.
- TTY detection: `process.stdin.isTTY === true`. If not a TTY (CI, piped
  input, log redirection), jarvis exits 1 with a message naming the relevant
  candidates and instructing the operator to use `--repo <name>`.
- Prompt result is used for this run only and never persisted.
- A `q`, EOF, or empty line exits 1 without running an agent.

## Task Checklist

- [ ] Implement the prompt as a small helper around stdin/stdout.
- [ ] Wire the resolution flow to call the prompt on the trigger conditions.
- [ ] Tests covering: zero-match prompt, multi-match prompt (URL),
  multi-match prompt (`--repo`), non-TTY exits 1.

## Acceptance criteria

- [x] When stdin is a TTY and resolution is ambiguous or empty, jarvis prints
  a numbered list of registered projects and reads one line from stdin.
- [x] Selecting a valid index or project name proceeds with that project for
  the run; nothing is persisted to config.
- [x] `q`, EOF, or empty input exits 1 without invoking any agent.
- [x] When stdin is not a TTY, jarvis does not prompt; it exits 1 with a
  message naming the candidates and suggesting `--repo <name>`.
- [x] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/run-loop.md`: document the prompt behavior, both trigger paths, and
  the non-TTY behavior.
