# 04 - Docs and prerequisites

## Problem

The flag choices need to be discoverable so future contributors know why
each agent module passes them and what posture jarvis assumes.

## Decisions

- README documents the `safe-edits` posture once, in the Agents section,
  with one line per provider naming the flags jarvis injects.
- The agent table in the README adds the new flags to each row's "CLI
  invoked" column so the documented invocation matches the code.

## Tasks

- [ ] Update the Agents table in `README.md` so each row shows the full
      argv jarvis spawns, including the new permission flags.
- [ ] Add a short "Permission posture" subsection under Agents that names
      `safe-edits`, summarises what is and is not allowed without prompting,
      and points readers at `spec/2026-05-11-permissions/` for the rationale.
- [ ] Note that jarvis never passes any provider's "bypass everything"
      flag and that users who need that should run the CLI directly.

## Acceptance criteria

- `README.md` lists the new flags next to each agent.
- A reader who searches the repo for "acceptEdits", "workspace-write", or
  "--force" finds both the README mention and the agent module that uses
  the flag.
