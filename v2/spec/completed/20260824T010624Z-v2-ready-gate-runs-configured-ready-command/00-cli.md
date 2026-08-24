# CLI

## Problem

v2's completion ready gate is hardcoded: `createDefaultRunReadyGate` (`v2/src/execution/ready-finalize.ts:895`) spawns `bun` with `["run", "ready"]` and stamps the literal `"bun run ready"` onto every `ReadyGateError`. `projects.<key>.readyCommand` is read only by v1 (`v1/src/modes/patch/completion-pipeline.ts:271`); v2 reads only `fixCommand` (`readProjectFixCommand`, `v2/src/commands/workflow.ts:257`). Every v2 run on a project whose `package.json` has no `ready` script therefore red-gates with `Script not found "ready"` at completion, after the whole implement loop has already run.

Gate-failure classification is keyed off the same literal (`error.command !== "bun run ready"`, `ready-finalize.ts:449`), so simply swapping the spawned command would silently downgrade every configured-command failure to unclassified `ready_gate_failed` — no out-of-scope attribution, no repair allowset.

## Decision ledger

- The resolved command rides on the ready-gate call — `ReadyFinalizeInput.readyCommand` → the `ReadyGate` options bag → `createDefaultRunReadyGate` — not captured in the factory closure; rules out `createReadyFinalizer({ readyCommand })`, which would leave the write-loop hop unobservable (tests that stub `readyFinalizer` never reach the factory) and would force a second resolution seam when terminal publication's gate is eventually wired.
- One resolver, `resolveReadyGateCommand(readyCommand?)` in `ready-finalize.ts`, returns both the spawn tokens and the display string; the gate, `ReadyGateError.command`, and the classification key all read it; rules out tokenizing at the gate and comparing the raw config string at the classifier, where `"npm  run  verify"` would spawn fine and then fail the classification key on whitespace.
- Classification keys off `resolveReadyGateCommand(scope?.readyCommand).display`, carried on `ReadyGateScopeInput`; rules out both the literal compare (downgrades every configured-command failure) and dropping the compare (would misclassify the required-integration gate's `ReadyGateError`, which reuses the same class with a `test:integration:v2` command).
- Resolution happens at CLI write-step admission (`v2/src/commands/workflow.ts`), mirroring `fixCommand`; rules out reading machine config inside the daemon-hosted gate, which has no project key at that seam.
- The daemon-side intent-resume stub (`inertResumeWriteLoopInput`, `workflow-runner.ts:3345`) resolves `readyCommand` the same way it already resolves `fixCommand`; rules out leaving that finalization path on the hardcode for the sake of decision-1 purity — that path has no CLI admission and the `fixCommand` precedent already reads config there.
- `readProjectReadyCommand` mirrors `readProjectFixCommand` exactly: a non-string or blank value reads as absent and falls back to `bun run ready`; rules out a v2-side validation error, which would duplicate `v1/src/config.ts`'s validation on a config v2 does not own.
- `JARVIS_READY_TIER` / `JARVIS_READY_TEST_SCOPE` are still derived and passed to the child for a configured command; rules out branching the env on the override, which would make jarvis's own tiering vanish if the repo ever configured a wrapper command.
- Terminal publication is untouched — see the index scope note; its production gate is a throwing stub, so it has no `bun run ready` to override.

## Task checklist

- Add `readProjectReadyCommand` to `v2/src/config/machine-config-loader.ts` beside `readProjectFixCommand`, plus tests in `machine-config-loader.test.ts`.
- Stamp `readyCommand` onto write steps in `v2/src/commands/workflow.ts`; resolve it in `inertResumeWriteLoopInput` (`workflow-runner.ts`).
- Add `readyCommand?: string` to `WriteLoopInput` and to the `CompletionPublicationSeams` pick; pass it into the ready-finalizer input in `runReadyFinalizer`; pass it into the classification scope from `classifyReadyGatePublishFailure`.
- Add `resolveReadyGateCommand`, `ReadyFinalizeInput.readyCommand`, the `ReadyGate` option, and the classification key change in `v2/src/execution/ready-finalize.ts`.
- Add the gate, error-command, and classification tests to `ready-finalize.test.ts`; the admission tests to `commands/workflow.test.ts`; the finalizer-input hop test to `write-loop.test.ts`.
- Update `v2/docs/install-and-config.md` and `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] A ready-gate test whose finalizer input carries `readyCommand: "npm run verify"` asserts the gate spawns `npm` with `["run", "verify"]` and never `bun run ready`; it fails against the pre-fix hardcode.
- [x] A sibling ready-gate test with no `readyCommand` on the input asserts the gate still spawns `bun` with `["run", "ready"]`.
- [x] A classification test asserts a failure whose `ReadyGateError.command` is the run's configured ready command, with a scope carrying that same `readyCommand`, still reaches `ready_gate_out_of_scope` on out-of-allowset failing paths; it fails against the pre-fix literal compare, which returns `ready_gate_failed`.
- [x] A classification test asserts a required-integration failure (`ReadyGateError` with command `bun run test:integration:v2`) against a scope whose `readyCommand` is a configured command still classifies `ready_gate_failed` — the negative case proving the command guard suppresses non-gate errors rather than the guard never firing.
- [x] A `run workflow implement` admission test with `projects.demo.readyCommand` configured asserts the sent write step carries that `readyCommand`; it fails against the pre-fix admission, which stamps only `fixCommand`.
- [x] An admission test asserts a project with no `readyCommand`, and one whose `readyCommand` is whitespace-only, both send a write step with no `readyCommand` property.
- [x] `v2/src/execution/ready-finalize.test.ts` — `runs the configured ready command as the ready gate`; Keystone checkpoint: its test body carries `// @mutate v2/src/execution/ready-finalize.ts "resolveReadyGateCommand(gateOptions?.readyCommand)" -> "resolveReadyGateCommand(undefined)"`, reverting the gate to baseline `bun run ready` semantics, and the mutation turns that regression RED while the fallback test stays green.
- [x] `v2/src/execution/ready-finalize.test.ts` — `classifies a configured-command failure as out of scope`; Mutation checkpoint: its test body carries `// @mutate v2/src/execution/ready-finalize.ts "error.command !== resolveReadyGateCommand(scope?.readyCommand).display" -> "error.command !== \"bun run ready\""`, restoring the literal classification key, and the mutation turns that test RED.
- [x] `v2/src/execution/ready-finalize.test.ts` — `keeps a required-integration failure unclassified`; Mutation checkpoint: its test body carries `// @mutate v2/src/execution/ready-finalize.ts "if (error.timedOut || error.command !== resolveReadyGateCommand(scope?.readyCommand).display) {" -> "if (error.timedOut) {"`, dropping the command guard so a non-gate error classifies as out of scope, and the mutation turns that test RED.
- [x] `v2/src/config/machine-config-loader.test.ts` — `readProjectReadyCommand ignores a blank or non-string readyCommand`; Mutation checkpoint: its test body carries `// @mutate v2/src/config/machine-config-loader.ts "typeof readyCommand === \"string\" && readyCommand.trim() !== \"\"" -> "typeof readyCommand === \"string\""`, letting a whitespace-only value through as a gate command, and the mutation turns that test RED.
- [x] `v2/src/commands/workflow.test.ts` — `stamps the configured readyCommand onto write steps`; Mutation checkpoint: its test body carries `// @mutate v2/src/commands/workflow.ts "...(readyCommand !== undefined ? { readyCommand } : {})," -> "...({}),"`, dropping the admission carry, and the mutation turns that test RED.
- [x] `v2/docs/install-and-config.md` — the project registry section documents `projects.<key>.readyCommand` and `projects.<key>.fixCommand` as non-empty-string overrides read at write-step admission, with the `bun run ready` / `bun run fix` defaults, that a blank or non-string value reads as absent, that the configured command is what appears in gate-failure output and the repair prompt, and that terminal-publication settlement does not consume them.
- [x] `v2/docs/v1-behaviors.md` — an entry records that v2 now honors the per-project `readyCommand` v1 already honored (v1 source: `v1/src/modes/patch/completion-pipeline.ts`), naming the v2 seams (`v2/src/commands/workflow.ts` admission, `v2/src/execution/ready-finalize.ts` gate) and the remaining delta: v2 resolves it at CLI admission and carries it on the write step, and v2's terminal-publication gate does not consume it.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — per-project `readyCommand` / `fixCommand` override rows, defaults, blank-reads-as-absent, and where the resolved command surfaces.
- `v2/docs/v1-behaviors.md` — v2 now honors the per-project ready command, with the admission-seam and terminal-publication deltas.

## Implementer notes

- Suggested resolver and gate shape, keeping each anchor quotable by one single-line `@mutate` directive:

  ```ts
  const DEFAULT_READY_COMMAND = "bun run ready";

  /** Spawn tokens plus the display string used for `ReadyGateError.command`, gate-failure
   *  classification, and the repair prompt's `GATE_COMMAND`. */
  export function resolveReadyGateCommand(readyCommand?: string): { head: string; args: string[]; display: string } {
    const tokens = (readyCommand ?? DEFAULT_READY_COMMAND).trim().split(/\s+/);
    const head = tokens[0] ?? "bun";
    const args = tokens.slice(1);
    return { head, args, display: [head, ...args].join(" ") };
  }
  ```

  In `createDefaultRunReadyGate`, resolve once per call — `const command = resolveReadyGateCommand(gateOptions?.readyCommand);` — then spawn `runner.runAsync(command.head, command.args, worktreePath, { env, signal: gateOptions?.signal, processGroup })` and throw `new ReadyGateError(command.display, …)` on both failure paths. The existing group-mode test (`spawns the ready gate in group mode bound to the run signal`) quotes the old `["run", "ready"], worktreePath, { env, … }` spawn line in its directive; update that directive to the new call text in the same change.
- `ReadyGate`'s third parameter is the existing options bag: add `readyCommand?: string | undefined` beside `signal` and `onGroupId`. `createReadyFinalizer` forwards `input.readyCommand` into both the ready-gate call and (for classification callers) nothing else — required integration keeps its own scope command.
- `classifyReadyGateFailure` reads the key from the scope: `ReadyGateScopeInput` gains `readyCommand?: string`, and `classifyReadyGatePublishFailure` (`write-loop.ts:2726`) takes the command as a parameter from `args.readyCommand` at both call sites (`write-loop.ts:2943`, `write-loop.ts:3209`) and puts it on the scope object.
- `CompletionPublicationSeams` is a `Pick<WriteLoopInput, …>` (`write-loop.ts:2553`) — add `"readyCommand"` there so `runReadyFinalizer` can read `seams.readyCommand`; `publishCompletionArtifacts` is already called with the full `WriteLoopInput`.
- The `commands/workflow.test.ts` fixture write step uses `worktree.projectName: "demo"` (`v2/src/testing/cli-test-helpers.ts`), so admission tests must register `projects.demo` in the written machine config; the `review-role timeout resolution` describe block's `sent`-frame pattern is the model for asserting the dispatched step.
- Gate tests follow the `createReadyFinalizer({ asyncSubprocessRunner: mockRunner, ghReadyFlip: async () => {} })` pattern already in `ready-finalize.test.ts`; the mock runner records `(cmd, args)` so the configured-command and fallback assertions are direct.
- For the out-of-scope classification test, use a configured command that still emits jarvis's ready step records (for example `bun run ready:ci`) and reuse the existing `describe("ready gate untouched-path classification")` output fixtures — `selectTerminalFailingPaths` parses those records, and a command that emits none legitimately classifies `ready_gate_failed`.
