---
name: plan-intent-refine-flow
---

# Plan mode: one shape — intent step, then refine

Today `jarvis1 plan` has three front-end shapes (file / inline / no-arg) and a
Phase-0 gate that commits a *synthetic* `## Blocker` after refine, forcing the
human to enter the worktree, delete a comment jarvis wrote itself, commit, and
`--resume-draft`. The common case is "accept the refinement and continue," so
that dance is pure friction. Inline mode dead-ends (no branch/PR). And intent is
now almost always authored *through* jarvis, not hand-written — so intent
creation should be a first-class, committed step like the rest of the pipeline,
not a separate one-shot.

Collapse to one shape:

```
jarvis1 plan "some cool prompt"
  → draft intent + propose name + create branch   → commit  plan: intent
  → refine (default 1 turn, skip allowed)          → commit  plan: refine
  → open draft PR, exit 0   (clean stop; not a blocker)
  --- human reviews the PR ---
jarvis1 plan --resume-draft <intent>
  → draft subspecs → review passes      (unchanged)
```

## Decisions (made — do not relitigate in plan)

1. **Two commits, accurate history.** Intent creation is its own committed step
  (`plan: intent`: drafts intent.md from the seed, proposes `name:`, creates the
   branch), then `plan: refine` on top. The ~83% refine-rate in telemetry says
   that second step earns its keep.
2. **One refine turn by default.** `--refine-turns` default drops 3 → 1. Skip
  stays the signal: the agent may `## Refine skip` and no-op the turn. Override
   to 2+ for the rare deep case. `--refine-turns 0` (intent-only, no refine)
   stays legal.
3. **Inline folds in; positional arg is just the seed.** A positional argument —
  inline text *or* a file path — seeds the intent step. No separate inline
   one-shot path. The old inline-draft prompt is repurposed as the intent-draft
   step, not a dead-end.
4. **Drop no-arg mode.** `jarvis1 plan` with no seed is removed (never used).
5. **Drop the synthetic Phase-0 gate blocker.** Stopping after refine is a clean
  `exit 0` with a next-steps block ("review the PR, then `--resume-draft`"),
   not a manufactured `## Blocker` + exit 1. The understanding that the human
   reviews before resuming is documented, not enforced via a deletable comment.
6. **Naming moves into the intent step.** The intent-draft agent proposes
  `name:`; refine no longer owns naming. The temp-worktree-then-rename machinery
   relocates to wrap the intent step (a worktree is still needed to run the
   naming agent before the branch is named) — complexity moves one step earlier,
   it does not disappear.
7. **Telemetry records per-step outcome.** Add `plan_phase: "intent"` rows and an
  outcome field (`refined | skip | blocker`) on intent/refine rows, so "how
   often does refine skip" is queryable, not reconstructed from row counts.
8. `commit: false` - Given there is no commit or PR, all steps in `plan` are executed with no stopping.

## Preserve

- **Real blockers unchanged.** An agent-raised `## Blocker` during refine still
commits `plan: blocker` and exits 1. Only the *synthetic* gate blocker dies.
- `**--resume-draft` validation.** Drop the "synthetic blocker must be cleared"
check; still refuse to proceed if a *genuine* `## Blocker` is present.
- Draft/review phases and their commits/stop-conditions are untouched.

## Documentation updates (for the eventual spec)

- `v1/docs/plan-mode.md` — large rewrite: input modes (drop no-arg, fold inline),
phases (`plan: intent` added), `--refine-turns` default, stop conditions (gate
becomes clean exit, synthetic blocker removed), `--resume-draft` validation.
- `v2/docs/v1-behaviors.md` — this changes existing v1 behavior; update the
catalog accordingly.
- `v1/docs/config.md` — if the refine-turns default is documented there.

## Refine skip

No net-new load-bearing decisions found.
