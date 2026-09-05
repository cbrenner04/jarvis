---
name: dismiss-accepts-a-bulk-terminal-selection
---

# `run dismiss` takes one id at a time, so shedding a project's terminal rows means a shell pipe

## Problem

`jarvis run dismiss <run-id>` accepts exactly one id, and a workflow-entry run's step rows each carry their own `dismissedAt` — so dismissing one invocation means dismissing every row under it individually. Shedding a project's accumulated terminal rows is therefore a hand-rolled pipe:

```sh
jarvis run list --project chess-mvp-yolo-2 | awk -F'\t' '$5=="not-live"{print $1}' | xargs -n1 jarvis run dismiss
```

The default `run list` retention window makes this actively misleading. Plain `run list` caps at the fifty newest terminal rows, so each batch dismissed frees slots and surfaces older rows: the operator dismisses, sees "more" appear, and repeats. Measured 2026-09-05 on `chess-mvp-yolo-2`: the default listing showed **16** rows while `--project` (which bypasses retention) returned **73** undismissed and **112** including dismissed. The list never appears to shrink, and nothing tells the operator the cap is why.

## Decisions

- `jarvis run dismiss` accepts a bulk selection using the dimension filters `run list` already has — at minimum `--project <name>`, scoped to terminal (`not-live`) rows only. Rules out dismissing live rows in bulk, and rules out a new query grammar: the flags and their exact-match semantics already exist on `run list`.
- Bulk dismissal covers step rows under matched entry rows, so one invocation sheds a whole workflow. Rules out leaving orphan step rows the operator must sweep separately.
- Print a count of rows dismissed. A silent success is what makes the current pipe unverifiable against the retention window.
- Same for `pipeline dismiss`, if it falls out of the same helper; do not force it. Rules out widening scope for its own sake.
- Display-only, unchanged: durable rows are retained, `undismiss` still reverses it, and a dismissed-but-live run still blocks worktree retirement. Rules out any purge semantics.

## Acceptance criteria

- [ ] A CLI test proves `run dismiss --project <name>` dismisses every terminal row for that project and no live row; it fails against the current single-id-only signature.
- [ ] A CLI test proves step rows under a matched workflow-entry row are dismissed by the same invocation.
- [ ] A CLI test proves the command reports how many rows it dismissed.
- [ ] Passing both a positional run id and a bulk filter is refused with a named error rather than silently preferring one.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Run dismiss and undismiss covers the bulk form, and states that the default `run list` retention cap is why a partially-dismissed list appears to refill.

## Sequencing

**P3 — ergonomics, no correctness impact.** The shell pipe above works today and is a complete workaround; this is about not needing it. Related but distinct from [[pipeline-list-display-retention]], which caps what `pipeline list` paints by default — that one is about unbounded growth, this one is about the cost of shedding rows by hand. If both land, keep the retention rule and the dismiss ergonomics consistent so operators learn one model.
