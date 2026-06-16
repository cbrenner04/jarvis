# 00 — Draft-agent prerequisite gate

## Problem

Ready-intents carry a `## Prerequisites` section, and `jarvis1 plan` already
inlines it into the draft prompt as context — but nothing acts on it. Today the
draft agent reads prerequisites as prose and drafts regardless
(`v1/docs/plan-mode.md:96`; `v2/docs/v1-behaviors.md:64`). Plan cannot refuse an
intent whose dependency is missing, so prerequisites are operator-honored
comments.

## Decision: the signal is the repo, judged by the draft agent

The mechanism is a fail-closed legibility check the **draft agent** performs as
its first action, against existing repo files — not a completion record.

- The signal is the repo. Prerequisite presence is judged by reading existing
  files. Rules out: a behavior ledger / merged-state record / `v1-behaviors.md`
  entry, which drift the moment code changes and nobody re-ticks them.
- One agent, no new phase. The existing draft agent makes the call before
  drafting. Rules out: a dedicated preflight/checker agent or a separate plan
  phase, which would double agent cost and split the gate from the work it
  guards.
- The gate reuses the existing `## Blocker` channel. On an unconfirmed
  prerequisite the agent appends `## Blocker` naming each unconfirmed behavior
  and writes no `index.md`/subspecs; the harness already maps that to exit `1`
  with the blocker on stderr (`v1/src/commands/plan.ts:1044-1084`,
  `v1/src/modes/plan/draft.ts:303-309`). Rules out: a new prerequisite-specific
  exit code / stderr path, which would duplicate the blocker plumbing for no
  observable gain.
- Fail closed. "Cannot cleanly confirm" is treated as absent. Rules out:
  defaulting unconfirmable behaviors to present, which would let plan draft
  against a missing dependency — the exact failure this prevents. A
  present-but-illegible behavior reading as absent is the intended signal it is
  not legible enough to depend on.
- Same path for everything; no backfill. Already-shipped behavior is in the
  repo, so the agent sees it; in-flight behavior is not, so it does not. Rules
  out: a special case for pre-existing behavior.
- Empty / absent prerequisites pass the gate. An intent with no declared
  prerequisite behaviors drafts as it does today. Rules out: treating an empty
  `## Prerequisites` section as a gate failure.
- This is harness work: the gate lives in the `plan.prompt.draft` instruction
  text. Prompt id, revision, and the rendered snapshot fixture are the contract,
  so acceptance criteria below name them.

Gate behavior the prompt instructs (no instruction text is graded as a
deliverable here; criteria verify rendered-prompt content and observed plan
behavior):

- First, before any spec content, read existing repo files and judge each
  `## Prerequisites` behavior.
- Every behavior legibly present → draft normally.
- Any behavior not cleanly confirmable → append `## Blocker` listing each
  unconfirmed behavior, write no spec files, stop.

## Tasks

- [ ] Add the prerequisite gate to the draft prompt instruction text
      (`prompts/plan/draft.md`) as the agent's first step, with fail-closed
      semantics and the `## Blocker` outcome naming unconfirmed behaviors; bump
      its `revision` and regenerate the rendered snapshot fixture.
- [ ] Update the draft prompt revision assertion in the rendered-snapshot test.
- [ ] Add a draft-prompt unit assertion that the gate instruction text and its
      fail-closed wording are present in the built prompt.
- [ ] Add behavioral coverage of `runDraftPhase` driving the existing
      blocker/validation path: a satisfied-prerequisites run drafts; an
      unconfirmable-prerequisite run (agent appends `## Blocker`, writes no
      subspecs) yields a blocker outcome that surfaces the unconfirmed
      behavior(s); an empty/no-prerequisites run drafts.
- [ ] Update docs (see Documentation updates).

## Acceptance criteria

- [ ] `jarvis1 plan <ready-intent>` exits non-zero and produces no `index.md` or
      numbered subspecs when the draft agent cannot confirm a declared
      prerequisite behavior in existing repo files; stderr names each
      unconfirmed behavior.
- [ ] A ready-intent whose declared prerequisite behaviors are legibly present
      in the repo proceeds into normal draft (and review) without a
      prerequisite stop.
- [ ] A ready-intent with an empty or absent `## Prerequisites` section drafts
      as before, with no prerequisite-driven stop.
- [ ] The prerequisite judgment is the draft agent's first action: a failed gate
      writes no spec files and runs no review pass, so it wastes no draft or
      review work.
- [ ] Fail-closed: a prerequisite the agent cannot cleanly confirm is treated as
      absent (stops the run), not present.
- [ ] No completion record, behavior ledger, separate preflight agent, or
      `v2/docs/v1-behaviors.md` completion entry is added or required by the
      mechanism; the gate reads only existing repo files.
- [ ] The `plan.prompt.draft` prompt carries an incremented `revision`, its
      rendered snapshot fixture under `v1/test/fixtures/prompts/rendered/` is
      regenerated for that revision, and `v1/test/prompts/rendered-snapshots.test.ts`
      asserts the new revision and matches the new fixture.
- [ ] The built draft prompt contains the prerequisite-gate instruction and its
      fail-closed wording (asserted in `v1/test/modes/plan/prompts.test.ts`).
- [ ] Tests cover all three prerequisite cases: satisfied, unconfirmable, and
      empty/none.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v1/docs/plan-mode.md`: replace the "Prerequisites are copied into the
      spec as prompt context but are not validated or enforced" statement with
      the draft-agent prerequisite gate — first-step check against existing repo
      files, fail-closed semantics, and the non-zero exit (via the `## Blocker`
      stop) naming unconfirmed behaviors and drafting nothing.
- [ ] `v1/docs/spec-guidance.md`: note that `## Prerequisites` are authored as
      behaviors an agent can verify against existing repo files (not intent
      filenames, spec dirs, branches, or PRs), since the draft agent gates on
      their legible presence.
- [ ] `v2/docs/v1-behaviors.md`: update the plan-draft prerequisite behavior
      (currently "included … as context but are not validated, resolved, or
      enforced") to record that the draft agent now gates on prerequisite
      presence against existing repo files as its first step, fail-closed,
      stopping plan with a blocker that names unconfirmed behaviors; note the
      mechanism adds no completion record.
- [ ] `v1/docs/prompt-governance.md`: bump the cited plan-draft snapshot
      revision in the snapshot-coverage list to match the new `plan.prompt.draft`
      revision.
