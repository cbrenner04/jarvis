# v2 ready gate runs the configured project ready command

repo: cbrenner04/jarvis

- [ ] [00 - CLI](./00-cli.md)
- [ ] [01 - Execution loop](./01-execution-loop.md)

Scope note: one behavior, one PR — resolve `projects.<key>.readyCommand` at CLI write-step admission, carry it across IPC on the write step, and spawn it (instead of `bun run ready`) at the completion ready gate, with gate-failure classification, `ReadyGateError.command`, and the repair prompt's `GATE_COMMAND` all keyed off the resolved command. Touched surfaces: `v2/src/config/machine-config-loader.ts`, `v2/src/commands/workflow.ts`, `v2/src/execution/workflow-runner.ts`, `v2/src/execution/write-loop.ts`, `v2/src/execution/ready-finalize.ts`. No v1 change; no config-schema change (`readyCommand` is already validated in `v1/src/config.ts`).

Premise correction: the intent's second decision assumes `terminalAction: ready|merge` publication spawns `bun run ready` today. It does not. `createExecuteTerminalPublication`'s production default is `defaultRunReadyGate` (`v2/src/execution/terminal-publication.ts:190`), which throws `runReadyGate seam is required for ready and merge terminal actions`; only tests supply a gate, and no production call site constructs the executor with one (`executeTerminalPublication` at `terminal-publication.ts:220` takes the throwing default). There is no hardcode to override there, so nothing is threaded into terminal publication here. Instead the resolved command rides on the ready-gate call site's options bag rather than a factory closure, so wiring a real terminal gate later passes it the same way with no second resolution seam. Deferred to first consumer: terminal publication's `readyCommand` — pin when that gate is actually wired. That the documented terminal `ready` settlement gate (`v2/docs/workflow-runner.md:414`) is unreachable in production is a separate defect, out of scope here.
