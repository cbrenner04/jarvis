# `jarvis run workflow implement` CLI launch

Wire a `jarvis run workflow implement` subcommand that uses the builder from
[00](./00-build-implement-workflow-steps.md) to launch an `implement` run
through the daemon, so operators stop hand-assembling `WriteLoopInput`/`steps`
payloads for this case.

## Decisions

- Lives under the existing `jarvis run` command group (`run workflow implement`),
  alongside `run start`/`list`/`log`/etc., rather than a new top-level verb —
  it launches through the same daemon `start` RPC and run-control surface.
- Required flags: `--branch`, `--base`, `--spec`, `--artifact`. No
  `--project-root`, `--project`, or `--agents` flag — project comes from cwd
  (subspec 00), agents from machine config. Rules out re-exposing flags the
  intent says should no longer be operator-supplied.
- Sends `{ steps }` (not `{ input }`) to daemon `start`, matching the
  workflow-shaped branch already implemented in `handleWorkflowStart`.
- Out of scope (per intent): `plan`/`yolo` presets, PR lifecycle, TUI
  launcher, per-project workflow enablement.

## Task Checklist

- [ ] Add `run workflow implement` parsing (branch/base/spec/artifact flags)
      alongside the existing `run` subcommand dispatch in `v2/src/cli.ts`.
- [ ] `jarvis run workflow <unrecognized>` and bare `jarvis run workflow`
      fall through to the existing usage/command-not-found handling and
      exit nonzero, without contacting the daemon.
- [ ] On parse success, resolve cwd's registered project and build the
      workflow steps via subspec 00's builder, then send `{ steps }` to the
      connected daemon's `start` RPC.
- [ ] Missing/invalid flags print usage to stderr and exit `1` without
      contacting the daemon.
- [ ] A builder error result (unresolved cwd, config/role validation failure)
      prints the error to stderr and exits `1` without contacting the daemon.
- [ ] On daemon success, print the returned run ID to stdout and exit `0`,
      matching `jarvis run start`'s output shape.
- [ ] Daemon RPC/connection failures follow the same pass-through rules as
      `jarvis run start` (`<code>: <message>` to stderr, exit `1`).

## Acceptance criteria

- [x] Running `jarvis run workflow implement --branch <b> --base <ref> --spec <path> --artifact <path>`
      from a registered project's checkout starts a run and prints its run ID.
- [x] Running the same command from a directory outside any registered
      project fails with an actionable message and does not contact the daemon.
- [x] Omitting a required flag fails with usage output and does not contact
      the daemon.
- [x] Running `jarvis run workflow` with an unrecognized or missing preset
      name fails with usage/command-not-found output and does not contact
      the daemon.
- [x] `v2/src/cli.test.ts` daemon-RPC-failure and malformed-response cases
      (asserted today for `run start`) hold equally for `run workflow implement`.

## Documentation updates

- Add `jarvis run workflow implement` to the Run control CLI table and
  command list in `v2/docs/write-behavior.md`, noting which flags are
  per-run vs preset/machine-config-owned (per the intent's "thinner than
  `jarvis write`" decision).
