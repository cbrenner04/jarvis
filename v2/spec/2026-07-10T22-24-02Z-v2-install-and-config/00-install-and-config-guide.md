# Fresh-machine install and config guide

Net-new operator doc: a procedural walkthrough from a fresh checkout to a running,
verified v2 daemon. It stitches already-shipped behavior (install, `jarvis config`,
`jarvis daemon`, on-disk config) into one onboarding narrative and cross-links the
reference docs that own each contract, rather than duplicating them.

## Behavior / problem

A new machine has no v2 install guide. The command, config, and daemon contracts
are documented piecemeal (`agent-model-config.md`, `write-behavior.md`,
`daemon-host.md`) but nothing walks a reader from `git clone` to a confirmed-up
daemon. This subspec adds `v2/docs/install-and-config.md` covering: prerequisites,
clone + symlink alongside `jarvis1`, config bootstrap/edit, daemon start/check, and
recovery from a missing/invalid config.

## Decisions

- Home is a new `v2/docs/install-and-config.md` — operator/workflow behavior belongs in `v2/docs/` per documentation-standard.md; a spec-tree file would be self-referential.
- Cross-link the owning reference docs; do not restate their contracts — duplication rots.
- Document only shipped behavior; name no config knob absent from committed v2 code.
- Two config layers stated explicitly: per-machine `~/.jarvis/config.json` vs machine-independent committed `config/machines/<name>.json` — a reader who conflates them edits the wrong file.
- Document the `machineProfile` hand-edit: no `config` subcommand writes it, so a CLI-only walkthrough silently omits the step that makes the machine runnable.
- Recovery maps errors to their surfacing command (`config show` vs `jarvis run`) rather than one flat load-time bucket — the two paths fail at different times and conflating them mis-documents when a `machineProfile` error appears.
- Net-new doc, changes no existing behavior → no `v1-behaviors.md` update.

## Source of truth (verify the guide against these)

- Binaries: `package.json` `bin` (`jarvis` → `v2/src/cli.ts`, `jarvis1` → `v1/src/cli.ts`); wrappers `bin/jarvis`, `bin/jarvis1`.
- `jarvis config` show/path/set-agents: `v2/src/cli.ts` `runConfigCommand`; contract in `v2/docs/agent-model-config.md`.
- `jarvis daemon` start/status/stop: `v2/src/cli.ts` `runDaemonCommand`, `v2/src/daemon/daemon-lifecycle.ts`; contract in `v2/docs/write-behavior.md` (Daemon CLI).
- Config-load errors (surface at `config show`): `v2/src/config/machine-config-loader.ts` (`readMachineConfigDocument`, `validateMachineConfigAgents`, `readMachineConfigFile`).
- Model-resolution errors (surface at `jarvis run`): `resolveMachineProfile` (missing `machineProfile`) in `machine-config-loader.ts`; profile-not-found + profile-missing-`models` in `machine-profile-loader.ts`.
- Daemon-start errors: `v2/src/daemon/daemon-lifecycle.ts` (already-running, readiness timeout, missing PID-file dir); paths in `v2/src/paths.ts`.

## Task checklist

- [ ] Add `v2/docs/install-and-config.md` with the sections below.
- [ ] Prerequisites: Bun, authenticated `gh`, ≥1 agent CLI on PATH; clone + symlink `jarvis` alongside `jarvis1`.
- [ ] Config bootstrap/edit via `jarvis config show|path|set-agents`, plus the required `machineProfile` hand-edit no command writes.
- [ ] Two config layers and where each lives on disk.
- [ ] Daemon start/status/stop and the up-confirmation step.
- [ ] Recovery mapping each error to its surfacing command: config-load errors at `config show`, model-resolution errors (`machineProfile`-missing, profile-not-found, profile-missing-`models`) at `jarvis run`, and daemon-start failures.
- [ ] Cross-links to `agent-model-config.md`, `write-behavior.md`, `daemon-host.md`.

## Acceptance criteria

- [ ] `v2/docs/install-and-config.md` exists and reads as a fresh-checkout→running-daemon walkthrough ordered: prerequisites → install → config → daemon → recovery.
- [ ] Prerequisites section names Bun, an authenticated `gh`, and at least one agent CLI on PATH, and shows cloning + symlinking the `jarvis` binary alongside the existing `jarvis1` shim, matching the two `bin` entries in `package.json` (`jarvis` → `v2/src/cli.ts`).
- [ ] The `jarvis config` section documents `show`, `path`, and `set-agents` with outputs matching committed behavior: `show` prints the machine `agents` one name per line (newline-separated, not JSON) or `No machine agent override configured.`; `path` prints the fully-expanded absolute config path (`<home>/.jarvis/config.json`, no tilde substitution — `~/.jarvis/config.json` may appear only as annotated shorthand); `set-agents <csv>` takes bare comma-separated agent names (rejects a segment containing `:`), replaces the full `agents` array while preserving other top-level keys, and prints the landed order as JSON (`{"agents":[...]}`).
- [ ] The guide documents that reaching a runnable machine requires a hand-edit of `~/.jarvis/config.json` to set the `machineProfile` key: no documented command writes it (`set-agents` writes only `agents`; `show`/`path` are read-only), yet role→model resolution hard-requires it, so the CLI command set alone cannot produce a configured machine.
- [ ] The guide distinguishes the two config layers: the per-machine `~/.jarvis/config.json` (agent fallback order, `machineProfile` selector, `projects` registry) and the machine-independent, repo-committed role→model store at `config/machines/<name>.json` (a `models` map keyed agent → role → `rungs`), so the reader knows which file each edit touches.
- [ ] The `jarvis daemon` section documents `start`, `status`, and `stop` with the committed stdout/exit-code contract (`start` → `{"pid":...,"socketPath":...}`; `status` → `running`/`stopped` with exit 0 when running, 1 when stopped; `stop` → `stopped`) and states that `jarvis daemon status` reporting `running` (exit 0) is the up-confirmation step.
- [ ] The guide lists the on-disk locations (`~/.jarvis/config.json`, `~/.jarvis/daemon.sock`, `~/.jarvis/daemon.pid`, and the committed `config/machines/` profiles).
- [ ] The recovery section maps each error to the command that surfaces it, not one flat "load-time" bucket. Config-load errors surface at `jarvis config show`: machine config is not a JSON object, invalid JSON in the machine config, and the `agents` validation failures (non-array/empty-array/non-string-entry/empty-string-entry/duplicate). Model-resolution errors surface later at `jarvis run`: missing `machineProfile` key, a machine profile not found (typo'd profile name → `Machine profile '<name>' not found at <path>`), and a machine profile missing its required `models` key.
- [ ] The recovery section covers the daemon-start failures an operator hits: daemon already running on the socket (re-run of `jarvis daemon start`), the readiness timeout, and a missing PID-file directory.
- [ ] Every command, flag, config key, and path stated in the guide resolves to committed v2 behavior in `v2/src/` — the guide invents no config knob absent from source. (Manual)
- [ ] The guide cross-links `agent-model-config.md` (config/model store), `write-behavior.md` (daemon CLI), and `daemon-host.md` (socket transport) instead of restating their contracts.

## Documentation updates

- New file `v2/docs/install-and-config.md` is itself the deliverable.
- No `v1-behaviors.md` change: net-new doc, no existing behavior altered.
