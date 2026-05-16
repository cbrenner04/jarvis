# Plan mode — draft and self-review

repo: git@github.com:cbrenner04/jarvis.git

Replace the placeholder spec content from
`spec/plan-mode-worktree-and-commits/` with **real agent-generated**
output. Add the draft phase (one agent call that produces
`spec/<name>/index.md` plus atomic subspecs from `intent.md`) and the
self-review phase (N agent passes that re-edit those files in place,
default 2). Wire in stop conditions and blocker handling.

After this spec merges, `jarvis plan <intent-file>` and `jarvis plan
"<text>"` are end-to-end useful for the non-interactive cases: the user
gets a draft PR containing a real, atomic-subspec spec tree they can
review, edit, mark ready, and merge to `main`.

## What this spec does *not* do

- **No interview phase.** Interactive mode still hits the skeleton stub.
  Interview lands in `spec/plan-mode-interview/`.
- **No agent-proposed names.** Naming stays deterministic from
  `spec/plan-mode-worktree-and-commits/02`. Agent-proposed names land
  in `spec/plan-mode-interview/03`.
- **No `--resume`.** Still parsed, still inert. Resume lands in
  `spec/plan-mode-resume-and-handoff/`.

## Decisions

- **Depends on `spec/plan-mode-worktree-and-commits/` being merged.**
  This spec assumes the worktree, branch, intent file, two phase
  commits, and draft PR all already work (with placeholder content).
- **Real draft phase replaces placeholder.** The placeholder
  `index.md` and `00-task.md` currently written by `commitPlanDraft`
  in `src/modes/plan/commits.ts` are no longer written. Instead, after
  the `plan: interview` commit lands and is pushed, the draft phase
  runs an agent that reads `intent.md`, the target repo for context,
  and `docs/spec-guidance.md`, then writes `spec/<name>/index.md` plus
  one or more atomic subspec files. Those files are committed as
  `plan: draft` and pushed.
- **Real self-review phase.** After `plan: draft` is pushed, run
  `--review-passes` agent invocations. Each pass reads the current
  `intent.md` and spec files, re-edits the spec files in place, and is
  committed as `plan: review <N>` (1-indexed) before the next pass
  begins. Each commit is pushed immediately. Default passes: 2.
  `--review-passes 0` skips this phase entirely (only the draft commit
  exists).
- **Agent selection.** Use `config.modes.plan.agentOrder`. There is no
  fallback to patch-mode order; config v2 requires both mode orders to be
  explicit. Same per-agent quota fallback chain as patch mode: if the chosen
  agent reports a quota signal, advance to the next; if all are exhausted,
  exit with the existing quota-exhausted exit code and message text.
- **Single agent per phase.** Each draft or review pass is a single
  agent invocation (no inner loop). The agent is given a focused prompt
  for that phase. We do not let the agent decide when to stop editing;
  the call ends when the agent ends.
- **Prompts live in `src/modes/plan/prompts/`** as separate files (e.g.
  `draft.md`, `review.md`), mirrored on patch mode's
  `src/modes/patch/rules.md`. The prompts are short, reference the
  injected `intent.md` content and `docs/spec-guidance.md`, and tell
  the agent to produce only files under `spec/<name>/`.
- **Stop conditions during draft/review:**
  - All passes complete → continue to PR open (already done by previous
    spec) and exit `0`.
  - Ctrl-C → propagate signal, leave commits/branch/PR as-is, exit
    `130` (standard SIGINT exit code, matching what `jarvis run` does).
  - Agent-side quota exhaustion across all candidates → exit with the
    existing quota-exhausted code/message used by `jarvis run`.
  - **Blocker.** If an agent appends a `## Blocker` section to
    `spec/<name>/intent.md` (case-sensitive `Blocker`, exact heading
    text per `docs/spec-guidance.md`), plan mode stops the
    draft/review loop, commits whatever spec files exist plus the
    updated `intent.md` as `plan: blocker`, pushes, and exits `1` with
    the blocker section printed to stderr. The PR (already open in
    draft) reflects the blocker for the human reviewer.
- **PR body updates live on each `plan: ...` commit** via the same
  rewrite path patch mode uses (`updatePrBody` in `src/pr.ts`,
  combined with a plan-mode header builder; today
  `buildPlanPrHeader` in `src/modes/plan/pr.ts` produces the
  deterministic header but is only invoked once at PR open). This
  spec wires that rewrite into the new commits introduced here
  (`plan: draft`, `plan: review N`, `plan: blocker`); the
  deterministic header is rebuilt, the attribution footer
  re-renders from the `Jarvis-Agent` trailers on every plan commit
  on the branch (including the existing `plan: interview` commit),
  and the narrative section between the
  `<!-- jarvis:narrative:start -->` / `<!-- jarvis:narrative:end -->`
  markers is preserved verbatim across rewrites. Plan mode does not
  yet write into the narrative section in this spec — that may land
  in a later spec — but the existing preserve-narrative behavior of
  the shared helper means doing so later is purely additive.
- **Idempotence on re-run.** If `jarvis plan` is re-run with the same
  intent and the worktree already exists with prior commits, this spec
  does not handle resume — that is the next spec. For now, the
  worktree-collision rule from
  `spec/plan-mode-worktree-and-commits/01` applies: re-runs against an
  existing worktree fail with the documented message.

## Subspecs

> **Preflight:** the worktree-and-commits spec is merged on `main`
> (commit `dcf5f47`). The harness today already produces a `plan/<name>`
> worktree and branch, seeds `intent.md`, lands `plan: interview` and
> placeholder `plan: draft` commits, pushes both, and opens a draft PR
> via `planCommand` in `src/commands/plan.ts`. Read `src/commands/plan.ts`
> and `src/modes/plan/{commits,pr}.ts` before subspec 01 to confirm the
> exact insertion points; do not run an actual `jarvis plan` invocation
> as a smoke test (it would push a stray branch and open a real PR on
> the remote).

- [x] [01 — Draft phase (real agent call replaces placeholder)](./01-draft-phase.md)
- [x] [02 — Self-review phase with `plan: review N` commits](./02-self-review-phase.md)
- [x] [03 — Stop conditions and blocker handling](./03-stop-conditions-and-blockers.md)
- [x] [04 — Documentation updates](./04-docs-updates.md)

## Conventions

- Run this spec with `jarvis run spec/plan-mode-draft-and-review/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Adding the interview phase.
- Adding the resume command.
- Changing the draft PR title/body.
- Changing patch-mode behavior.
