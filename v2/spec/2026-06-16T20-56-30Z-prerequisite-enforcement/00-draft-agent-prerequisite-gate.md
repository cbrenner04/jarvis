# 00 — Draft-agent prerequisite gate

## Problem

Ready-intents carry a `## Prerequisites` section, and `jarvis1 plan` already
inlines it into the draft prompt as context — but nothing acts on it. Today the
draft agent reads prerequisites as prose and drafts regardless
(`v1/docs/plan-mode.md:96`; `v2/docs/v1-behaviors.md:64`). Plan cannot refuse an
intent whose dependency is missing, so prerequisites are operator-honored
comments.

## Decision

- Signal is the repo, judged by the draft agent reading existing files. Rules
  out a behavior ledger / merged-state record / `v1-behaviors.md` entry, which
  drift the moment code changes and nobody re-ticks them.
- "Existing files" is the target-repo checkout the draft agent already runs in
  (the worktree off the base branch in commit mode; `project.root` in
  no-commit mode) — not the jarvis harness repo.
- One agent, no new phase: the existing draft agent makes the call. Rules out a
  dedicated preflight/checker agent or a separate plan phase, doubling agent
  cost and splitting the gate from the work it guards.
- On an unconfirmed prerequisite the agent appends `## Blocker` **to
  `intent.md`** naming each unconfirmed behavior and writes no
  `index.md`/subspecs; the harness maps that to exit `1` with the blocker body
  on stderr (`v1/src/commands/plan.ts:1044-1084`,
  `v1/src/modes/plan/draft.ts:299-310`). Rules out a prerequisite-specific exit
  code / stderr path (duplicates blocker plumbing for no observable gain) and
  routing the blocker to a subspec or bare stderr (the harness detects it only
  in `intent.md`; elsewhere it falls through to the generic "no subspecs"
  error and loses the named behaviors).
- Fail closed: "cannot cleanly confirm" is absent. Rules out defaulting
  unconfirmable behaviors to present, which would let plan draft against a
  missing dependency. A present-but-illegible behavior reading as absent is the
  intended signal it is not legible enough to depend on.
- Same path for everything; no backfill. Rules out a special case for
  pre-existing behavior — shipped behavior is in the repo so the agent sees it;
  in-flight behavior is not.
- A `## Prerequisites` section present but listing no behaviors passes the gate.
  Rules out treating an empty section as a gate failure.
- The gate lives in the `plan.prompt.draft` instruction text; prompt id,
  revision, and the rendered snapshot fixture are the contract, so the
  acceptance criteria name them.

## Tasks

- [ ] Add the prerequisite gate to the draft prompt instruction text
      (`prompts/plan/draft.md`) as the agent's first step, with fail-closed
      semantics; on an unconfirmed prerequisite the agent appends `## Blocker`
      **to `intent.md`** naming each unconfirmed behavior and writes no spec
      files. Bump its `revision` (r7 → r8).
- [ ] Regenerate the rendered snapshot fixture: rename the existing
      `plan.prompt.draft@r7.shared.txt` to the new revision (do not edit it in
      place beside the old one) and write the new content.
- [ ] Update the draft prompt revision assertion (`@r7` → new) in
      `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Add draft-prompt unit assertions in `v1/test/modes/plan/prompts.test.ts`:
      the built prompt contains the gate instruction, its fail-closed wording,
      and a directive to name each unconfirmed behavior in the `intent.md`
      `## Blocker` body.
- [ ] Add behavioral coverage of `runDraftPhase` driving the existing
      blocker/validation path: a satisfied-prerequisites run drafts; an
      unconfirmable-prerequisite run (fake agent appends `## Blocker` to
      `intent.md`, writes no subspecs) yields a blocker outcome surfacing the
      unconfirmed behavior(s) on stderr; an empty-prerequisites run (section
      present, no behaviors listed) drafts.
- [ ] Update docs (see Documentation updates).

## Acceptance criteria

- [ ] `jarvis1 plan <ready-intent>` exits non-zero and produces no `index.md` or
      numbered subspecs when the draft agent cannot confirm a declared
      prerequisite behavior in the target-repo checkout; the appended `intent.md`
      `## Blocker` body, which names each unconfirmed behavior, surfaces on
      stderr.
- [ ] A ready-intent whose declared prerequisite behaviors are legibly present
      in the repo proceeds into normal draft (and review) without a
      prerequisite stop.
- [ ] A ready-intent whose `## Prerequisites` section is present but lists no
      behaviors drafts as before, with no prerequisite-driven stop. (A literally
      absent section is rejected upstream when the ready-intent is consumed, so
      it never reaches the gate.)
- [ ] A failed gate writes no spec files and runs no review pass, so it wastes
      no draft or review work.
- [ ] Fail-closed: a prerequisite the agent cannot cleanly confirm is treated as
      absent (stops the run), not present.
- [ ] No completion record, behavior ledger, separate preflight agent, or
      `v2/docs/v1-behaviors.md` completion entry is added or required by the
      mechanism; the gate reads only existing target-repo files.
- [ ] The `plan.prompt.draft` prompt carries an incremented `revision` (r7 → r8);
      its rendered snapshot fixture under `v1/test/fixtures/prompts/rendered/` is
      renamed to the new revision (not edited in place beside the old `@r7`
      file) and regenerated; and `v1/test/prompts/rendered-snapshots.test.ts`
      asserts the new revision and matches the new fixture.
- [ ] The built draft prompt (asserted in `v1/test/modes/plan/prompts.test.ts`)
      contains the prerequisite-gate instruction, its fail-closed wording, and a
      directive instructing the agent to name each unconfirmed behavior in the
      `intent.md` `## Blocker` body and to run the check before producing spec
      content.
- [ ] Tests cover all three prerequisite cases: satisfied, unconfirmable, and
      empty (section present, no behaviors listed).
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- [ ] `v1/docs/plan-mode.md`: replace "Prerequisites are copied into the spec as
      prompt context but are not validated or enforced at plan entry" (line 96)
      with the draft-agent gate — the draft agent's first-step check of each
      `## Prerequisites` behavior against the target-repo checkout, fail-closed
      semantics, and the non-zero exit via the `intent.md` `## Blocker` stop that
      names unconfirmed behaviors and drafts nothing.
- [ ] `v1/docs/spec-guidance.md`: note that `## Prerequisites` are authored as
      behaviors an agent can verify against existing repo files (not intent
      filenames, spec dirs, branches, or PRs), since the draft agent gates on
      their legible presence.
- [ ] `v2/docs/v1-behaviors.md`: update the plan-draft prerequisite behavior
      (currently "included … as context but are not validated, resolved, or
      enforced") to record that the draft agent now gates on prerequisite
      presence against the target-repo checkout as its first step, fail-closed,
      stopping plan via an `intent.md` `## Blocker` that names unconfirmed
      behaviors; note the mechanism adds no completion record.
- [ ] `v1/docs/prompt-governance.md`: bump the cited plan-draft snapshot
      revision (`draft @r7` → new) in the snapshot-coverage list to match the new
      `plan.prompt.draft` revision.
