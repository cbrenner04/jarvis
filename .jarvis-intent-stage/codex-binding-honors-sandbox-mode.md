---
name: codex-binding-honors-sandbox-mode
---

# Codex bindings honor a resolved sandbox mode

## Primary implementation surface

shared/invocation/agents.ts

## Prerequisites

## Problem

The shared Codex adapter hardcodes `workspace-write` plus an ineffective non-interactive approval policy, so callers cannot align the subprocess with their ambient trust.

## Decisions

- The shared binding accepts only `read-only`, `workspace-write`, or `danger-full-access`; rules out arbitrary CLI values crossing the adapter boundary.
- An omitted mode resolves to `workspace-write`; rules out changing v1 or existing caller trust.
- `read-only` and `workspace-write` retain `-c approval_policy="on-request"`; rules out changing sandboxed invocation behavior.
- `danger-full-access` omits the approval-policy arguments; rules out retaining a dead escalation path when Codex is already unsandboxed.
- The shared adapter accepts a resolved value and does not read v2 configuration; rules out a shared-to-v2 dependency.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` pins the omitted-mode argv as `--sandbox workspace-write -c approval_policy="on-request"`.
- [ ] `shared/invocation/agents.test.ts` fails against the baseline, then proves `danger-full-access` reaches `--sandbox` and removes both approval-policy arguments.
- [ ] `shared/invocation/agents.test.ts` proves `read-only` reaches `--sandbox` and retains the approval-policy arguments.

## Documentation updates

- `v2/docs/shared-invocation.md` — resolved Codex sandbox modes, default, and approval-policy argv behavior.
