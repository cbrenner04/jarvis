---
name: v2-src-directory-layout
---

# v2/src directory layout

## Problem

`v2/src/` has outgrown the Phase 0 flat scaffold. Roughly fifty source files
sit at the root; only `ipc/` and `testing/` are subdirectories. The layout no
longer reflects the boundaries already documented in `v2/docs/v2-architecture.md`:

- host-agnostic execution library vs thin hosts (CLI, daemon, TUI)
- orchestration persistence (state store, observability log) vs work product
  (git worktree, spec files)
- IPC transport vs daemon run-control orchestration

Flat root makes ownership unclear, encourages cross-layer imports, and will get
worse as review-debate, workflow runner, and telemetry consumers land.

## Scope

- Introduce a deliberate `v2/src/` directory layout aligned with v2
  architecture layers.
- Move existing modules and co-located tests into the new layout with no
  behavior change.
- Pin import-direction rules so library code cannot depend on hosts.
- Update durable doc path citations (`v2/docs/**`, `bin/jarvis`, package scripts)
  that hard-pin `v2/src/<file>` locations.

## Out of scope

- Refactoring logic, splitting oversized files, or renaming public types/APIs
  beyond what moves require.
- New features, new persistence columns, or workflow-runner work.
- A parallel `v2/test/` tree — tests stay co-located beside the code they cover.
- Biome import-boundary enforcement beyond what already exists for `shared/**`;
  document rules first, automate only if a follow-up seed proves worthwhile.

## Decisions (seed-level)

### Organize by architectural role, not filename prefix

Group modules by the responsibility described in `v2-architecture.md`, not by
shared `tui-` / `daemon-` / `write-` prefixes. Prefixes are implementation
artifacts; directories should answer "which layer owns this?"

### Layer targets (starting inventory)

These are the domains present today — the plan may name directories differently,
but every file must land in exactly one domain:

| Domain | Role | Current modules (indicative) |
| --- | --- | --- |
| **Execution library** | Host-agnostic write loop, single-step runner, worktree materialization, invocation failure taxonomy | `write-loop*`, `write*`, `step-runner*`, `write-prompt*`, `external-worktree*`, `invocation-failure` |
| **Persistence library** | Injectable durable stores separate from hosts | `state-store*`, `log-stream*` |
| **IPC transport** | Length-prefixed framing, client/server — already `ipc/` | keep and extend in place |
| **Daemon host** | Process lifecycle, run-control handler factories, list/wait wire parsing | `daemon*`, `daemon-entrypoint`, `run-operator-error*` |
| **TUI host** | Ink views, daemon client adapters, monitor/log-follow entry | `tui-*` |
| **CLI host** | Argument parsing, exit mapping, host wiring | `cli*` |
| **Test support** | Shared injectable fixtures — already `testing/` | keep and extend in place |

Future behaviors (review-debate, workflow runner, telemetry capture) should
slot into new domains under the same role-based rule, not back into the root.

### Import direction

Allowed dependency flow (higher may import lower; never the reverse):

```text
CLI / daemon / TUI hosts
  → execution library, persistence library, ipc/, shared/
execution library
  → persistence library, shared/
persistence library
  → shared/ only
ipc/
  → shared/ only (no execution or host imports)
testing/
  → anything (test-only)
```

Hosts must not become libraries — if shared wiring grows, extract downward into
execution or persistence, not sideways into another host.

### Stable entrypoints

External callers pin these paths today:

- `bin/jarvis` → `v2/src/cli.ts`
- `daemon-lifecycle` default spawn → `daemon-entrypoint.ts` beside lifecycle code

Either keep both entry files at `v2/src/` root, or update every caller in the
same change set. Do not leave a stale hard-coded path.

### Co-location and moves

- Each moved module keeps its `*.test.ts` / `*.test.tsx` / `*.sandbox-unrunnable.test.ts`
  beside it.
- Prefer `git mv` so history follows; update relative imports only.
- No barrel `index.ts` re-export layers unless a host entry truly needs one —
  direct imports keep dependency graphs visible.

### Documentation updates

- `v2/docs/v2-architecture.md` — add a **Source layout** section mapping
  domains to directories and import rules (one durable home; link from other
  docs, do not duplicate).
- `v2/docs/v2-vision.md` — replace the flat `v2/src/*.test.ts` note with the
  co-located-by-domain convention.
- `v2/docs/v2-build-order.md` — update Phase 0 scaffold wording if it still
  describes a flat root.
- Per-domain docs (`daemon-host.md`, `write-behavior.md`, `shared-step-runner.md`,
  `state-store.md`, `test-writing.md`) — fix `v2/src/<file>` citations only;
  no prose rewrites beyond path updates.
