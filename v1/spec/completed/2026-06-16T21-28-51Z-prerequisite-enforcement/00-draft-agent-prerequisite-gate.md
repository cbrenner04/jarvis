# 00 — Draft-agent prerequisite gate

## Problem

A ready-intent's `## Prerequisites` section declares behaviors the intent
depends on. Plan validates the section is *present* at entry but never checks the
declared behaviors exist, and the section rides into the draft prompt as
unenforced context (`v2/docs/v1-behaviors.md` line: "included in draft/review
prompts as context but are not validated, resolved, or enforced"). So `plan`
will draft against a tree missing a dependency.

Make the draft agent gate itself: as its first action, before producing any spec
content, it reads existing repo files and judges whether each behavior in the
intent's `## Prerequisites` section is legibly present. The judgment is internal
reasoning — on a pass it writes nothing to `intent.md` and drafts normally. If it
cannot cleanly confirm one, it appends a `## Blocker` naming the unconfirmed
behavior(s) and writes no spec files; `plan` then exits non-zero having drafted
nothing. A body that is empty or a single bareword (`none`) means no
prerequisites: skip the gate and draft normally.

## Decisions

The signal is the repo; presence is judged by reading existing files — rules out a completion record / behavior ledger / `v1-behaviors.md` entry.
The draft agent makes the call as its first step — rules out a dedicated preflight/checker agent and a draft-phase blocker appended only after drafting.
Fail closed: "cannot cleanly confirm" is treated as absent — rules out drafting on an ambiguous read.
A prerequisite counts as confirmed only when its behavior is observable in committed code, tests, or docs in the repo; prose describing future/in-flight work does not count — rules out an unbounded "legibly present" read that, being fail-closed, would block shippable work on a softer or harder bar than this.
The gate's input is the intent's `## Prerequisites` section, not arbitrary intent prose — rules out widening the prompt's intent-as-data firewall to general intent text.
An empty or bareword-`none` `## Prerequisites` body means no prerequisites and skips the gate — rules out treating a stale `none` body (still present in entry-validation fixtures) as a prerequisite named "none".
The judgment is internal agent reasoning; on a pass nothing is written to `intent.md` — rules out the agent recording "prerequisites confirmed: X" into `intent.md`, which `isValidIntentModification` would reject as a non-blocker edit and surface as a confusing "intent.md was modified" failure on the success path.
A gate blocker bypasses `intent.md` frontmatter/prose integrity validation, same as any agent blocker today (the blocker check returns before integrity validation); the write-boundary checks still revert out-of-bounds files — rules out integrity validation re-flagging the blocker append as an illegal edit.
Same gate path for every prerequisite — rules out a backfill special-case for already-shipped behavior.
Reuse the existing `## Blocker` stop/commit/stderr plumbing for the failure exit — rules out a new bespoke prerequisite exit code or message.
Move the `hasGenuineBlocker` check ahead of the `index.md`-exists check in `validateDraftOutput` — rules out the current order, where a gate that writes nothing fails as "index.md was not created" instead of surfacing the blocker body. Without this the stderr would not name the unconfirmed behaviors and the stop would read as a generic validation failure.
Gate text lives in the assembled `plan.prompt.draft` step (source `prompts/plan/draft.md`), bumping its revision from 7 to 8 — rules out a non-snapshotted prompt edit that drifts review-invisibly.
Phrase prerequisites in the gate as behaviors verifiable against repo files, not intent filenames/dirs/branches/PRs — rules out anchoring the contract to the artifact that delivered the behavior.

Deferred to first consumer: any machine-readable per-behavior confirmation format — pin when a caller needs it. The gate is an agent legibility judgment over prose prerequisites; nothing parses individual behaviors today.

## Tasks

- Add a prerequisite gate as the first instruction block in `prompts/plan/draft.md`:
  before producing any spec content, read existing repo files; for each behavior in
  the intent's `## Prerequisites` section, confirm it is observable in committed
  code, tests, or docs (prose about future work does not count); if any cannot be
  cleanly confirmed, append `## Blocker` naming each unconfirmed behavior and
  produce no `index.md`/subspecs. State that the judgment is internal reasoning:
  on a pass write nothing to `intent.md`. Treat an empty or bareword-`none`
  `## Prerequisites` body as no prerequisites — skip the gate and draft normally.
  Bump the prompt `revision` from `7` to `8`.
- Reorder `validateDraftOutput` (`v1/src/modes/plan/draft.ts`) so a genuine
  `## Blocker` in `intent.md` is recognized before the `index.md`-exists check
  (it already wins over the subspec-count and intent-modification checks), so a
  gate that writes nothing — whether zero files or partial files — stops as a
  blocker (exit 1) with the blocker body on stderr rather than an "index.md was
  not created" validation error.
- Regenerate the rendered draft snapshot fixture at the new revision
  (`v1/test/fixtures/prompts/rendered/plan.prompt.draft@r8.shared.txt`) and update
  the single revision assertion in `v1/test/prompts/rendered-snapshots.test.ts`
  from `7` to `8` (the fixture-name key derives from that value automatically).
- Add/extend tests (scripted fake-agent output driving the existing
  stop/commit/stderr plumbing, not a model-in-the-loop): draft prompt contains
  the gate text; `validateDraftOutput` treats a blocker-with-no-index as a blocker
  (not an index error); a satisfied-prerequisites draft proceeds; an unconfirmable
  prerequisite blocks and names the behavior; empty/no prerequisites draft
  normally.

## Acceptance criteria

- [x] `jarvis1 plan <ready-intent>` exits non-zero and writes no `index.md` or numbered subspecs when a declared prerequisite behavior cannot be confirmed in existing repo files.
- [x] On that failure, stderr includes the blocker body naming each unconfirmed prerequisite behavior.
- [x] The prerequisite judgment happens before any spec content is produced, so a failed gate runs no review passes (the draft-blocker path returns before the review phase in `v1/src/commands/plan.ts`) and produces no `index.md`/subspec files.
- [x] A ready-intent whose declared prerequisite behaviors are legibly present in the repo proceeds into normal spec drafting (and review).
- [x] A ready-intent with an empty or bareword-`none` `## Prerequisites` body proceeds into normal spec drafting without a gate failure.
- [x] `validateDraftOutput` reports a genuine `## Blocker` in `intent.md` as a blocker even when no `index.md` exists, instead of an "index.md was not created" error; a partial-file gate failure (blocker present, some files written) and a zero-file gate failure behave identically.
- [x] The assembled `plan.prompt.draft` prompt instructs the draft agent to confirm each behavior in the intent's `## Prerequisites` section against existing committed repo files (code, tests, or docs) as its first action, to fail closed (treat "cannot confirm" as absent) by appending `## Blocker`, and to write nothing to `intent.md` on a pass.
- [x] No completion record, behavior ledger, or `v2/docs/v1-behaviors.md` completion entry is added or required by the mechanism.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: document the prerequisite gate as a **draft-phase** check in Phase 1 (Draft) — first-action repo-file read, fail-closed semantics, and the non-zero blocker exit naming unconfirmed behaviors with no spec/review work done. Keep the plan-entry sentence accurate: entry validation still only checks the `## Prerequisites` section is present and does not enforce it; qualify it to point at the draft gate as where enforcement happens, rather than flipping it to "enforced at plan entry".
- `v1/docs/spec-guidance.md`: note that `## Prerequisites` entries must be phrased as behaviors an agent can verify against existing committed repo files (code, tests, or docs — not intent filenames, spec dirs, branches, or PRs), since the draft gate reads them that way and fails closed.
- `v2/docs/v1-behaviors.md`: update only the draft/review-prompt-context bullet (the one stating ready-intent `## Prerequisites` are "included in draft/review prompts as context but are not validated, resolved, or enforced") to record the new draft-agent gate; update the draft bullet to note `validateDraftOutput` recognizes a `## Blocker` ahead of the `index.md`-exists check. Leave the separate plan-entry-validation bullet (prerequisites validated present at entry, not enforced) accurate and unflipped.
