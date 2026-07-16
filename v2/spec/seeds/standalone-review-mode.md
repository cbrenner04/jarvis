# Review is a modifier, not a mode

The review subsystem — critic and debate — is fully built, but you can only get
at it as an inner step of `intent`, `plan`, or `implement` (via `--review-passes`
/ `--review-behavior`). It always reviews the artifact the same run just wrote.
There is no way to point review at something that already exists — a merged PR, a
committed spec, a file on disk — and get a verdict.

Make `review` a first-class workflow preset alongside `intent`, `plan`, and
`implement`, consuming an existing artifact instead of one it just produced.

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
  adjudicator → actuator). Deliberately *not* spelled `--review-behavior light|
  debate`: standalone, "critic" names the distinctive role and is shorter to type.
- **`--actuator`** — the *only* thing that authorizes a write. Absent: run the
  read-only roles, emit the verdict artifact, stop. Present: append the actuator
  role, which applies fixes.

## Why this shape

- **The 80% already exists.** Both cycles, the executable roles (`critic`,
  `adversary`, `advocate`, `adjudicator`, `actuator`), the per-domain prompt
  profiles (`shared/prompts/review-profile.ts` + `prompts/{intent,plan,patch}/
  review-*.md`), verdict artifacts, and model-config rungs are all shipped. This
  seed exposes them standalone; it does not rebuild them.
- **`--actuator` is an existing seam, not a new one.** In both cycles every role
  is read-only *except* the actuator. "Omit `--actuator`" = drop the one writing
  role. Verdict-only is the natural read-only prefix of the full cycle.
- **Explicit domain kills the plan-vs-intent ambiguity.** A spec target cannot
  self-disambiguate between the intent and plan profiles; requiring the domain
  positional removes the guess entirely.

## Decisions

- **Domain is a required positional, never inferred.** No `--domain` flag, no
  path heuristics. If the domain is missing, the command errors.
- **`--actuator` is the sole write authorization.** Without it, review is
  read-only against the subject; the verdict artifact is still written (it is the
  product of the read-only run, not a mutation of the subject).
- **Actuator writes land at the target.** Local file/dir target → edit in place in
  a worktree and commit. **PR-link target → commit and push to the PR branch.**
  (Accepted for now that `--actuator` on a PR pushes to that branch — outward-
  facing, but the operator opted in by passing both `--target <pr>` and
  `--actuator`.)
- **`--type critic|debate`**, not `light`. New surface, new name; the three
  existing presets keep their `--review-behavior light|debate` flag unchanged —
  no migration.
- **No new roles, executors, prompts, or profiles.** Reuse
  `executeReviewCycle` / `executeReviewDebate` and the domain profiles verbatim.
- **The standalone builder emits a single review step with no write step ahead of
  it.** This is the structural inversion: existing builders emit `write → review`;
  this one emits `review` alone, its subject supplied by target resolution.

## Scope

- **Target resolution** (net-new): PR link → fetch/checkout the diff into a
  worktree; local dir/file → operate in a worktree copy (or in place). Produce the
  same subject context the inner reviewers get today from the preceding write
  step's outputs.
- **`buildReviewWorkflowSteps`** — sibling to the three existing builders; emits
  one `review` / `review-debate` step, domain-selected profile, no leading write,
  actuator role included iff `--actuator`.
- **Preset registry** — add `review` to `WORKFLOW_PRESET_BUILDERS`
  (`v2/src/execution/workflow-presets.ts`).
- **Runner validation** — add `review` to `WORKFLOW_PRESET_LENGTHS` and generalize
  `WORKFLOW_PRESET_PINNED_FIELDS` (`v2/src/execution/workflow-runner.ts`), whose
  current entries assume a `plan`/`implement` write role; review's role is
  behavior-selected.
- **CLI** — `parseReviewWorkflowArgs` + usage string + `runWorkflowCommand`
  wiring (`v2/src/cli.ts`), reusing the existing `--review-passes`/type parsing
  helpers where they fit.
- **Config** (optional) — `modes.review` / `projects.<k>.review` defaults for
  `type` and actuator, mirroring the implement review-config readers.

## Prerequisites

- The shipped review subsystem: `20260715T232510Z-workflow-review-options`,
  `20260714T162422Z-review-workflow-composition`, `review-behavior`,
  `review-debate-behavior` (all completed). Nothing new blocks this.

## Out of scope

- New review *content* — no new roles, prompts, cycles, or scoring. Behavior of
  critic/debate is unchanged; only the entry point is new.
- NL routing to `review` (that is the `nl-router` seed's concern once this exists).
- A verdict-comment-on-PR integration (posting the verdict back to the PR as a
  comment) — verdict-only writes the verdict artifact; wiring it to a PR comment
  is a follow-up, not this seed.
- Reviewing arbitrary git ranges / multiple targets in one run — single subject.

## Reference

- `v2/src/execution/review-cycle.ts`, `review-debate.ts` — the two executors.
- `shared/prompts/review-profile.ts` — the domain profiles this reuses.
- `v2/src/execution/publication-workflow-steps.ts`,
  `implement-workflow-steps.ts` — the `write → review` builders this inverts.
- `v1/spec/completed/2026-06-07T19-57-26Z-review-debate/intent.md` — the original
  debate rationale.

## Documentation updates

- `v2/docs/workflow-runner.md` — add `review` as a first-class preset; document
  target resolution, the domain positional, `--type`, and `--actuator` write
  semantics (incl. PR-branch push).
- `v2/docs/prompts.md` — note the profiles are now reachable standalone.
- `v2/docs/v2-architecture.md` — review joins intent/plan/implement as an
  invocable operation, and is the first that consumes rather than produces an
  artifact.
