# 00 — CLI wait run-completion

Thin CLI over the daemon `wait` RPC: block until the next invocation boundary
(quiescent edge), print the resolve payload, exit with outcome-kind codes for
shell composition. One `wait` call resolves once per boundary — not lifecycle join.

## Prerequisites

- Merged daemon `wait` RPC:
  `v2/spec/2026-06-30T03-06-16Z-daemon-wait-run-completion-2/`.

## Decisions

- `jarvis run wait <run-id>` closes intent command-tree deferral — rules out
  top-level `jarvis wait` and `--wait` on an existing verb.
- Invocation-boundary resolve per call — rules out lifecycle-terminal wording in
  operator docs; fleet scripts loop `wait` until exit `0` or inspect stdout
  `runStatus` / `resumable`.
- Transport-only over IPC `wait` — rules out local terminal detection, log
  follow filtering, or `list` polling.
- One long-running `wait` RPC per invocation — rules out opening a log stream or
  multiplexed multi-run wait.
- Stdout is one minified JSON line (`JSON.stringify` default), newline-terminated;
  omit absent daemon keys — rules out pretty-printed multi-line output and `null`
  placeholders.
- Present `loopOutcomeKind` wins over `runStatus` for exit mapping — rules out
  non-zero exit when `loopOutcomeKind` is `complete` regardless of `runStatus`.
- Exit mapping extends `jarvis write` when `loopOutcomeKind` is present; wait-only
  `runStatus`-only fallbacks `3` (`failed`) and `4` (`killed`) when loop fields
  are omitted — rules out claiming full write parity and rules out always exiting
  `0` on any terminal resolve.
- `loopOutcomeKind` mapping: `complete` → `0`; `invocation_failure` → `2`;
  `budget-exhausted` → `5`; all other present kinds → `1`.
- `loopOutcomeKind` omitted: `runStatus` `failed` → `3`; `killed` → `4`; other
  durable terminal statuses → `1`.
- Connection and RPC preflight errors reuse existing run-control stderr/exit `1`
  contract — rules out local reclassification of daemon guards.
- Co-located CLI tests inject IPC client fakes — rules out live-daemon-only
  coverage for this slice.

## Task checklist

- Add `jarvis run wait <run-id>` parsing; extend run-control usage text.
- Wire through injectable IPC client: one `wait` request, block until correlated
  response, print JSON result to stdout.
- Map daemon result to exit code per decisions above.
- Pass through `invalid_params` and `unknown_run` as `<code>: <message>` on
  stderr, exit `1`.
- Co-locate tests: blocking wait until resolve, immediate quiescent resolve,
  exit-code matrix (`complete`, `blocked`, `budget-exhausted`,
  `invocation_failure`, `failed` without loop fields, `killed` without loop
  fields, other `runStatus`-only terminal), RPC error pass-through, unavailable
  daemon, malformed success payload.
- Update operator and architecture docs per Documentation updates.

## Acceptance criteria

- [ ] `jarvis run wait <run-id>` sends one IPC `wait` request with `{ runId }`, blocks until the correlated response arrives, prints one minified JSON line (newline-terminated) with `runStatus` and only present optional fields (`loopOutcomeKind`, `iterationsConsumed`, `resumable`), and does not open a log stream or poll `list`.
- [ ] On an in-progress run, injected IPC client does not receive the `wait` response until the simulated next invocation boundary resolves.
- [ ] On an already-quiescent run (e.g. `paused` or `budget-exhausted` with present `loopOutcomeKind`), `jarvis run wait <run-id>` returns immediately with the correct non-zero exit for that outcome.
- [ ] `jarvis run wait <run-id>` exits `0` when the daemon result includes `loopOutcomeKind: "complete"`, including when `runStatus` would otherwise imply a non-zero code.
- [ ] `jarvis run wait <run-id>` exits `1` when `loopOutcomeKind` is `blocked`, `contract_miss`, `paused`, or `progress`.
- [ ] `jarvis run wait <run-id>` exits `2` when `loopOutcomeKind` is `invocation_failure`.
- [ ] `jarvis run wait <run-id>` exits `5` when `loopOutcomeKind` is `budget-exhausted`, or when `loopOutcomeKind` is omitted and `runStatus` is `budget-soft-stopped`.
- [ ] `jarvis run wait <run-id>` exits `3` when `loopOutcomeKind` is omitted and `runStatus` is `failed`.
- [ ] `jarvis run wait <run-id>` exits `4` when `loopOutcomeKind` is omitted and `runStatus` is `killed`.
- [ ] `jarvis run wait <run-id>` exits `1` when `loopOutcomeKind` is omitted and `runStatus` is another durable terminal status (e.g. `completed` or `blocked`).
- [ ] `jarvis run wait` with missing run ID prints run-control usage (including `wait`) to stderr and exits `1`.
- [ ] `jarvis run wait` with empty-string run ID forwards to the daemon, prints `<code>: <message>` on stderr for `invalid_params`, and exits `1`.
- [ ] `jarvis run wait <run-id>` passes through daemon `invalid_params` and `unknown_run` as `<code>: <message>` on stderr and exits `1`.
- [ ] `jarvis run wait <run-id>` exits `1` and prints a terse connection error when the daemon socket is unavailable.
- [ ] `jarvis run wait <run-id>` exits `1` and prints `invalid daemon response` on stderr when the daemon success payload is malformed.
- [ ] `v2/docs/write-behavior.md` documents `jarvis run wait <run-id>`: invocation-boundary resolve (loop until exit `0` for lifecycle success; non-zero does not imply non-resumable), input, minified JSON stdout shape, exit-code mapping with `loopOutcomeKind` precedence, RPC/connection errors.
- [ ] `v2/docs/v2-architecture.md` cross-links operator `jarvis run wait` to the daemon `wait` verb under Observability or Orchestration API (one sentence; no duplicate wire contract).
- [ ] `v2/docs/v1-behaviors.md` has a `[v2 additive]` entry for `jarvis run wait` exit semantics under Completion/exit codes.
- [ ] Existing `v2/src/cli.test.ts` coverage for `jarvis write` and other run-control verbs stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — add `jarvis run wait <run-id>` to the run-control
  table: invocation-boundary resolve semantics, input, minified JSON stdout shape,
  exit-code mapping (`loopOutcomeKind` precedence), RPC/connection errors.
- `v2/docs/v2-architecture.md` — cross-link operator `jarvis run wait` to the
  daemon `wait` verb under Observability or Orchestration API (one sentence; no
  duplicate wire contract).
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry for `jarvis run wait` exit
  semantics under Completion/exit codes.
