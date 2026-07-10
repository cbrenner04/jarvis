# First-workflow walkthrough doc

## Problem

A configured new user has no guided path to run one v2 workflow end-to-end. The
CLI surface exists (`jarvis run start`, `jarvis tui`, `jarvis run list|log|
pause|resume|kill|wait`) but there is no single happy-path walkthrough tying
them together from a spec to a draft PR. Add that doc.

Net-new documentation. Not a full command reference — one narrated happy path
with the real commands and their real output.

## Decisions

- Durable home is `v2/docs/first-workflow-walkthrough.md` — operator/workflow behavior belongs in `v2/docs/` (documentation-standard placement policy), not a README or the spec tree.
- One happy-path narrative, not a per-command reference — a reference would duplicate the usage strings in `v2/src/cli.ts` and rot against them.
- Start section uses the real `jarvis run start` flags (`--project-root --project --branch --base --spec --artifact [--max-iterations]`); rules out inventing a `jarvis run start <spec>` positional form that does not exist.
- Draft-PR section describes the per-commit `Jarvis-Agent:` trailer (`completion-commit.ts`) and the minimal `Spec: <path>` PR body (`completion-publisher.ts`), not a rendered v1-style attribution footer; rules out overstating v1 parity the v2 publisher does not yet produce.
- Steering section shows `pause`/`kill`/`wait` as working and documents that resuming an *ad-hoc* (`run start`) paused run currently returns `not_implemented` (daemon-host.md); rules out showing a pause→resume happy path that fails.
- No `v2/docs/v1-behaviors.md` update — this is net-new docs, not a change to existing behavior.

## Task checklist

- Write `v2/docs/first-workflow-walkthrough.md` covering: prerequisites (daemon startable, agents/models configured), start, observe, steer, output.
- Verify every jarvis command and flag shown against `v2/src/cli.ts` before ticking.
- Cross-link related v2 docs (`daemon-host.md`, `workflow-runner.md`); do not duplicate their content.

## Acceptance criteria

- [ ] `v2/docs/first-workflow-walkthrough.md` exists and walks one happy path in order: configure (agents/models + daemon startable) → start a run against a spec → observe → steer → draft-PR output.
- [ ] Every `jarvis` command and flag shown in the doc matches a real command in `v2/src/cli.ts` (no invented commands or flags).
- [ ] The start section starts the run with `jarvis run start` and its actual required flags (`--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`) and shows that it prints a run ID.
- [ ] The observe section shows live state via `jarvis tui` and the structured log via `jarvis tui log <run-id>` and `jarvis run log <run-id>`, plus `jarvis run list`.
- [ ] The steer section shows `jarvis run pause <run-id>`, `jarvis run kill <run-id>`, and `jarvis run wait <run-id>`, and states that resuming an ad-hoc paused run is not yet implemented (returns `not_implemented`) rather than showing it as a working step.
- [ ] The output section describes the completed run's draft PR: the per-commit `Jarvis-Agent:` attribution trailer, the `Spec: <path>` PR body, and how to find the branch and PR.
- [ ] The doc cross-links `v2/docs/daemon-host.md` and `v2/docs/workflow-runner.md` and does not restate their contents.

## Documentation updates

- New file `v2/docs/first-workflow-walkthrough.md` is the deliverable.
- No `v2/docs/v1-behaviors.md` change (net-new docs, no existing behavior changed).
