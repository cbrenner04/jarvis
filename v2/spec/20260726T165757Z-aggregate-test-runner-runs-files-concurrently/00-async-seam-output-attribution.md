# 00 - Async spawn seam with captured, per-file-attributed output (still serial)

## Problem

`runV2TestFiles` (`scripts/run-v2-tests.ts:55`) drives a serial `for` loop of
`spawnSync("bun", ["test", file], { stdio: "inherit" })`. It is the shared runner behind aggregate
`bun run test` (via `scripts/run-tests.ts:23`) and the scoped `test:v2` / `test:integration:v2`
slices.

`spawnSync` cannot overlap, and `stdio: "inherit"` cannot stay readable once files overlap in a
later subspec. Both have to change before concurrency can land at all. This subspec makes that
change alone, execution order still serial, so it is pinned entirely by today's tests plus new
attribution tests — no concurrency behavior is introduced here.

Today's runner returns on any non-zero exit status in every mode
(`scripts/run-v2-tests.ts:72-74`); only the timeout path branches on mode (`:66`).
`scripts/run-v2-tests.test.ts:96` pins this: agent mode over `["failing.test.ts","ok.test.ts"]`
asserts only the first file is spawned. That fail-fast-on-failure contract is preserved unchanged
here; only the transport (spawn → capture) and timeout classification change.

## Decisions

- `runV2TestFiles` becomes async and its injected spawn seam becomes an async spawn returning
  `{ status, signal }` plus captured stdout/stderr. Rules out retaining `spawnSync`, which cannot
  overlap and blocks the concurrency subspec that follows.
- Each child's stdout/stderr is captured, not inherited, and flushed as one contiguous block when
  that file settles, preceded by a header line naming the file. Rules out `stdio: "inherit"`, which
  will interleave once files overlap.
- Fail-fast-on-failure is unchanged: a non-zero exit in any mode still stops the run before starting
  the next file, exactly as today (`scripts/run-v2-tests.test.ts:96`). Only a timeout continues to
  the next file in `agent` mode. Rules out widening `agent` mode to run past a plain failure — that
  is a separate policy change with gate-budget consequences, out of scope here.
- Timeout classification is tracked explicitly from the timer that fires, not inferred from
  `signal === "SIGKILL" && status === null` (today's `run-v2-tests.ts:27-29`). Rules out the
  inference, which will misattribute an externally-delivered SIGKILL or an OOM kill as a timeout once
  concurrency raises memory pressure in the next subspec.
- Output captured before a SIGKILL is still flushed and attributed to that file, not dropped. Rules
  out silently discarding partial output on kill, which regresses today's `stdio: "inherit"`
  behavior of showing the operator whatever the file printed before it died.
- `scripts/measure-test-cost.ts` keeps its own serial measurement path, untouched by this seam
  change. Rules out routing it through the new capture path, which is orthogonal to its timing
  concern.

## Acceptance criteria

- [ ] `scripts/run-v2-tests.test.ts` stays green against the async spawn signature (updated only for
      the async return shape, no behavior change).
- [ ] Agent-mode fail-fast-on-failure is unchanged: `scripts/run-v2-tests.test.ts`'s existing case
      (agent mode over a failing file followed by a healthy one spawns only the first) stays green.
- [ ] Agent-mode continue-past-timeout is unchanged: the existing timeout case in
      `scripts/run-v2-tests.test.ts` (agent mode continues past a timed-out file and reports it by
      name) stays green.
- [ ] A file's captured output is flushed as one block headed by its filename when it settles: a
      test asserts the header and full captured content are present and correctly attributed.
- [ ] A SIGKILL'd file's output captured before the kill is still emitted, not dropped: a test drives
      a file that prints then times out and asserts its printed output appears in the report.
- [ ] Timeout classification comes from the timer that fired, not signal/status inference: a test
      drives a non-timeout SIGKILL (e.g. an externally-delivered kill within budget) and asserts it
      is reported as a failure, not a timeout; it fails against the pre-change inference, which
      would misclassify it.
- [ ] `validatePerFileTimeout` still throws for a timeout below `SUPPORTED_HEALTHY_FILE_BUDGET_MS`.
- [ ] `bun run check` is green, including `scripts/guard-deterministic-daemon-tests.ts`.

## Documentation updates

- `v2/docs/test-writing.md` — the output-capture-and-attribution model (header + contiguous block
  per settled file) and the explicit timeout-classification rule, in the § describing the runner.
- `v2/docs/v1-behaviors.md` — update the runnable-test-commands entry: output is now captured and
  attributed per file rather than inherited live, and timeouts are classified from an explicit timer
  rather than signal/status inference.
