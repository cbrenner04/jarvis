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
- Output dir is `ready-intents/`, resolved as a sibling of the `wip-intents/`
  raw-seed input under the same configured location plan commits use
  (`plan.targetDir` resolution); the intent PR targets the same repo plan-mode
  `commit: true` commits to — rules out writing into `wip-intents/`, a
  timestamped spec dir, or an unresolved cwd-relative path.
- "Reuse" means the existing turn/runner plumbing — agent invocation, quota
  fallback, worktree, commit, and draft-PR scaffolding — not the intent-draft
  *prompt* text, which is single-intent and replaced by the 00 splitter — rules
  out claiming prompt-level reuse the single-intent draft prompt cannot deliver,
  and rules out the seed-02 extraction/refactor.
- The legacy refine pass does **not** run at fan-out: its preservation contract
  keys on a single-intent seed-wrapper layout the split `ready-intents/` files
  do not have, and behavior-level intents are consumer-less, where refine
  over-amplifies precision. Each emitted intent is refined lazily by its own
  later `plan` run (which already runs intent-draft + refine on its seed) — rules
  out running refine over the split set or authoring new set-altitude refine
  behavior here.
- The intent PR exists so the operator reviews the *split itself* before any
  `plan` runs.
- Emitted filenames derive from each intent's `name:` slug (`<name>.md`), no
  numeric ordering prefix — emitted-intent dependency is carried by
  `Prerequisites`, not filename order (the 01→02→03 ordering is for the three
  seeds, not the fan-out output). A `name:` collision with an existing
  `ready-intents/` file (re-run, or two seeds fanned into one dir) is a hard
  error, not a silent overwrite — rules out clobbering authored intents.
- N=1 is valid: a single-behavior judgment writes one intent and skips no step;
  fan-out is not forced to split — rules out erroring on an unsplittable seed.
- The `wip-intents/` raw seed is left in place after fan-out — rules out
  consuming or moving it (re-runs and history stay available).
- Deferred to first consumer: the intent-mode worktree/branch naming — pin when
  the implementer wires the flow.

## Task checklist

- [ ] Add a top-level `intent` subcommand parallel to `plan` (accepts inline
      `"<prompt>"` or a raw-seed file path from `wip-intents/`).
- [ ] Flow: seed → draft N intents via the 00 splitter → write N authored
      intents to `ready-intents/` → commit → open draft intent PR. (No refine pass
      at fan-out; per-intent refine happens in each intent's later `plan` run.)
- [ ] Each emitted intent file is `<name>.md` from the intent `name:` slug,
      carries a `name:` and a `Prerequisites` section, with no ordering prefix.
- [ ] Reuse the existing turn/runner plumbing (agent invocation, quota fallback,
      worktree, commit, draft-PR scaffolding) without extracting it out of plan
      mode; the 00 splitter replaces the single-intent draft prompt.
- [ ] Add `v1/docs/intent-mode.md` documenting the flow and the
      one-PR-per-spec / spec-count-is-the-lever rule.
- [ ] Record the new mode behavior in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [x] `jarvis intent "<prompt>"` and `jarvis intent <raw-seed-file>` (from
      `wip-intents/`) both start the fan-out flow.
- [x] Running intent mode against a seed produces the N-way split (via the 00
      splitter) and writes N authored intent files to `ready-intents/` —
      resolved as a sibling of `wip-intents/` under the same configured location
      plan commits use — each named `<name>.md` from its `name:` slug with no
      ordering prefix, carrying a `name:` and a `Prerequisites` section, and
      writes no spec `index.md` or numbered subspecs.
- [x] A single-behavior seed writes exactly one intent and still completes the
      flow (N=1 is not an error).
- [x] An emitted `name:` colliding with an existing `ready-intents/` file aborts
      without overwriting it.
- [x] Splitter quota exhaustion falls through to the next configured agent;
      unparseable or invalid splitter output aborts the run without writing
      partial `ready-intents/` files or opening a PR.
- [x] The `wip-intents/` raw seed remains in place after fan-out.
- [x] Intent mode opens a draft intent PR — targeting the same repo plan-mode
      `commit: true` commits to — aggregating the split for operator review, and
      produces no spec directory.
- [x] Intent mode reuses the existing turn/runner plumbing (agent invocation,
      quota fallback, worktree/commit/PR scaffolding), runs no refine pass at
      fan-out, and does not extract or refactor plan-mode machinery.
- [x] `v1/docs/intent-mode.md` documents the `jarvis intent` flow (seed → N
      intents → `ready-intents/` → intent PR) and that the lever is the count of
      specs, one PR per spec.
- [x] `v2/docs/v1-behaviors.md` records the `jarvis intent` mode behavior.

## Documentation updates

- New `v1/docs/intent-mode.md`: the `jarvis intent` flow.
- `v2/docs/v1-behaviors.md`: record the v1 behavior v2 must preserve.
