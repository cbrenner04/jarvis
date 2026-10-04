---
name: agent-shell-access-is-explicitly-bounded
---

# Agent shell access is an explicit, bounded design, not a bypass

> Hold: owner sign-off required before `plan`; the seed was marked not dispatchable and this split records the proposed direction only.

## Problem

An unrestricted Jarvis shell still permits direct Git commands, scripts invoking Git, and direct `.git` writes; moving the shell behind the tool server alone does not enforce the canonical boundary, and command-name blocklists are insufficient.

## Decisions

- Shell access is designed explicitly: which operations stay available for tests and debugging, how subprocesses of allowed commands are confined, and how denied operations (Git mutation, out-of-scope writes) are refused without an escape hatch.
- Plan must decide the enforcement mechanism (filesystem and process restrictions vs allowlisted commands) and its interaction with vendor sandboxes.

## Prerequisites

- Role-scoped tool serving (delivered by: harness-tool-server-serves-role-scoped-tools)
- Native tools disabled at launch (delivered by: vendor-launch-disables-native-tools-or-refuses-role)
- Scoped file tools (delivered by: scoped-file-tools-refuse-out-of-scope-writes)
- Gate tool (delivered by: gate-tool-takes-gate-slot-lease)

## Acceptance criteria

- [ ] `shell-tool.test.ts`: an allowed command runs bounded in the worktree; a direct Git mutation, a script invoking Git mutation, and a direct `.git` write are each refused or fail without effect; fails against current code.
- [ ] `bun run typecheck` and `bun run test:agent` pass.

## Documentation updates

- `docs/v2-architecture.md` — shell boundary, authorization at execution, test and debugging access.

## Primary implementation surface

- `src/execution/shell-tool.ts` (new)
