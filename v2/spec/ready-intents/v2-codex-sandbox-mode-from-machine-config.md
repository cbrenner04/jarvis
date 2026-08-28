---
name: v2-codex-sandbox-mode-from-machine-config
---

# V2 write and implement Codex invocations use the configured sandbox mode

## Primary implementation surface

v2/src/daemon/daemon.ts

## Prerequisites

- Shared Codex bindings accept `read-only`, `workspace-write`, or `danger-full-access`, default to `workspace-write`, and omit the approval-policy arguments only for `danger-full-access`.

## Problem

V2 cannot select the shared Codex binding's sandbox mode from top-level `~/.jarvis/config.json`, so trusted toolchains such as Xcode and CoreSimulator remain unusable in Codex write and implement lanes.

## Decisions

- Store `codexSandboxMode` as a top-level key in `~/.jarvis/config.json`; `v2/src/config/machine-config-loader.ts` owns parsing and resolution; rules out coupling operator trust to a repo-committed model profile.
- `machine-config-loader.ts` resolves missing, non-string, or unrecognized `codexSandboxMode` to `workspace-write`; rules out config drift silently widening trust or blocking existing runs.
- Resolve the mode once when v2 assembles production workflow bindings and capture it for Codex binding creation across fresh and rehydrated write/implement invocation paths; rules out per-adapter reads and resume reverting to the default.
- Top-level `codexSandboxMode` applies to v2 write and implement Codex workflow bindings; rules out fresh and rehydrated paths using different trust.
- No per-project override or command flag is added; rules out depending on the non-functional v2 per-project config read tracked by #3026.

## Acceptance criteria

- [ ] `v2/src/config/machine-config-loader.test.ts` fails against the baseline, then proves its top-level `codexSandboxMode` resolver returns recognized values unchanged while absent, non-string, and unrecognized values resolve to `workspace-write`.
- [ ] A v2 write/implement invocation-path test sets top-level `codexSandboxMode` to `danger-full-access` via `machine-config-loader.ts` and proves the resolved mode reaches the shared Codex binding.
- [ ] A v2 binding-rehydration test proves the configured mode survives the daemon/JSON boundary rather than reverting to `workspace-write`.
- [ ] `v2/src/config/machine-config-loader.test.ts` test `unrecognized Codex sandbox modes fall back to workspace-write` proves mutating the accepted-mode guard to admit an unrecognized value turns the scoped test red. `v2/src/config/machine-config-loader.test.ts` — `unrecognized Codex sandbox modes fall back to workspace-write`; Mutation checkpoint:

## Documentation updates

- `v2/docs/agent-model-config.md` — top-level config key, loader-owned resolution, accepted values, default, ambient-trust rationale, and #3026-gated per-project override.
- `v2/docs/v1-behaviors.md` — v2's write/implement config-driven Codex sandbox mode and v1's unchanged `workspace-write` default.
