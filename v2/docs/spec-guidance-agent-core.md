# Spec Guidance for Agents

This file is stable guidance for agents that need to create or work from Jarvis specs. Operator guidance: [spec-guidance.md](../../v1/docs/spec-guidance.md).

## Authoring contracts

Plan-mode prompts forbid self-referential deliverables: do not write acceptance criteria that only grade prose inside the active spec directory. Criteria must verify target state outside that directory (code, tests, docs, operator behavior, or generated evidence).

Fresh plan runs require a seed. File and inline seeds both enter the same flow: jarvis seeds `intent.md`, preserves the exact raw seed in a dedicated block, runs one non-interactive intent-draft pass to shape the editable draft and propose `name:`, then continues with the normal plan pipeline.

When a seed is too broad for one spec/PR, split it into authored intents first. Intents are split by touched module-boundary surface (persistence, daemon request handling, CLI admission, execution loop, comparable seams), not by symptom, one intent per surface in dependency order. Use these size boundaries:

When a seed touches exactly one module-boundary surface, the emitted intent's `Unsplit rationale:` line and `## Primary implementation surface` section (naming exactly one entry) are not review prose — the plan-draft normalizer reads that declared pair from `intent.md` to suppress boundary splitting on the resulting spec.

- A **subspec** is commit-sized: one atomic, independently testable change.
- An **intent** is behavior-sized: one independently observable behavior that
  can later draft into one spec.
- A **spec** is PR-sized: one reviewable unit made of one or more subspecs.

Treat reviewability as a warning, not a hard cap: if one spec looks likely to land around ~1000 changed lines including tests and docs, split earlier into multiple behavior-sized intents/specs rather than stretching one PR.

Never collapse behavior-sized intents into one oversized subspec (e.g. to mirror a prior single-subspec spec): many small atomic subspecs is the goal, not a smell. When an intent split fans out to N behavior-scoped ready-intents, that is the split working — plan and implement each. Conversely, a single plan fanning out to many subspecs usually means the seed was under-split at the intent stage, not that the plan over-decomposed; the fix is more behavior intents, never a fatter subspec.

For intent files, `seeds/` is the open raw-seed queue and `ready-intents/` is the open authored-intent queue. Successful promotion consumes a file seed: committed mode deletes its worktree copy in the split commit, while no-commit mode deletes it only after every ready-intent is written. Failed promotions leave it queued. Fan-out writes reviewed, one-per-surface intents to `ready-intents/`.

### Intent prerequisites

Authored intents may declare a `## Prerequisites` section listing dependencies: existing code paths, documented behaviors, or shared infrastructure the new spec depends on (e.g., "quota fallback is implemented", "the workspace contains a config file with a `modes` key"). During plan mode's draft phase, the agent checks the target repo to confirm each prerequisite is observable in committed code, tests, or docs. If all prerequisites are cleanly confirmed, drafting proceeds normally. If any prerequisite cannot be clearly confirmed, the agent appends a `## Blocker` section to `intent.md` naming the unconfirmed behavior, writes no spec files, and plan exits non-zero; the operator must resolve the missing behavior or revise the intent. An empty or bareword-`none` `## Prerequisites` body skips the gate entirely and drafting proceeds immediately.

Prerequisites are validation gates, not just context: they ensure every work item lands on a firm foundation. Use this section only for critical dependencies that genuinely block the spec's design (e.g., "v1 quota classification exists" for a plan refactoring it). Do not use prerequisites as a generic checklist of nice-to-haves or incidental reading materials — keep them minimal and specific to the intent's scope.

## Subspecs

Each subspec should be independently implementable and testable. A good subspec has:

- the problem or behavior it covers
- decisions needed to keep the work bounded
- a task checklist for that one slice of work
- acceptance criteria
- required documentation updates

Each subspec should own one module boundary. Use [`shared/module-boundary-surfaces.ts`](../../shared/module-boundary-surfaces.ts) for the canonical surface list and classification contract.

Any spec that changes **existing functionality** (not purely net-new work) must include updating `v2/docs/v1-behaviors.md` in its documentation updates — that catalog is the v1 parity baseline v2 review reads, so a behavior change that skips it silently rots the baseline. Record what the behavior now is, so the v2 plans can later be reconciled against it.

