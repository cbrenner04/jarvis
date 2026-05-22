# 00 — Runaway visibility and bounds

## Problem

`jarvis run` currently hides agent output on success and has no upper bound on
iterations. A real run on this spec's `index.md` produced 11 silent claude
iterations with no progress and burned most of a usage session before the user
interrupted it. From the operator's terminal the run was indistinguishable from
healthy work.

Three small changes make future runs observable and bounded, without changing
the index-routing design in 01–03.

## Decisions

- Print all agent stdout and stderr after every iteration, success or not.
  No filtering, no truncation. This may be revisited once index routing and
  patch-mode rules settle, but premature filtering is what hid the failure.
- Add a deterministic no-progress stop: if a successful agent iteration leaves
  the unchecked-task count unchanged, exit. The check uses the existing
  `countUnchecked` from `src/completion.ts`; no heuristics.
- Add an iteration cap, configurable via CLI flag and config file. Conservative
  default of 10.
- Use distinct non-zero exit codes for the new stop conditions so operators
  and tests can tell them apart.
- This subspec supersedes the line in `01-index-only-run-validation.md`
  Decisions that says "Jarvis should not enforce per-iteration checkbox
  deltas." That decision was made before the runaway failure was observed.

## Behavior

### Agent output streaming

In `src/commands/run.ts`, after the agent resolves with `kind: "ok"`, write
`result.stdout` to `opts.io.stdout` and `result.stderr` to `opts.io.stderr`
before the loop continues. Existing stderr printing on `kind: "error"` is
unchanged. Quota fallback messages are unchanged.

The agent stream is printed verbatim. Do not prefix, indent, or wrap it.

### No-progress stop

Before invoking the agent, snapshot `before = countUnchecked(specPath)`. After
a `kind: "ok"` result, compute `after = countUnchecked(specPath)`. If
`after === before` and `after > 0`, print:

```text
iteration <N> made no progress; stopping
```

to stderr and exit **4**. Do not invoke another agent.

If `after === 0`, fall through to the normal completion path (print
`spec complete`, exit 0). Completion takes precedence over no-progress.

### Iteration cap

Add `--max-iterations <n>` to the `run` subcommand. Add `maxIterations` to
`ConfigOptions` and `loadConfig`. Resolution order: CLI flag > config file >
default `10`. The value must be a positive integer; reject `0`, negatives, and
non-integers with a clear stderr message and exit 1 before entering the loop.

When `iteration > maxIterations` at the top of the loop, print:

```text
max iterations (<N>) reached; stopping
```

to stderr and exit **5**. Quota-fallback iterations count toward the cap
(simpler, and a stuck quota loop is itself a thing to bound).

### Exit codes summary

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Spec complete                                        |
| 1    | Bad input (missing spec, invalid `--max-iterations`) |
| 2    | All agents quota-exhausted                           |
| 3    | Non-quota agent error                                |
| 4    | No-progress stop (new)                               |
| 5    | Max iterations reached (new)                         |
| 130  | SIGINT                                               |

## Tasks

- [x] Stream `result.stdout` and `result.stderr` to the run io on every `ok`
  iteration in `src/commands/run.ts`.
- [x] Snapshot unchecked count before each iteration; on `ok`, compare and
  exit 4 with the message above when unchanged and the spec is incomplete.
- [x] Add `--max-iterations <n>` to the `run` subcommand in `src/cli.ts` and
  plumb it through `RunCommandOptions`.
- [x] Add `maxIterations` to `ConfigOptions` and `loadConfig` in
  `src/config.ts` with default `10`. Validate the value (positive integer);
  exit 1 on invalid CLI input.
- [x] Enforce the cap at the top of the loop; exit 5 with the message above.
- [x] Tests:
  - agent stdout and stderr are printed on a successful iteration
  - no-progress: an `ok` iteration that does not change unchecked count exits 4
  - no-progress vs. completion: an `ok` iteration that ticks the last box
    exits 0, not 4
  - cap: a run that never completes stops at the configured cap with exit 5
  - cap resolution: CLI flag overrides config; config overrides default
  - invalid `--max-iterations` (`0`, `-1`, `abc`) exits 1 before invoking an
    agent
  - quota fallback iterations count toward the cap
- [x] Amend `01-index-only-run-validation.md` Decisions to remove the
  "Jarvis should not enforce per-iteration checkbox deltas" line and note
  that 00 supersedes it.

## Acceptance criteria

- A real `jarvis run` against an incomplete spec prints the underlying agent's
  full stdout and stderr after each iteration.
- A run where an `ok` agent iteration leaves the unchecked count unchanged
  exits 4 without invoking another agent.
- A run that would otherwise loop forever stops at `maxIterations` with exit 5.
- The cap is configurable via `--max-iterations` and via the config file, with
  CLI taking precedence and a default of 10.
- Existing quota-fallback, non-quota error, completion, and SIGINT behavior
  is unchanged.
- `bun run typecheck` passes.
- `bun test` passes.

## Documentation updates

- README: document `--max-iterations` and the `maxIterations` config field.
- README: document the new exit codes 4 and 5.
