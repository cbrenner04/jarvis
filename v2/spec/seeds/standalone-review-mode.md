# Split review out of the write presets

Review — critic and debate — is fully built, but you can only reach it as an
inner step of `intent`, `plan`, or `implement` (via `--review-passes` /
`--review-behavior`). It always reviews the artifact the same run just wrote, and
there is no way to point it at something that already exists — a merged PR, a
committed spec, a file on disk.

Invert this. Two coupled changes:

1. **Add a first-class `review` preset** that consumes an existing artifact.
2. **Remove review from `intent`, `plan`, and `implement`** — they become pure
   *produce* presets; `review` becomes the only *judge* path.

Producing and judging become separate operations you invoke separately.

## Target contract

```
jarvis run workflow review <intent|plan|implement> \
    --target <pr-link|dir|file> --type <critic|debate> [--actuator]
```

- **domain** — required positional (`intent` | `plan` | `implement`). Selects the
  review profile. **Never inferred** — the operator says which. `review implement`
  reads as English: the domain *is* the thing being reviewed.
- **`--target`** — the subject: a PR link, a directory, or a file. This is the one
  net-new capability; every existing review invocation reviews a just-written
  artifact, so target resolution does not exist yet.
- **`--type critic|debate`** — which cycle. `critic` is today's `review` behavior
  (critic → actuator); `debate` is `review-debate` (adversary → advocate →
  adjudicator → actuator). Deliberately *not* `--review-behavior light|debate`:
  standalone, "critic" names the distinctive role and is shorter to type.
- **`--actuator`** — the *only* thing that authorizes a write. Absent: run the
  read-only roles, emit the verdict artifact, stop. Present: append the actuator
  role, which applies fixes.

## Why this shape

- **The 80% already exists.** Both cycles, the executable roles (`critic`,
  `adversary`, `advocate`, `adjudicator`, `actuator`), the per-domain prompt
  profiles (`shared/prompts/review-profile.ts` + `prompts/{intent,plan,patch}/
  review-*.md`), verdict artifacts, and model-config rungs are all shipped. This
  seed re-homes them behind a standalone preset and strips the inline path.
- **`--actuator` is an existing seam, not a new one.** In both cycles every role
  is read-only *except* the actuator. "Omit `--actuator`" = drop the one writing
  role. Verdict-only is the natural read-only prefix of the full cycle.
- **Explicit domain kills the plan-vs-intent ambiguity.** A spec target cannot
  self-disambiguate between the intent and plan profiles; requiring the domain
  positional removes the guess.
- **Clean produce/judge split.** A write preset writes; review judges. No preset
  does both. Simpler builders, simpler runner validation, one review entry point.

## Decisions

- **Domain is a required positional, never inferred.** No `--domain` flag, no
  path heuristics. Missing domain errors.
- **`--actuator` is the sole write authorization.** Without it, review is
  read-only against the subject; the verdict artifact is still written (it is the
  product of the read-only run, not a mutation of the subject).
- **Actuator writes land at the target.** Local file/dir → edit in a worktree and
  commit. **PR-link target → commit and push to the PR branch.** Outward-facing,
  but the operator opted in by passing both `--target <pr>` and `--actuator`.
- **`--type critic|debate`**, not `light`.
- **No new roles, executors, prompts, or profiles.** Reuse `executeReviewCycle` /
  `executeReviewDebate` and the domain profiles verbatim.
- **The write presets stop emitting review steps.** `intent`, `plan`, `implement`
  become single write steps. No `write → review` composite remains, and none is
  reintroduced under another name — running review after a write is a *second*
  command (or a future NL-router / composite concern), not a preset flag.

## Scope — add

- **Target resolution** (net-new): PR link → fetch/checkout the diff into a
  worktree; local dir/file → operate in a worktree copy (or in place). Produce the
  same subject context the inner reviewers get today from the preceding write step.
- **`buildReviewWorkflowSteps`** — sibling to the three write builders; emits one
  `review` / `review-debate` step, domain-selected profile, no leading write,
  actuator role included iff `--actuator`.
- **Preset registry** — add `review` to `WORKFLOW_PRESET_BUILDERS`
  (`v2/src/execution/workflow-presets.ts`).
- **Runner validation** — add `review` to `WORKFLOW_PRESET_LENGTHS`; generalize
  `WORKFLOW_PRESET_PINNED_FIELDS` (`v2/src/execution/workflow-runner.ts`), whose
  entries assume a `plan`/`implement` write role.
- **CLI** — `parseReviewWorkflowArgs` + usage + `runWorkflowCommand` wiring
  (`v2/src/cli.ts`).

## Scope — remove

- **`--review-passes` / `--review-behavior`** from the `intent`, `plan`, and
  `implement` arg parsers and usage strings (`v2/src/cli.ts`).
- **Review-step emission** from `buildIntentWorkflowSteps`,
  `buildPlanWorkflowSteps`, `buildImplementWorkflowSteps`
  (`publication-workflow-steps.ts`, `implement-workflow-steps.ts`) — they emit a
  single write step.
- **Legacy reviewed aliases** — `intent-reviewed`, `plan-reviewed`,
  `plan-reviewed-light` (`LEGACY_WORKFLOW_ALIASES`, and their
  `WORKFLOW_PRESET_BUILDERS` / `WORKFLOW_PRESET_LENGTHS` entries).
- **Per-mode review config** — `projects.<k>.implement.{reviewPasses,
  reviewBehavior}` and any plan/intent review defaults in `modes.plan`
  (`machine-config-loader.ts` readers).
- Preset-length entries collapse: `implement` `[1,2]` → `1`.

**Keep** the review executors, roles, prompts, and profiles — the standalone
preset reuses them. Only the *inline entry points* are removed.

## Sequencing

Land the standalone `review` preset **before or with** the removal, so the review
capability is never absent from `main` between the two changes.

## Prerequisites

- The shipped review subsystem: `20260715T232510Z-workflow-review-options`,
  `20260714T162422Z-review-workflow-composition`, `review-behavior`,
  `review-debate-behavior` (all completed).

## Out of scope

- New review *content* — no new roles, prompts, cycles, or scoring.
- NL routing to `review` (the `nl-router` seed's concern).
- Posting the verdict back to a PR as a comment — verdict-only writes the verdict
  artifact; PR-comment wiring is a follow-up.
- Reviewing arbitrary git ranges / multiple targets in one run — single subject.

## Reference

- `v2/src/execution/review-cycle.ts`, `review-debate.ts` — the two executors.
- `shared/prompts/review-profile.ts` — the domain profiles this reuses.
- `v2/src/execution/publication-workflow-steps.ts`,
  `implement-workflow-steps.ts` — the `write → review` builders this strips.
- `v1/spec/completed/2026-06-07T19-57-26Z-review-debate/intent.md` — original
  debate rationale.

## Documentation updates

- `v2/docs/workflow-runner.md` — `review` as a first-class preset (target
  resolution, domain positional, `--type`, `--actuator` incl. PR-branch push);
  remove the inline review-flags documentation from intent/plan/implement.
- `v2/docs/prompts.md` — profiles are now reached only via the standalone preset.
- `v2/docs/v2-architecture.md` — review joins intent/plan/implement as an
  invocable operation, and is the first that consumes rather than produces.
- `v2/docs/v1-behaviors.md` — record that v2 drops the inline review flags that v1
  exposed (per the "specs changing v1 behaviors update v1-behaviors" rule).
