# Failure exit summary cites a runbook section

When a patch run (`jarvis run`) ends on a non-success exit reason, the end-of-run
summary points the operator at the relevant `OPERATOR_RUNBOOK.md` section so the
recovery recipe is found where it's needed. The summary already prints
`exit reason: <reason> (exit code N)` (`v1/src/run-summary.ts:249`); add a
`see runbook: <section>` pointer keyed to the exit reason. Success
(`criteria-complete`) prints no pointer.

The cited sections are the stably-named scaffolded headings from
`v1/src/runbook-generator.ts` (`### Recovery by exit reason`,
`## Resume-first guidance`). `init.test.ts` currently guards only the H2
headings; this spec extends that guard to the H3 `Recovery by exit reason`
section so the pointer can't dangle.

## Decisions

- Pointer emitted in the patch run summary, adjacent to the `exit reason:` line — single chokepoint covering every failure reason; rules out duplicating it across the per-site stderr messages.
- Pointer text: `see runbook: OPERATOR_RUNBOOK.md › <section>` where `<section>` is the exact scaffolded heading text — names the file so the pointer is self-sufficient; rules out citing a bare anchor slug the operator can't read.
- Citation is unconditional on the reason, not gated on the file existing on disk — the runbook is scaffolded by `jarvis init` for tracked projects and the pointer is self-explanatory when absent; rules out a file-existence probe that would silently drop the pointer in ad-hoc runs.
- Mapping (two buckets): `timeout`, `sigint`, `worktree-locked` → `Resume-first guidance`; every other non-success reason (including `error`/`floor-error` and the generic `exit-N` default) → `Recovery by exit reason` — interrupt/lock exits resume, all other costly exits recover; rules out an invented per-reason section that the scaffold doesn't provide.
- Mapping keys on the bare reason, applied before the `(exit code N)` suffix is appended — the rendered line is `<reason> (exit code N)`, so the bucket lookup matches the unsuffixed reason and is not confused by the trailing code; rules out matching against the suffixed string.
- Pointer appears on both the no-telemetry early-return path and the full summary path — `runExitReason` is available on both, and a failure exit must cite the runbook whether or not telemetry was captured; rules out wiring it only into the full renderer and silently dropping it on the early return.
- `criteria-complete` prints no pointer — success is not a costly exit; rules out citing the runbook on the happy path.
- Plan-mode summaries are unaffected — the runbook is a `jarvis init` target-repo scaffold with no plan-mode analogue; rules out citing it from plan exit reasons.
- Prompt-mode summaries (`promptSummary`) print no pointer either — same target-repo-scaffold rationale as plan mode; rules out adding the pointer to the prompt-mode `exit reason:` line.

## Task checklist

- [ ] Map each patch exit reason to its stable runbook section per the Decisions.
- [ ] Emit the `see runbook:` pointer in the patch run summary for non-success reasons.
- [ ] Add run-summary tests for the pointer.
- [ ] Extend the `init.test.ts` heading guard to cover the H3 `Recovery by exit reason` section.
- [ ] Update docs (`run-loop.md`, `operator-runbook.md`, `v1-behaviors.md`).

## Acceptance criteria

- [x] A patch run ending on `ready-stuck-red` prints a summary line citing the `OPERATOR_RUNBOOK.md` `Recovery by exit reason` section.
- [x] A patch run ending on `timeout`, `sigint`, or `worktree-locked` prints a summary line citing the `OPERATOR_RUNBOOK.md` `Resume-first guidance` section.
- [x] Every non-success patch exit reason (`ready-stuck-red`, `error`, `floor-error`, `quota-exhausted`, `agent-error`, `no-progress`, `max-iterations`, `dirty-worktree`, `blocked`, `review-incomplete`, and the generic `exit-N` default) prints exactly one `see runbook:` pointer naming a section that matches a heading present in the scaffolded runbook.
- [x] A failure exit on the no-telemetry early-return path of the run summary still prints its `see runbook:` pointer.
- [x] A patch run ending on `criteria-complete` prints no `see runbook:` pointer.
- [x] The cited section names match scaffolded headings emitted by `v1/src/runbook-generator.ts`, and `init.test.ts` guards both cited headings (H2 `Resume-first guidance` and H3 `Recovery by exit reason`) so a renamed/removed runbook section fails a test rather than dangling a stale pointer.
- [x] Plan-mode and prompt-mode run summaries print no `see runbook:` pointer.
- [x] Existing `v1/test/run-summary.test.ts` exit-reason assertions stay green (success-path summary unchanged apart from the new pointer on failures).

## Documentation updates

- `v1/docs/run-loop.md`: in the exit/completion-semantics section, document that failure exit summaries cite the keyed `OPERATOR_RUNBOOK.md` section.
- `v1/docs/operator-runbook.md`: note that failure exits route operators to the scaffolded runbook section.
- `v2/docs/v1-behaviors.md`: record the new run-summary output (failure exits include a `see runbook:` pointer) — this changes existing v1 run-summary behavior.
