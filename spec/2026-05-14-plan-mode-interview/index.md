# Plan mode — interview phase and interactive mode

repo: git@github.com:cbrenner04/jarvis.git

Add the interview phase: structured `question`-tool batches the agent
conducts with the user, persisted to `spec/<name>/intent.md` between
turns. Enable `jarvis plan` with no arguments to drop into the
interview. Replace the deterministic spec-name derivation from
`spec/2026-05-14-plan-mode-worktree-and-commits/02` with an agent-proposed kebab-case
name (still with collision auto-rename).

After this spec merges, all three input modes (file, inline,
interactive) work end-to-end through interview → draft → self-review →
draft PR.

## Decisions

- **Depends on `spec/2026-05-14-plan-mode-draft-and-review/` being merged.** Real
  draft and review phases must exist before interview makes sense.
- **Interview happens before draft, in all modes by default.** Even
  file and inline modes run the interview; the seed text becomes the
  starting point of `intent.md` and the agent decides how many
  follow-up questions to ask within the budget.
- **Budget:** `--interview-turns N`, default 3, configurable via the
  flag the skeleton already parses. `0` disables the interview phase
  entirely (useful for "I trust my intent text, just go").
- **Interview is the new first phase.** The previous spec sequence was
  draft → review. After this spec, the sequence is interview → draft →
  review. The interview phase produces (and pushes) the `plan:
  interview` commit, which previously contained only the seeded
  `intent.md`. Now it contains the seeded text plus interview-derived
  additions.
- **Question format.** Each interview "turn" is one structured
  `question`-tool invocation by the agent that asks **one or more**
  multiple-choice questions in a single batch (mirroring how this
  spec was authored). The agent decides how to batch within a turn.
- **Persistence.** After each turn, the agent appends a section to
  `intent.md`:

  ```md
  ## Interview turn <N>

  ### <Question header>
  - Question: <full question text>
  - Answer: <user's selected label or typed answer>

  ### <Next question header>
  - ...
  ```

  Plan mode validates after each turn that `intent.md` grew by exactly
  one new `## Interview turn N` section (with N = next expected
  number) and that nothing earlier was modified. Violations exit `1`
  with a precise message; the worktree stays for inspection.
- **Stop early.** The agent may stop asking before the budget is
  exhausted by simply not invoking the `question` tool on a given
  turn. Detection: if a turn produces no `question` tool call and no
  `intent.md` modification, treat the interview phase as complete.
- **Agent uses the existing `question` tool.** The plan-mode prompt
  for the interview phase tells the agent it has access to the
  `question` tool and instructs it to use it to gather information
  needed to write a good spec. The harness routes the question to the
  user via the same UX that exists today for the `question` tool.
- **Interactive mode (`jarvis plan` with no args).** This spec
  replaces the skeleton stub for interactive mode with: create
  worktree, write empty `intent.md` (one line `# Intent` heading
  only), run interview phase normally. Subsequent phases are unchanged
  from `spec/2026-05-14-plan-mode-draft-and-review/`.
- **Agent-proposed spec name.** The deterministic name derivation
  from `spec/2026-05-14-plan-mode-worktree-and-commits/02` is replaced with an
  agent-proposed name. The interview-phase prompt instructs the agent
  to **also** propose a kebab-case `<name>` based on the intent it has
  gathered, write it to `intent.md` as a `name: <kebab-case>` line in
  a leading frontmatter-ish block, and stop the interview after
  proposing it. Plan mode reads the proposed name, applies the
  uniqueness loop from
  `spec/2026-05-14-plan-mode-worktree-and-commits/02-spec-name-proposal.md` (suffixing
  on collision), and uses the result for the worktree, branch, and
  spec directory.
- **Naming bootstrap problem.** The agent needs a worktree to write
  `intent.md` into, but the worktree path includes `<name>`. We solve
  this with a two-stage worktree: the interview phase initially uses
  a temporary worktree at `.worktree/plan-tmp-<short-uuid>/` on a
  temporary branch `plan/tmp-<short-uuid>`. Once the agent has
  proposed a name and the uniqueness loop has chosen the final name,
  plan mode renames the worktree directory and the branch to the
  final values:
  - `git worktree move .worktree/plan-tmp-X .worktree/plan-<name>`
  - `git -C .worktree/plan-<name> branch -m plan/<name>`
  - Force-update tracking with `git -C .worktree/plan-<name> push -u
    origin plan/<name>` (the temp branch was never pushed; this is
    the first push).
  - Delete the now-orphaned temp branch locally with `git branch -D
    plan/tmp-X` if it lingers.
- **Interview commit landed only after rename.** The `plan: interview`
  commit is created and pushed **after** the rename so the remote
  branch and pushed commit always use the final name. This avoids
  having a `plan/tmp-*` branch ever appearing on origin.
- **File and inline modes still pre-seed `intent.md`** in the
  temporary worktree before the interview begins, exactly as before.
  The agent reads that text as starting context for its questions.
- **`--interview-turns 0` skip path.** When the budget is 0:
  - File and inline modes: skip the interview entirely. The agent is
    *still* invoked once with a "naming-only" prompt to propose a
    `name: ...` line. This keeps naming under the agent's control
    even when the interview is skipped. If the agent fails to
    propose a name, fall back to the deterministic derivation from
    the previous spec (with a stderr note: `plan: agent did not
    propose a name; using deterministic derivation`).
  - Interactive mode: error and exit `1`. Interactive mode without an
    interview is degenerate (no input at all). Print: `plan: --interview-turns 0
    is incompatible with interactive mode (no intent provided)`.
- **Quota fallback applies to interview turns** the same way it does
  to draft and review.
- **Blocker convention applies during interview** too: the agent may
  append `## Blocker` to `intent.md` instead of completing the
  interview. Same handling as in
  `spec/2026-05-14-plan-mode-draft-and-review/03`.

## Subspecs

> **Preflight (do not skip):** before starting subspec 01, verify the
> draft-and-review spec is on `main` by running `jarvis plan` against a
> throwaway intent file and confirming the resulting PR contains real
> agent-generated subspecs (not placeholder content) plus
> `plan: review` commits. If the spec content is still placeholder, the
> prior spec has not landed — stop and resolve before continuing.

- [ ] [01 — Interview phase with persistent `intent.md` updates](./01-interview-phase.md)
- [ ] [02 — Interactive mode (`jarvis plan` with no args)](./02-interactive-no-args.md)
- [ ] [03 — Agent-proposed spec name with worktree rename](./03-agent-proposed-spec-name.md)
- [ ] [04 — Documentation updates](./04-docs-updates.md)

## Conventions

- Run this spec with `jarvis run spec/2026-05-14-plan-mode-interview/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Adding the resume command. Lands in
  `spec/2026-05-14-plan-mode-resume-and-handoff/`.
- Changing the draft or self-review phases beyond what is needed to
  consume the new `intent.md` shape.
- Changing the PR title/body.
