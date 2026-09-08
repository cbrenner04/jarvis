# Start here

Orientation for newcomers: what jarvis is, which binary to use, v2 vocabulary, and where to read next. Design detail lives in linked docs — not duplicated here.

## What jarvis is

Jarvis is a TypeScript/Bun harness that drives a coding-agent CLI (`claude`, `codex`, `cursor`, …) against Markdown specs. It prepares the repo, invokes one configured CLI at a time, records what happened, and handles git/GitHub bookkeeping around each step. **It does not implement an agent itself.**

## One binary

`jarvis` is the only engine: daemon, intent/plan/implement workflows, pipelines, TUI, cleanup. The `v1/` tree is frozen — not compiled, tested, linted, or linked — and is a noop for contributors (see [`v1/README.md`](../../v1/README.md)).

## v2 vocabulary

v2 builds the harness from composable building blocks. At a user level:

- **Workflows** — ordered sequences of steps that accomplish a task (e.g. plan a
  spec, implement a subspec).
- **Behaviors** — loop primitives a step runs (`write`, `review`,
  `review-debate`).
- **Roles** — model-resolution keys bound to steps (`plan`, `implement`,
  `adversary`, …).

Definitions and the layered model live in [`v2/docs/`](./):

- [`v2-vision.md`](v2-vision.md) — guiding principles and constraints
- [`v2-architecture.md`](v2-architecture.md) — how workflows, behaviors, and
  roles fit together
- [`role-resolution.md`](role-resolution.md) — role taxonomy and step binding

## Next steps

1. **Install** — prerequisites and symlink setup in the
   [README Installation](../../README.md#installation) section.
2. **Set up and verify** — from the target repo's Git worktree root, run
   `jarvis init --profile <name>` to configure this machine and register the
   repo; it ends with a readiness report. Re-run with `--check` any time to
   verify readiness without writing. Full contract:
   [`install-and-config.md`](./install-and-config.md#jarvis-init).
3. **First run** — the
   [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md) happy
   path.
4. **Go deeper** — operator reference in
   [`operator-runbook.md`](./operator-runbook.md) and
   [`operator-practices.md`](./operator-practices.md).
