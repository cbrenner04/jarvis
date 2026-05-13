# 09 — Local run telemetry

## Problem

There is no record of run outcomes over time. The operator cannot answer:

- How long does a typical iteration take?
- Which agent quota-exhausts most often?
- Which specs trip the no-progress catch?
- How often does the loop hit `maxIterations`?

`maxIterations: 10` is the only cost governor. Anything beyond gut feel
requires reading through `~/.jarvis/sessions/*.log` by hand.

This subspec adds a single, local, append-only record. No external
service. No tokens (we cannot observe agent token usage from outside the
CLI). No subcommand to read it — first cut is "the file exists and is
greppable." A `jarvis stats` subcommand can come later when there is
data to motivate the shape.

## Behavior

- Append-only `~/.jarvis/runs.jsonl`.
- One line per iteration end (success, error, quota, model_config,
  blocker, timeout, no-progress, completed-spec).
- Fields (all required):

  ```jsonc
  {
    "ts": "2026-05-13T17:42:11Z",
    "namespace": "<project-key>:<spec-display>",
    "agent": "claude",
    "iteration": 3,
    "duration_ms": 18421,
    "kind": "ok" | "quota" | "model_config" | "error" | "blocked" | "timeout",
    "exit_reason": "criteria-progress" | "criteria-complete" | "no-progress" | "blocker-detected" | "agent-error" | "iteration-timeout" | ...
  }
  ```

- Writing is best-effort: a failure to append must not affect the run.
  Use the same fire-and-forget treatment as subspec 10 applies to log
  shipping.
- File location is config-overridable via `telemetryPath`. Default
  `~/.jarvis/runs.jsonl`. Set to `null` to disable.
- File is line-delimited JSON, no header, safe to `tail -f`.
- Final line for a run records the run's terminal state. Mid-run lines
  record per-iteration outcomes.

No reader subcommand in this subspec. The file is the artifact.

## Tasks

- [ ] Implement append-only writer in `src/telemetry.ts` (new file).
- [ ] Wire one write per iteration end in `runCommand`; one write on
      terminal exit paths (complete, max-iter, quota-exhausted, blocked,
      timeout, error).
- [ ] Config: `telemetryPath: string | null` with default
      `~/.jarvis/runs.jsonl`.
- [ ] Tests: writer appends valid JSON lines; disabling (`null`) skips
      writes; a thrown error from the writer does not bubble up to
      `runCommand`.

## Acceptance criteria

- [x] After a multi-iteration run, `~/.jarvis/runs.jsonl` contains one
      JSON line per iteration plus a final terminal-state line.
- [x] Each line parses as valid JSON with the documented schema.
- [x] A test that forces the writer to throw still allows the run to
      complete with the original exit code.
- [x] Setting `telemetryPath: null` disables writes.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- `docs/run-loop.md`: brief mention of `~/.jarvis/runs.jsonl` and what is
  recorded.
- `docs/config.md`: `telemetryPath`.
