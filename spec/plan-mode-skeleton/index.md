# Plan mode — skeleton

repo: git@github.com:cbrenner04/jarvis.git

Introduce `jarvis plan` as a recognized subcommand with the full CLI surface
(flags, input modes, target-repo resolution, log-server requirement, new
config key) but **no planning behavior**. After this spec merges, running
`jarvis plan ...` parses arguments, resolves the target repo, validates the
log server is reachable, and exits non-zero with a clear "not yet
implemented" message for any actual planning work. Subsequent plan-mode
specs hang real behavior off this scaffolding.

## Why a skeleton spec first

Plan mode is large enough that landing it as a single PR would violate the
"atomic, testable, reviewable" subspec rule and produce a sprawling commit
graph. Splitting into five top-level specs lets each PR merge on its own
merits, gives reviewers smaller diffs, and produces working partial state
after each merge. The skeleton exists so that later specs can attach
behavior without also having to re-litigate flag names, config keys, or
log-server semantics.

This spec is intentionally inert: it changes the user-visible CLI surface
and config schema, but the only end-to-end behavior is "exit with a stub
message." That keeps the diff small and the review focused on shape, not
behavior.

## Decisions

- **No agent calls in this spec.** The agent factory is not exercised from
  the plan-mode code path. A later spec wires the draft and self-review
  phases into real agent invocations.
- **No worktree, no branch, no commits, no PR.** Those are introduced in
  `spec/plan-mode-worktree-and-commits/`. A `jarvis plan` invocation in
  this spec must not create or mutate any worktree, branch, commit, or PR.
- **No `intent.md` file written.** The intent file is introduced alongside
  the worktree machinery in the next spec, since it is the first artifact
  committed on the plan branch.
- **`planAgentOrder` config key is added now**, even though no agent runs
  yet, because validation and the `jarvis config` subcommands need to
  accept and round-trip it before any later spec can consume it.
- **Stub exit message is uniform.** Every input mode that would otherwise
  start the planning phases prints the same `plan mode: not yet
  implemented (skeleton landed; behavior arrives in subsequent specs)`
  message to stderr and exits with code `2` (reserved for "intentionally
  unimplemented surface"). Argument-parse errors and resolution failures
  keep their normal exit codes (`1` and friends), so reviewers and tests
  can tell stub from real failure.
- **Strict ordering with later specs.** Plan-mode specs must merge in this
  order:
  1. `plan-mode-skeleton/`
  2. `plan-mode-worktree-and-commits/`
  3. `plan-mode-draft-and-review/`
  4. `plan-mode-interview/`
  5. `plan-mode-resume-and-handoff/`

  Each later spec assumes the previous ones are merged. This is enforced
  socially (PR review, this index), not by code. To make accidental
  out-of-order runs fail loudly, each later spec's `index.md` lists a
  one-line preflight check at the top of its task list ("verify the
  prior spec's behavior is observable") so an implementer running the
  spec out of order notices immediately.
- **Docs are bundled into a final per-spec subspec, not per-task.** The
  `AGENTS.md` rule that "doc changes are part of the work, not a
  follow-up" is satisfied at the **per-spec** level, not the
  per-subspec level: each top-level plan-mode spec includes a final
  `NN-docs-updates.md` subspec, and the docs land in the same merged
  spec PR. We bundle because the bulk doc work (notably the eventual
  `docs/plan-mode.md`) reads naturally only after the cumulative
  behavior of a whole spec is in place; per-subspec doc deltas would
  produce churn that obscures the final shape. Each subspec still
  declares "None. Subspec NN covers docs." in its `## Documentation
  updates` section so the bundling is visible at the subspec level.

## Subspecs

- [ ] [01 — `jarvis plan` subcommand and help](./01-cli-subcommand-and-help.md)
- [ ] [02 — Input modes (file, inline, no-args) parsing](./02-input-modes-parsing.md)
- [ ] [03 — Target-repo resolution shared with `jarvis run`](./03-target-repo-resolution.md)
- [ ] [04 — `planAgentOrder` config key](./04-plan-agent-order-config.md)
- [ ] [05 — Log-server requirement](./05-log-server-requirement.md)
- [ ] [06 — README and docs stub](./06-readme-and-docs-stub.md)

## Conventions

- Run this spec with `jarvis run spec/plan-mode-skeleton/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop.

## Non-goals

- Implementing any phase of plan mode (interview, draft, self-review,
  resume). Those land in subsequent top-level specs.
- Changing patch-mode behavior. Plan mode shares config keys (`agentOrder`,
  `logServerUrl`, etc.) but does not modify how `jarvis run` consumes them.
- Adding `opencode` or any other agent to default `planAgentOrder`. Default
  is empty/unset; falls back to `agentOrder` at consumption time (consumed
  by spec 3).
