---
name: v2-codex-sandbox-mode-from-machine-config
---

# V2 Codex invocations use the machine sandbox mode

## Primary implementation surface

v2/src/daemon/daemon.ts

## Prerequisites

- Shared Codex bindings accept `read-only`, `workspace-write`, or `danger-full-access`, default to `workspace-write`, and omit the approval-policy arguments only for `danger-full-access`.

## Problem

V2 cannot select the shared Codex binding's sandbox mode from machine configuration, so trusted toolchains such as Xcode and CoreSimulator remain unusable in Codex workflow lanes.

## Decisions

- Store `codexSandboxMode` as a top-level key in `~/.jarvis/config.json`; rules out coupling operator trust to a repo-committed model profile.
- Missing, non-string, or unrecognized `codexSandboxMode` resolves to `workspace-write`; rules out config drift silently widening trust or blocking existing runs.
- Resolve the mode once when v2 assembles production workflow bindings and capture it for Codex binding creation across fresh and rehydrated write/implement invocation paths; rules out per-adapter reads and resume reverting to the default.
- The machine key applies to v2 Codex workflow bindings regardless of role; rules out implement-only trust behavior diverging from plan or review invocations.
- No per-project override or command flag is added; rules out depending on the non-functional v2 per-project config read tracked by #3026.

## Acceptance criteria

- [ ] `machine-config-loader.test.ts` fails against the baseline, then proves recognized values resolve unchanged while absent, non-string, and unrecognized values resolve to `workspace-write`.
- [ ] A v2 write/implement invocation-path test sets `codexSandboxMode` to `danger-full-access` in machine config and proves the resolved mode reaches the shared Codex binding.
- [ ] A v2 binding-rehydration test proves the configured mode survives the daemon/JSON boundary rather than reverting to `workspace-write`.

## Documentation updates

- `v2/docs/agent-model-config.md` — machine key, accepted values, default, ambient-trust rationale, and #3026-gated per-project override.
- `v2/docs/v1-behaviors.md` — v2's config-driven Codex sandbox mode and v1's unchanged `workspace-write` default.