Keep subspecs atomic. If one unchecked item requires unrelated code paths, multiple product decisions, or verification that cannot run independently, split it into separate numbered subspec files and link each one from `index.md`.

### Authored markdown style

Do not hard-wrap authored markdown (specs, ready-intents, seeds, docs, PR bodies): one physical line per paragraph and per list item. Indented continuation lines within a single bullet are fine; do not break bullets or paragraphs at column limits. Do not split acceptance-criterion checkboxes across physical lines. The ready gate's `lint:md` step enforces this via the `no-hard-wrap` custom rule on the lint-covered corpus; repair wrapped prose with `bun run reflow:md` (same globs and ignores as `.markdownlint-cli2.jsonc`).

### Behavioral acceptance criteria

Acceptance criteria describe **observable operator or runtime behavior** — what an implementer or reviewer can verify without mandating incidental layout.

- **Product specs** (target-repo work): state outcomes ("quota exhaustion falls
  through to the next configured agent", "a failed ready gate leaves the PR
  draft"). Stay silent on schema, tables, files, modules, and shapes unless the
  structure *is* the contract (public API surface, wire format, on-disk artifact
  the operator must find).
- **Harness subspecs** (jarvis repo work): may name hooks, telemetry fields,
  prompt IDs, and internal symbols when structure is the contract.

Good (product):

```md
- [ ] Quota exhaustion during patch run falls through to the next configured agent.
```

Bad (product):

```md
- [ ] Quota classification lives in a dedicated module with unit tests.
```

Good (harness, structure is the contract):

```md
- [ ] `patch_phase: "shrink"` is excluded from implementation iteration counts in run summary.
```

#### Behavior-preserving (refactor) ACs: cite the test, don't paraphrase

**Refactor / preservation ACs only.** When an AC's contract is "behavior is unchanged" (a refactor, extraction, or move), write it as **"`<existing-test>` stays green"** — cite the pinning test or source path — instead of paraphrasing what that test asserts. Paraphrasing is where wrong claims enter: an author who restates assumed behavior can assert a falsehood a pre-existing test already disproves (this is what produced the shared-invocation-executor spec defect, where an AC said plan "stops on a hard error" while `plan-draft-hard-error-continue.test.ts` proved the opposite). Writing the AC as a citation forces the author to locate the test and surfaces the real behavior.

Good (refactor):

```md
- [ ] `run.test.ts` review-phase + draft-PR tests stay green (behavior unchanged by the extraction).
```

Bad (refactor — paraphrases behavior the author didn't verify):

```md
- [ ] Plan stops on a hard error.
```

This is **refactor-only** and must not be read as "every AC cites a test." New-behavior ACs are explicitly exempt — they keep the prose form above, backed by *new* tests; requiring them to cite a pre-existing test is nonsensical because the behavior is new. The plan-draft validator enforces this automatically: a preservation/continuation AC (verbs like `preserved`, `unchanged`, `stays`, `stops`, `continues`) that carries no path-like test/source anchor produces a non-blocking `missing-anchor-behavioral-ac` warning at draft time.

#### Rule-out and invariant guards: cite reachability on the base

A criterion that rules out a condition (invariant phrasing such as `may never`, `must not equal`, `rules out`, `neither … may equal`, or `cannot occur`) must cite how that forbidden condition is reachable on the repository base today — a regression or pinning test naming the failure scenario, a production source path with an explicit violation hook at that site, or prose such as `reachable on`, `fails against the pre-fix`, or `constructible on main`. Invariant guards without reachability evidence are plan-review findings under `## Unfalsifiable premises`, not implement-time proof-form fixes.

#### Failing-test requirement for runtime-behavior subspecs

Every subspec that changes runtime behavior must carry an acceptance criterion naming a test that fails against the pre-fix code and passes after the change. This ensures every behavior change lands with a failing-test surface that motivates and validates the work. The test may be newly written or an existing test that was updated to expect new behavior; either way, the AC must name a test that would fail against the baseline and pass against the implementation. "Existing tests stay green" does not satisfy this requirement; that is a preservation criterion (cite it using the refactor AC pattern above), not evidence of new behavior. Docs-only and spec-only subspecs are exempt — only runtime-behavior changes require the failing-test AC.

Good (new behavior):

```md
- [ ] A regression test drives the implement workflow to a `blocked` outcome against a real git fixture and asserts worktree, branch, registration, and uncommitted work survive; it fails against the pre-fix code.
```

Bad (does not name the test):

```md
- [ ] Tests pass.
```

Bad (preservation AC written as new behavior):

```md
- [ ] Quota exhaustion falls through to the next configured agent.
```

The good example is from the `blocked-run-retains-worktree-and-branch` spec.

#### Human-only acceptance criteria

An acceptance criterion is classified as **human-only** when any of these marker strings appears anywhere in its full bullet block: `(Manual)`, `visual inspection only`, or `no automated guard`. Matching is case-insensitive substring matching across the first checklist line and any continuation lines; markers need not be trailing or whole phrases, so `no automated guardrails` also qualifies. Human-only criteria describe verification that the harness cannot automate — manual inspection, live testing, or external approval.

Human-only criteria do not block subspec completion. A run completes as soon as all **non-human-only** criteria are checked; unchecked human-only criteria remain for human verification after the run finishes. The run summary reflects this by labeling unchecked human-only criteria as "human-verify" rather than treating them as blockers (e.g., `4/7 (3 human-verify)` indicates 4 automated criteria checked, 7 total, 3 human-only unchecked).

Use human-only criteria sparingly and only when the verification genuinely cannot be automated:

Good (human-only):
```md
- [ ] The feature works in the live iOS simulator. (Manual)
- [ ] No visual regressions on the redesigned dashboard. (visual inspection only)
```

Bad (should be automated):
```md
- [ ] The code follows team conventions. (no automated guard)
```

(Conventions should have linters; if they don't, add one rather than marking them human-only.)

#### Agent-verifiable acceptance criteria

An acceptance criterion that is not marked human-only must be verifiable from the implement agent's worktree environment **without network or GitHub access**. The implement agent runs in isolation and cannot interact with pull requests, CI status, reviews, or other GitHub/network resources.

Do not write non-human-only ACs that assert:
- PR body or title content ("PR body lists the breaking changes", "pull request describes the change")
- CI status ("CI is green", "all checks pass", "workflow succeeds")
- Review or merge-readiness state ("review is approved", "ready gate passes", "PR is reviewed")
- PR merge or approval status ("is merged", "is approved")

These assertions can only be verified after the spec is complete, when a human publishes the PR or looks at CI results. If post-merge evidence is necessary (e.g., "PR body documents the decision"), that belongs in publication records (`prNarrative`, PR templates, release notes), not in acceptance criteria that strand an implement run at `blocked` when the agent cannot tick them.

**Escape hatch:** If verification truly cannot be automated, mark the criterion human-only with `(Manual)`, `visual inspection only`, or `no automated guard` to indicate post-merge human verification. The harness then removes it from automated completion requirements.

Good (satisfiable):
```md
- [ ] Quota exhaustion falls through to the next configured agent.
- [ ] Tests pass when the feature is disabled.
- [ ] `run.test.ts` stays green.
```

Bad (unsatisfiable, will strand implement at blocked):
```md
- [ ] CI is green.
- [ ] PR body lists the test-count change.
- [ ] Review is approved.
```

Fix by placing `(Manual)` anywhere in each full bullet block (human-only escape), or rewriting as a satisfiable worktree-verifiable outcome.

Subspec heading contract (enforced by patch mode parser):
- Acceptance criteria must use the exact heading `## Acceptance criteria`.
- Blockers must use the exact heading `## Blocker`.
- Variants like `### Acceptance criteria` or `## acceptance criteria` are rejected.

## Agent Workflow

When an agent is asked to work from a Jarvis spec during a patch run:

1. Read the harness-injected repo guidance and active subspec in the prompt.
2. Execute only that active subspec.
3. Run the verification required by the subspec and repo guidance.
4. Tick only that subspec's acceptance criteria under `## Acceptance criteria`.

The harness selects the active linked subspec for index-routed runs; patch agents do not pick the first unchecked subspec from `index.md`. Jarvis flips the index checkbox when all acceptance criteria in a subspec are checked.

Do not check unrelated index items. Do not keep working through the rest of the index after one subspec is complete.
