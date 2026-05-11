# 13 — Installation docs

Document how to install jarvis on a personal machine.

## Tasks

- [ ] Add an "Installation" section to `README.md` covering:
  - Prereqs: Bun installed; one of `claude` / `codex` / `cursor` available on `PATH`.
  - Clone this repo to a stable path (e.g. `~/code/jarvis`).
  - `bun install` inside it.
  - Symlink `bin/jarvis` onto `PATH`, e.g. `ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis`.
  - Verify with `jarvis help`.
- [ ] Add a "Quickstart" section showing:
  - `cd <target-repo>`
  - `jarvis init`
  - Author a spec at `spec/<name>.md` with `- [ ]` task items.
  - `jarvis run spec/<name>.md`.

## Acceptance criteria

- A new reader can go from zero to a running loop using only the README.

## Documentation updates

- This subspec *is* the documentation update.
