# Row-advertised `resumable` is projected from admission

`wait` and `list` echo `resumable` straight from the terminal `loop_finished` record
(`resultFrom` in `v2/src/daemon/daemon.ts`), documented in `v2/docs/daemon-host.md` as "loop-log legacy".
Admission uses a different derivation (`isResumeAdmitted` → composed `nextAction`). Any disagreement between
the two is an operator-visible lie: a row says `resumable: true` and `run resume` refuses it. Subspec 00
fixes one such disagreement; this one removes the class.

## Decisions

- `resumable` on `list` / `wait` rows is the admission predicate's value, not the log field; rules out
  keeping the log echo and chasing each divergence as its own bug.
- Rows admission refuses report `resumable: false` even when the loop record says `true` (stale `paused` /
  `budget-exhausted` records under a demoted `failed` row); rules out widening admission to match the log.
- The raw `loop_finished` record in `jarvis run log` keeps its settle-time self-report unchanged — it is the
  loop's own account, written before later status transitions exist. The row, not the log line, is the
  contract. Rules out rewriting persisted log events.
- Workflow entry projection keeps its existing "entry row must itself be resumable" narrowing; rules out
  entry rows inheriting a sibling's resumability.

## Tasks

- Derive `resumable` in `resultFrom` (and the workflow entry projection) from the same predicate that gates
  admission.
- Add a table-driven agreement test over every terminal `WriteLoopOutcomeKind` × the durable statuses each
  can settle on.

## Acceptance criteria

- [ ] A test in `v2/src/daemon/daemon-resume.test.ts` iterates every terminal `loopOutcomeKind` in
      `WRITE_LOOP_OUTCOME_KINDS` and asserts no row reports `resumable: true` on `wait` / `list` while
      `run resume` refuses it, and none reports `resumable: false` while `run resume` admits it; it fails
      against pre-fix code on at least the stale `paused`-on-`failed` row.
- [ ] Inverting the admission guard fails that test.
- [ ] A `failed` row whose terminal record is a stale `loop_finished` with `resumable: true` for `paused` or
      `budget-exhausted` reports `resumable: false` on `wait` and `list`.
- [ ] Existing `daemon-wait-run-completion.test.ts` and `daemon-start-list.test.ts` resumable assertions stay
      green (or are updated to the projected value where they pinned the log echo, with the change visible in
      the diff).
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — replace the `error.retryable` vs `wait.resumable` "loop-log legacy" paragraph:
  `resumable` is projected from admission, so advertised `resumable` and `resume` admission agree by
  construction; update the `resume`, `list`, and `wait` RPC rows to match.
- `v2/docs/v1-behaviors.md` — `resumable` on `run list` / `run wait` is the admission answer, not the loop
  log's self-report.
