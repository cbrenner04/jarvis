# 00 — CLI wait run-completion

Thin CLI over the daemon `wait` RPC: block until the next invocation boundary,
print the terminal payload, exit with outcome-kind codes for shell composition.

## Decisions

- `jarvis run wait <run-id>` — rules out top-level `jarvis wait` (no run-control
  namespace) and daemon-scoped verbs; pins deferred command-tree choice from
  intent as first external consumer.
- Transport-only over IPC `wait` — rules out local terminal detection, log
  follow filtering, or `list` polling.
- One long-running `wait` RPC per invocation — rules out opening a log stream or
  multiplexed multi-run wait.
- Stdout is one compact JSON object mirroring the daemon `wait` result fields —
  rules out tab-separated rows and raw IPC frames.
- Exit codes align with `jarvis write` when `loopOutcomeKind` is present;
  `runStatus` fills gaps when loop fields are omitted — rules out always exiting
  `0` on any terminal resolve and rules out a separate outcome taxonomy.
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
  fields), RPC error pass-through, unavailable daemon.
- Update operator and architecture docs per Documentation updates.

## Acceptance criteria

- [ ] `jarvis run wait <run-id>` sends one IPC `wait` request with `{ runId }`, blocks until the correlated response arrives, prints one compact JSON line with `runStatus` and present `loopOutcomeKind` / `iterationsConsumed` / `resumable` fields, and does not open a log stream or poll `list`.
- [ ] `jarvis run wait <run-id>` exits `0` when the daemon result includes `loopOutcomeKind: "complete"`.
- [ ] `jarvis run wait <run-id>` exits `1` when `loopOutcomeKind` is `blocked`, `contract_miss`, `paused`, or `progress`.
- [ ] `jarvis run wait <run-id>` exits `2` when `loopOutcomeKind` is `invocation_failure`.
- [ ] `jarvis run wait <run-id>` exits `5` when `loopOutcomeKind` is `budget-exhausted` or `runStatus` is `budget-soft-stopped` with no contradicting success kind.
- [ ] `jarvis run wait <run-id>` exits `3` when `loopOutcomeKind` is omitted and `runStatus` is `failed`.
- [ ] `jarvis run wait <run-id>` exits `4` when `loopOutcomeKind` is omitted and `runStatus` is `killed`.
- [ ] `jarvis run wait` with missing run ID prints run-control usage to stderr and exits `1`.
- [ ] `jarvis run wait <run-id>` passes through daemon `invalid_params` and `unknown_run` as `<code>: <message>` on stderr and exits `1`.
- [ ] `jarvis run wait <run-id>` exits `1` and prints a terse connection error when the daemon socket is unavailable.
- [ ] Existing `v2/src/cli.test.ts` coverage for `jarvis write` and other run-control verbs stays green.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — add `jarvis run wait <run-id>` to the run-control
  table: input, JSON stdout shape, exit-code mapping, RPC/connection errors.
- `v2/docs/v2-architecture.md` — cross-link operator `jarvis run wait` to the
  daemon `wait` verb in Interface/Steering (one sentence; no duplicate wire
  contract).
- `v2/docs/v1-behaviors.md` — `[v2 additive]` entry for `jarvis run wait` exit
  semantics under Completion/exit codes.
