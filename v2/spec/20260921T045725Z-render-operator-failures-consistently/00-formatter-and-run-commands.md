# Add the shared failure formatter and wire run commands

## Problem

`run list` omits the durable failure record and `run wait` drops it from its JSON payload; no formatter owns human-readable failure text.

## Behavior

A CLI-owned formatter renders a labeled failure block from `OperatorFailureRecord` (`shared/operator-failure-record.ts`). `run list` and `run wait` use it while keeping their identity, lifecycle, and exit semantics.

## Decisions

- The block is a `string[]` of lines: first line exactly `failure:`, every later line starts with two spaces, no blank lines, one physical line per field; hosts emit the lines contiguously and unmodified apart from a host-owned row prefix; rules out hosts re-wrapping fields or a boundary only detectable by field-name matching.
- Line order: `expectation: …`, `observation: …`, `near miss: …` (only when present), `reissue can help: yes|no`, then one `path (harness-internal): …` or `path (operator-repository): …` per referenced path in record order; rules out surface-owned labels, retry prose, path-prefix inference, or reordered evidence.
- Text values (expectation, observation, near miss, path) are encoded by the formatter: backslash → `\\`, tab → `\t`, newline → `\n`, carriage return → `\r`, any other C0 control or DEL → `\u` + four lowercase hex digits, everything else verbatim; rules out each host escaping differently or control characters creating unlabeled fields.
- Formatter encoding is applied once and is separate from JSON transport escaping (`JSON.stringify` of `failureText` applies on top); the structured record is never encoded; rules out double-encoding the record or treating JSON escapes as the formatter's.
- Run identity stays outside the block; rules out contaminating cross-surface equality with run IDs, statuses, or timestamps.
- `run wait` JSON retains the unchanged structured `failure` and adds `failureText` (block lines joined with `\n`); when no canonical record exists `failureText` is omitted, not `null`; rules out replacing structured evidence, forcing scripts to parse prose, or a null-vs-absent ambiguity.
- Human `run list` appends an identity-associated failure section per failing run after the summary rows, without changing existing columns or order; rules out widening stable tabular rows or an ambiguous block when several runs fail.
- `run list` gains no `--json` flag; machine-readable preservation stays on existing JSON surfaces only.

## Task checklist

- [ ] Add the CLI-owned formatter and unit coverage for optional evidence, retryability, encoding, and path-origin labels.
- [ ] Wire `run list` (human) and `run wait` (human and JSON) to the formatter without changing lifecycle or exit handling.

## Acceptance criteria

- [ ] Formatter cases in `v2/src/cli/operator-failure-presentation.test.ts` prove a no-candidate record and an unmatched-near-miss record keep distinct observations and only the latter renders the near miss; they fail if absence is rendered as a candidate or the near miss is dropped.
- [ ] Formatter cases in the same file prove recorded `harness-internal` and `operator-repository` paths receive distinct origin labels, including paths whose spelling would defeat prefix inference.
- [ ] Formatter cases in the same file prove the block boundary (first line `failure:`, all later lines two-space indented, no blank lines) and that `reissue can help` renders `yes` and `no` for `retryable` true and false.
- [ ] Formatter cases in the same file prove tab, newline, carriage return, backslash, ESC (`\u001b`), and DEL in every text field render as the specified escapes with one physical line per field, and that the input record is not mutated; they fail if a raw control character reaches the output.
- [ ] A `v2/src/commands/run.test.ts` regression proves `run wait --json` carries the unchanged `failure` object beside `failureText`, that `failureText` split on `\n` equals the formatter's lines, that a record containing a newline is encoded once by the formatter (JSON escaping is not folded into `failureText`), and that `failureText` is absent (not `null`) when no canonical record exists; it fails against the pre-fix payload.
- [ ] A `v2/src/commands/run.test.ts` regression proves human `run wait` and human `run list` print the formatter block, with the list section carrying unambiguous run identity when several runs fail; it fails against the pre-fix omission.
- [ ] `v2/src/commands/run.test.ts` wait exit-code and list identity-column tests, and `v2/src/cli/help-flags-parity.test.ts`, stay green (no `--json` flag added to `run list`).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — add “Reading a contract failure” covering expectation, observation, optional near miss, recorded path origin, `reissue can help`, the block shape, and control-character escaping.
