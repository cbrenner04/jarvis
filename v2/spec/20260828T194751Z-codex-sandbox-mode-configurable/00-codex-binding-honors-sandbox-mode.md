# Codex bindings honor a resolved sandbox mode

## Primary implementation surface

`shared/invocation/agents.ts` (`runCodexBinding` / `buildArgv`)

## Problem

The shared Codex adapter hardcodes `--sandbox workspace-write` plus `-c approval_policy="on-request"` on every `codex exec`, so callers cannot align the subprocess with their ambient trust. `read-only`/`workspace-write` deny the writes and CoreSimulator XPC connection an Xcode/simulator test command needs, and the on-request escalation is dead under non-interactive `codex exec`.

## Decisions

- `runCodexBinding` accepts a resolved sandbox mode, one of `read-only`, `workspace-write`, or `danger-full-access`; `buildArgv` emits `--sandbox <mode>`. Rules out arbitrary CLI values crossing the adapter boundary.
- An omitted mode resolves to `workspace-write`. Rules out changing v1 or existing caller trust.
- `read-only` and `workspace-write` retain the `-c approval_policy="on-request"` arguments. Rules out changing sandboxed invocation behavior.
- `danger-full-access` omits the approval-policy arguments (Codex is already unsandboxed; the escalation is dead). Rules out retaining a dead escalation path.
- The shared adapter accepts a resolved value and does not read v2 configuration. Rules out a shared→v2 dependency.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` pins the omitted-mode argv as `--sandbox workspace-write` with the `-c approval_policy="on-request"` arguments retained.
- [ ] `shared/invocation/agents.test.ts` proves `danger-full-access` reaches `--sandbox` and removes both approval-policy arguments; it fails against the pre-change hardcoded argv.
- [ ] `shared/invocation/agents.test.ts` proves `read-only` reaches `--sandbox` and retains the approval-policy arguments.
- [ ] `shared/invocation/agents.test.ts` test `Codex sandbox argv retains approval policy only when sandboxed` proves treating `danger-full-access` as sandboxed retains the approval-policy arguments and turns the scoped test red; its `// @mutate` directive lives inside that named test body. `shared/invocation/agents.test.ts` — `Codex sandbox argv retains approval policy only when sandboxed`; Mutation checkpoint:
- [ ] `bun run typecheck` and `bun run test:v1` + `bun run test:v2` + `bun run test:integration:v2` pass (shared surface).

## Documentation updates

- `v2/docs/v1-behaviors.md` — shared Codex sandbox behavior: mode-driven argv with a `workspace-write` default, approval-policy dropped only for `danger-full-access`, and v1's unchanged default.
