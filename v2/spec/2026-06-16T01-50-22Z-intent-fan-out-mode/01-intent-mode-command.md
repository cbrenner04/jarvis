# `jarvis intent` mode command and fan-out flow

## Problem

Implementation PRs land too big; sizing must happen before planning. A new
top-level `jarvis intent` mode fans one seed into N intents, each destined for
its own `plan` → `run` → one PR. This subspec adds the command and the flow that
emits the intents; the splitter prompt and sizing rule come from 00.

## Decisions

- One PR per spec stays the unit; the lever is the *count* of intents/specs —
  rules out making subspecs the mergeable unit (#220's contradiction).
- Intent mode authors all N intents up front but does **not** run plan/draft;
  specs stay lazy, drafted once per intent in turn — rules out eagerly emitting
  spec dirs/subspecs/ACs now.
- Output is `ready-intents/`, sibling of the `wip-intents/` raw-seed input —
  rules out writing into `wip-intents/` or a timestamped spec dir.
- Reuses the existing plan intent-draft + refine machinery in place — rules out
  performing the seed-02 extraction/refactor of that machinery here.
- The intent PR exists so the operator reviews the *split itself* before any
  `plan` runs.
- Deferred to first consumer: whether refine runs per-intent or across the whole
  set, and the intent-mode worktree/branch naming — pin when the implementer wires
  the flow.

## Task checklist

- [ ] Add a top-level `intent` subcommand parallel to `plan` (accepts inline
      `"<prompt>"` or a raw-seed file path from `wip-intents/`).
- [ ] Flow: seed → draft N intents via the 00 splitter → refine → write N
      authored intents to `ready-intents/` → commit → open draft intent PR.
- [ ] Each emitted intent file carries a `name:` and a `Prerequisites` section.
- [ ] Reuse the existing `plan` intent-draft and refine code without extracting
      it out of plan mode.
- [ ] Add `v1/docs/intent-mode.md` documenting the flow and the
      one-PR-per-spec / spec-count-is-the-lever rule.
- [ ] Record the new mode behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] `jarvis intent "<prompt>"` and `jarvis intent <raw-seed-file>` (from
      `wip-intents/`) both start the fan-out flow.
- [ ] Running intent mode against a seed writes N authored intent files to
      `ready-intents/` (sibling of `wip-intents/`), each with a `name:` and a
      `Prerequisites` section, and writes no spec `index.md` or numbered
      subspecs.
- [ ] Intent mode opens a draft intent PR aggregating the split for operator
      review and produces no spec directory.
- [ ] Intent mode reuses the existing plan intent-draft and refine machinery and
      does not extract or refactor it out of plan mode.
- [ ] `v1/docs/intent-mode.md` documents the `jarvis intent` flow (seed → N
      intents → `ready-intents/` → intent PR) and that the lever is the count of
      specs, one PR per spec.
- [ ] `v2/docs/v1-behaviors.md` records the `jarvis intent` mode behavior.

## Documentation updates

- New `v1/docs/intent-mode.md`: the `jarvis intent` flow.
- `v2/docs/v1-behaviors.md`: record the v1 behavior v2 must preserve.
