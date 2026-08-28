# V2 write/implement Codex invocations use the configured sandbox mode

## Primary implementation surface

`v2/src/config/machine-config-loader.ts` and the v2 write/implement binding-assembly path (`v2/src/daemon/daemon.ts`)

## Prerequisites

- Subspec 00 landed: the shared Codex binding accepts `read-only`/`workspace-write`/`danger-full-access`, defaults to `workspace-write`, and omits the approval-policy arguments only for `danger-full-access`. (Built on this same branch, in order.)

## Problem

V2 cannot select the shared Codex binding's sandbox mode, so trusted toolchains such as Xcode/CoreSimulator remain unusable in Codex write and implement lanes — the codex adapter is stuck at `workspace-write`.

## Decisions

- Store `codexSandboxMode` as a top-level key in `~/.jarvis/config.json`; `v2/src/config/machine-config-loader.ts` owns parsing and resolution. Rules out coupling operator trust to a repo-committed model profile.
- `machine-config-loader.ts` resolves a missing, non-string, or unrecognized `codexSandboxMode` to `workspace-write`. Rules out config drift silently widening trust or blocking existing runs.
- Resolve the mode once when v2 assembles production workflow bindings and thread it into Codex binding creation across both fresh and rehydrated write/implement invocation paths. Rules out per-adapter reads and resume reverting to the default.
- No per-project override or command flag. Rules out depending on the non-functional v2 per-project config read tracked by #3026.

## Acceptance criteria

- [ ] `v2/src/config/machine-config-loader.test.ts` proves its top-level `codexSandboxMode` resolver returns recognized values unchanged while absent, non-string, and unrecognized values resolve to `workspace-write`; it fails against the pre-change loader.
- [ ] A v2 write/implement invocation-path test sets top-level `codexSandboxMode` to `danger-full-access` and proves the resolved mode reaches the shared Codex binding.
- [ ] A v2 binding-rehydration test proves the configured mode survives the daemon/JSON boundary rather than reverting to `workspace-write`.
- [ ] `v2/src/config/machine-config-loader.test.ts` test `unrecognized Codex sandbox modes fall back to workspace-write` proves mutating the accepted-mode guard to admit an unrecognized value turns the scoped test red; its `// @mutate` directive lives inside that named test body. `v2/src/config/machine-config-loader.test.ts` — `unrecognized Codex sandbox modes fall back to workspace-write`; Mutation checkpoint:
- [ ] `bun run typecheck` and `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — the top-level `codexSandboxMode` key, loader-owned resolution, accepted values, `workspace-write` default, the `danger-full-access` ambient-trust rationale (parity with cursor `--force` / claude `acceptEdits`), and that per-project override is gated on #3026.
- `v2/docs/v1-behaviors.md` — v2's config-driven Codex sandbox mode for write/implement and v1's unchanged `workspace-write` default.
