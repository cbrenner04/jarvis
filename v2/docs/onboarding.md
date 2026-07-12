# Start here

Orientation for newcomers: what jarvis is, which binary to use, v2 vocabulary,
and where to read next. Design detail lives in linked docs — not duplicated here.

## What jarvis is

Jarvis is a TypeScript/Bun harness that drives a coding-agent CLI (`claude`,
`codex`, `cursor`, …) against Markdown specs. It prepares the repo, invokes one
configured CLI at a time, records what happened, and handles git/GitHub
bookkeeping around each step. **It does not implement an agent itself.**

## Which binary to use

Two binaries coexist in this repo:

| Binary | Engine | Status |
| --- | --- | --- |
| `jarvis1` | v1 | **Daily driver** — plan, run, and prompt workflows today. |
| `jarvis` | v2 | Opt-in scaffold — answers `v2 not ready` or `--version` only. |

**Today the answer is always `jarvis1`.** The `jarvis` binary is an in-progress
v2 entry point. Nothing requires adopting it for daily work.

## v2 vocabulary (in progress)

v2 reworks the harness around composable building blocks. At a user level:

- **Workflows** — ordered sequences of steps that accomplish a task (e.g. plan a
  spec, implement a subspec).
- **Behaviors** — loop primitives a step runs (`write`, `review-debate`,
  `human`, …).
- **Roles** — model-resolution keys bound to steps (`plan`, `implement`,
  `adversary`, …).

Definitions and the layered model live in [`v2/docs/`](./):

- [`v2-vision.md`](v2-vision.md) — why and rollout constraints
- [`v2-architecture.md`](v2-architecture.md) — how workflows, behaviors, and
  roles fit together
- [`role-resolution.md`](role-resolution.md) — role taxonomy and step binding

v2 is opt-in and not ready for production use. Read these when you want the
direction; keep using `jarvis1` to do work today.

## Next steps

1. **Install** — prerequisites and symlink setup in the
   [README Installation](../../README.md#installation) section.
2. **First run** — register a repo and draft or run a spec via the
   [README Quickstart](../../README.md#quickstart).
3. **Go deeper** — v1 operator reference in [`v1/docs/`](../../v1/docs/); v2
   design reference in [`v2/docs/`](./). v2 dogfooding operators:
   [`operator-runbook.md`](./operator-runbook.md).
