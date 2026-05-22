# V1 behavior catalog

repo: cbrenner04/jarvis

Produce `v2/spec/v1-behaviors.md` as the reviewable source of truth for every
user-observable v1 behavior that v2 must consciously preserve, change, or drop.
The catalog is derived from v1 source first, with docs/help/tests used only as
cross-checks. It documents behavior as shipped today under `v1/`, while noting
that the `jarvis` -> `jarvis1` rename is still pending.

## Subspecs

- [x] [00 — Skeleton, commands, and project resolution](./00-skeleton-commands-and-project-resolution.md)
- [x] [01 — Agents, models, pricing keys, and quota fallback](./01-agents-models-pricing-and-quota.md)
- [x] [02 — Git, GitHub, worktrees, and attribution](./02-git-github-worktrees-and-attribution.md)
- [x] [03 — Plan mode behavior catalog](./03-plan-mode-behavior-catalog.md)
- [x] [04 — Side effects, completion, blockers, and failures](./04-side-effects-completion-and-failures.md)
- [x] [05 — Maintenance rule, reminder docs, and final verification](./05-maintenance-reminder-and-final-verification.md)

## Conventions

- Land this tree on `main` as a spec-only PR before any implementation run.
- Complete one subspec per iteration. Subsequent subspecs may append to
  `v2/spec/v1-behaviors.md` but must not remove already-authored sections
  except to correct inaccuracies discovered during their audit.
- Subspec 00 defines the catalog's fixed top-level section order, subsection
  skeleton, and citation format. Later subspecs should fill those sections in
  place rather than inventing a new layout.
- Treat v1 source as the primary authority. Use docs, tests, help output, and
  command fixtures only to cross-check or clarify what the source already
  indicates.
- Keep entries short and behavior-focused. Document what users observe, not the
  internal call graph or proposed v2 design.
- Every catalog entry added in subspecs 00–04 must be a short bullet that ends
  with a `Sources:` citation naming the v1 source file(s) that support it.
- Keep plan-mode workflow detail inside the dedicated `### Plan mode`
  subsection under `## Commands and modes`; do not create a separate top-level
  plan section later in the tree.
- If source leaves behavior or intent ambiguous, record it in the catalog with
  an `[uncertain]` tag plus a brief explanation of what is unclear and what a
  later reviewer should decide.
- Subspec 04 owns the final consolidation of `## Behaviors with uncertain
  intent` and `## Surprising or possibly vestigial behaviors`; earlier
  subspecs may seed those sections only when a behavior clearly belongs there.
- Subspec 05 places the out-of-catalog maintenance reminder in
  `v2/spec/wip-intents/v2-vision.md`, not `AGENTS.md`, so the reminder stays
  attached to the v2 rollout context that introduced this catalog.
- If blocked, append `## Blocker` to the active subspec and stop.
