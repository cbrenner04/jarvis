# First-workflow walkthrough doc

## Problem

A configured new user has no guided path to run one v2 workflow end-to-end. The
CLI surface exists (`jarvis daemon start`, `jarvis run start`, `jarvis tui`,
`jarvis run list|log|pause|resume|kill|wait`) but there is no single happy-path
walkthrough tying them together from a spec to a draft PR. Add that doc.

Net-new documentation. Not a full command reference — one narrated happy path
with the real commands and their real output.

## Decisions

- Durable home is `v2/docs/first-workflow-walkthrough.md` — operator/workflow behavior belongs in `v2/docs/` (documentation-standard placement policy), not a README or the spec tree.
- One happy-path narrative, not a per-command reference — a reference would duplicate the usage strings in `v2/src/cli.ts` and rot against them.
- Walkthrough starts with `jarvis daemon start` — `run start` connects to the daemon and fails if it isn't running, and nothing auto-starts it; rules out the "daemon startable" prerequisite standing in for actually starting it.
- Start section uses the real `jarvis run start` flags (`--project-root --project --branch --base --spec --artifact [--max-iterations]`); rules out inventing a `jarvis run start <spec>` positional form that does not exist.
- `--artifact <path>` is explained as the completion-artifact file the workflow's write step must produce (the completion contract), with a concrete suggested value; rules out listing the required flag without telling a first-timer what to pass.
- Ad-hoc (`run start`) is the chosen path *because* it maximizes truthful coverage of live steering: `pause`/`kill` work only on ad-hoc runs (workflow-started runs reject both with `run_not_active`, per `daemon.ts`); rules out the workflow path, which cannot demonstrate live pause/kill.
- Steering section shows `pause`/`kill`/`wait` as working and documents that resuming an *ad-hoc* (`run start`) paused run currently returns `not_implemented` (`daemon.ts`, `daemon-host.md`); rules out showing a pause→resume happy path that fails. Note the limit is ad-hoc-specific — workflow paused write steps do resume.
- Draft-PR section describes the *single* completion commit — one `jarvis: complete run` commit carrying a `Spec: <path>` body and one `Jarvis-Agent: <agent>` trailer (`completion-commit.ts`), published as a draft PR with a `Spec: <path>` body (`completion-publisher.ts`); rules out claiming per-commit attribution or a rendered v1-style footer the v2 publisher does not produce.
- Prerequisites list authenticated `gh` and an `origin` GitHub remote — completion publishing runs `gh auth status` and shells `gh pr create --draft` / `git push -u origin` (`completion-publisher.ts`); without them the happy path ends in a publish failure, not a PR.
- No `v2/docs/v1-behaviors.md` update — this is net-new docs, not a change to existing behavior.

## Task checklist

- Write `v2/docs/first-workflow-walkthrough.md` covering: prerequisites, daemon start, start, observe (states + commands), steer, draft-PR output.
- Verify every jarvis command and flag shown against `v2/src/cli.ts` before ticking.
- Cross-link related v2 docs (`daemon-host.md`, `workflow-runner.md`); do not duplicate their content.

## Acceptance criteria

- [x] `v2/docs/first-workflow-walkthrough.md` exists and walks one happy path in order: prerequisites → start the daemon → start a run against a spec → observe → steer → draft-PR output.
- [x] Every `jarvis` command and flag shown in the doc matches a real command in `v2/src/cli.ts` (no invented commands or flags).
- [x] The doc lists prerequisites: agents/models configured, authenticated `gh`, and an `origin` GitHub remote.
- [x] The doc runs `jarvis daemon start` before `jarvis run start` and explains `run start` connects to the daemon.
- [x] The start section starts the run with `jarvis run start` and its actual required flags (`--project-root`, `--project`, `--branch`, `--base`, `--spec`, `--artifact`), explains what value to pass for `--artifact`, and shows that it prints a run ID.
- [x] The doc describes the observable run states a user sees (running → paused → completed / failed / blocked / killed).
- [x] The observe section describes what the reader sees in the full-screen `jarvis tui` (its panes / live-state view, not a pasted transcript) and shows the structured log via `jarvis tui log <run-id>` and `jarvis run log <run-id>`, plus `jarvis run list`.
- [x] The steer section shows `jarvis run pause <run-id>`, `jarvis run kill <run-id>`, and `jarvis run wait <run-id>`, and states that resuming an *ad-hoc* (`run start`) paused run is not yet implemented (returns `not_implemented`) rather than showing it as a working step.
- [x] The output section describes the completed run's draft PR: the single `jarvis: complete run` completion commit carrying a `Spec: <path>` body and one `Jarvis-Agent:` trailer, the draft PR's `Spec: <path>` body, and how to find the branch and PR.
- [x] The doc cross-links `v2/docs/daemon-host.md` and `v2/docs/workflow-runner.md` and does not restate their contents.

## Documentation updates

- New file `v2/docs/first-workflow-walkthrough.md` is the deliverable.
- No `v2/docs/v1-behaviors.md` change (net-new docs, no existing behavior changed).
