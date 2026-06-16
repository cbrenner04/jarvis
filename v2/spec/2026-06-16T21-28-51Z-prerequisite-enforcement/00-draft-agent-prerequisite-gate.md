# 00 — Draft-agent prerequisite gate

## Problem

A ready-intent's `## Prerequisites` section declares behaviors the intent
depends on. Plan validates the section is *present* at entry but never checks the
declared behaviors exist, and the section rides into the draft prompt as
unenforced context (`v2/docs/v1-behaviors.md` line: "included in draft/review
prompts as context but are not validated, resolved, or enforced"). So `plan`
will draft against a tree missing a dependency.

Make the draft agent gate itself: as its first action, before producing any spec
content, it reads existing repo files and judges whether each `## Prerequisites`
behavior is legibly present. If it cannot cleanly confirm one, it appends a
`## Blocker` naming the unconfirmed behavior(s) and writes no spec files; `plan`
then exits non-zero having drafted nothing.

## Decisions

The signal is the repo; presence is judged by reading existing files — rules out a completion record / behavior ledger / `v1-behaviors.md` entry.
The draft agent makes the call as its first step — rules out a dedicated preflight/checker agent and a draft-phase blocker appended only after drafting.
Fail closed: "cannot cleanly confirm" is treated as absent — rules out drafting on an ambiguous read.
Same gate path for every prerequisite — rules out a backfill special-case for already-shipped behavior.
Reuse the existing `## Blocker` stop/commit/stderr plumbing for the failure exit — rules out a new bespoke prerequisite exit code or message.
Move the `hasGenuineBlocker` check ahead of the `index.md`-exists check in `validateDraftOutput` — rules out the current order, where a gate that writes nothing fails as "index.md was not created" instead of surfacing the blocker body. Without this the stderr would not name the unconfirmed behaviors and the stop would read as a generic validation failure.
Gate text lives in `prompts/plan/draft.md` (the assembled `plan.prompt.draft` step), bumping its revision — rules out a non-snapshotted prompt edit that drifts review-invisibly.
Phrase prerequisites in the gate as behaviors verifiable against repo files, not intent filenames/dirs/branches/PRs — rules out anchoring the contract to the artifact that delivered the behavior.

Deferred to first consumer: any machine-readable per-behavior confirmation format — pin when a caller needs it. The gate is an agent legibility judgment over prose prerequisites; nothing parses individual behaviors today.

## Tasks

- Add a prerequisite gate as the first instruction block in `prompts/plan/draft.md`:
  read existing repo files; for each `## Prerequisites` behavior, confirm it is
  legibly present; if any cannot be cleanly confirmed, append `## Blocker` naming
  each unconfirmed behavior and produce no `index.md`/subspecs; if there are no
  prerequisites (empty section), skip the gate and draft normally. Bump the
  prompt `revision`.
- Reorder `validateDraftOutput` (`v1/src/modes/plan/draft.ts`) so a genuine
  `## Blocker` in `intent.md` is recognized before the `index.md`-exists check,
  so a gate that writes nothing stops as a blocker (exit 1) with the blocker body
  on stderr rather than an "index.md was not created" validation error.
- Regenerate the rendered draft snapshot fixture
  (`v1/test/fixtures/prompts/rendered/plan.prompt.draft@r<new>.shared.txt`) and
  update the revision pin in `v1/test/prompts/rendered-snapshots.test.ts`.
- Add/extend tests: draft prompt contains the gate text; `validateDraftOutput`
  treats a blocker-with-no-index as a blocker (not an index error); satisfied
  prerequisites draft normally; an unconfirmable prerequisite blocks and names
  the behavior; empty/no prerequisites draft normally.

## Acceptance criteria

- [ ] `jarvis1 plan <ready-intent>` exits non-zero and writes no `index.md` or numbered subspecs when a declared prerequisite behavior cannot be confirmed in existing repo files.
- [ ] On that failure, stderr includes the blocker body naming each unconfirmed prerequisite behavior.
- [ ] The prerequisite judgment happens before any spec content is produced, so a failed gate runs no review passes and produces no `index.md`/subspec files.
- [ ] A ready-intent whose declared prerequisite behaviors are legibly present in the repo proceeds into normal spec drafting (and review).
- [ ] A ready-intent with an empty `## Prerequisites` section proceeds into normal spec drafting without a gate failure.
- [ ] `validateDraftOutput` reports a genuine `## Blocker` in `intent.md` as a blocker even when no `index.md` exists, instead of an "index.md was not created" error.
- [ ] The assembled `plan.prompt.draft` prompt instructs the draft agent to confirm each `## Prerequisites` behavior against existing repo files as its first action and to fail closed (treat "cannot confirm" as absent) by appending `## Blocker`.
- [ ] No completion record, behavior ledger, or `v2/docs/v1-behaviors.md` completion entry is added or required by the mechanism.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: document the draft-phase prerequisite gate in Phase 1 (Draft) — first-action repo-file check, fail-closed semantics, and the non-zero blocker exit naming unconfirmed behaviors with no spec/review work done.
- `v1/docs/spec-guidance.md`: note that `## Prerequisites` entries must be phrased as behaviors an agent can verify against existing repo files (not intent filenames, spec dirs, branches, or PRs), since the draft gate reads them that way.
- `v2/docs/v1-behaviors.md`: update the plan-mode bullet that currently says ready-intent `## Prerequisites` are "included in draft/review prompts as context but are not validated, resolved, or enforced" to record the new draft-agent gate behavior; update the draft-blocker bullet to note `validateDraftOutput` recognizes a blocker ahead of the `index.md` check.
