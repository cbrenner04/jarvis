# Start here

Orientation for newcomers: what jarvis is, which binary to use, v2 vocabulary, and where to read next. Design detail lives in linked docs — not duplicated here.

## What jarvis is

Jarvis is a TypeScript/Bun harness that drives a coding-agent CLI (`claude`, `codex`, `cursor`, …) against Markdown specs. It prepares the repo, invokes one configured CLI at a time, records what happened, and handles git/GitHub bookkeeping around each step. **It does not implement an agent itself.**

## Which binary to use

Two binaries coexist in this repo:

| Binary | Engine | Status |
| --- | --- | --- |
| `jarvis` | v2 | **Daily driver** — daemon, intent/plan/implement workflows, TUI, cleanup. |
| `jarvis1` | v1 | Maintenance-only fallback — kept green, no new investment. |

**Default to `jarvis`.** Reach for `jarvis1` only for the few surfaces v2 does not own yet (see the [v2 operator runbook](./operator-runbook.md) routing table).

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
2. **First run** — [`install-and-config.md`](./install-and-config.md), then the
   [`first-workflow-walkthrough.md`](./first-workflow-walkthrough.md) happy
   path.
3. **Go deeper** — operator reference in
   [`operator-runbook.md`](./operator-runbook.md); v1 fallback reference in
   [`v1/docs/`](../../v1/docs/).
