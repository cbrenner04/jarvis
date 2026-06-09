---
name: v2-coding-standards
---
# Coding standards for v2 — restraint principles + tooling gate

v1 sprawled: ~18k lines of src doing not much, single 600-line functions
(`runIteration` in `v1/src/modes/patch/run.ts`), 1000–1500 net-line diffs that
can't be reviewed. Terseness didn't fix it because the rot is **structural and
architectural**, not stylistic. Fix it for v2 with one small set of
architectural-restraint principles applied at three surfaces, plus a hard
tooling gate that enforces *structural honesty* (not smallness).

Scope: v2 only — `v2/src/**` and `shared/**`. v1 is left as-is.

## The core split

Three levers, each with a **prevention** surface and a **gate** surface. The
gate is always the stronger half:

- **Mechanical sprawl** → prevention: none needed; gate: Biome lint (below).
- **Architectural over-build** → prevention: restraint principles in the v2
  write-step prompt; gate: review-phase criteria.
- **Diff size / spec granularity** → prevention: operator writes functional
  intent (not code-size); gate: plan-mode decomposition along seams.

Key insight: **the architectural seam and the spec seam are the same seam.**
The boundary that makes code reviewable (e.g. splitting classify-outcome from
perform-effect) is the boundary that makes a subspec atomic. So the principle
set below does triple duty — it guides the executor's code, gives plan mode its
decomposition seams, and gives review its flag criteria. One set, three
application points.

## Restraint principles (review these now)

Few and sharp beats a style guide — a long list dilutes. Target set:

1. **Separate decision from effect.** Compute a typed outcome value first;
   perform side effects (telemetry, logging, git, PR) in a separate handler
   keyed off it. No branch may both decide *what happened* and *enact it*. This
   one principle collapses `runIteration`'s ~600 lines and its 12 duplicated
   telemetry writes; it's the highest-leverage rule here.
2. **No abstraction until two real callers.** No interface, generic, options
   strategy, or indirection for a single use site. Inline first; extract when
   the second caller actually arrives — not in anticipation.
3. **Extend before you create.** Prefer adding to an existing module over
   spawning a new file. A new file needs a distinct *responsibility*, not just
   "this function got long."
4. **No speculative configuration.** No flags, knobs, or options nobody asked
   for. Configurability is earned by a second concrete need, never anticipated.
5. **One module, one responsibility.** A file's exports share one reason to
   change. Orchestration, classification, and effects are different
   responsibilities → different modules. (This is also the spec seam.)
6. **Data over branches.** Replace input→output if/else-if ladders with a
   table or dispatch (cf. `mapExitCodeToReason`). Branching is for genuine
   control flow, not lookups.
7. **Stay in scope.** Change only what the active task names. No drive-by
   refactors, no "while I'm here" — that's how a small functional change
   becomes a 1400-line diff.

Decomposition caveat (plan mode): the pressure is **split existing scope along
these seams, never invent precision.** Adding detail/elaboration is the
over-build failure mode, not the fix. Split, don't elaborate.

## Tooling gate (Biome, hard errors only)

All rules are **errors**, scoped to `v2/src/**` + `shared/**` via Biome
`overrides` (same pattern as the existing v1/v2 `noRestrictedImports` block).
**No warnings** — warnings get ignored, become clutter, and erode the
credibility of the rules that do block. Enforce *structural honesty*, not
smallness; smallness is the planner's/reviewer's job, and a deterministic gate
on smallness is gameable (an agent clears a line cap by extracting an arbitrary
chunk into `fooPart2(a,b,c,d,e,f)` — lint passes, code is worse).

Rule-selection test: **the cheapest way to satisfy it must be the correct
fix.** Candidates:

- **Cyclomatic/cognitive complexity** — Biome `noExcessiveCognitiveComplexity`
  is native and is *cognitive* complexity (penalizes nesting heavily, so it
  partly subsumes a max-depth rule). Fires on tangle (the nested decision
  ladders), stays silent on benign long straight-line code — correct targeting.
  Threshold **generous (~15-equivalent)**: too low and it fires everywhere and
  agents thrash; a blocking rule that fires constantly is worse than a warning.
- **No cross-layer imports** — already enforced for v1↔v2; extend to the
  `shared/** must not import v1/** or v2/**` rule from AGENTS.md.
- **max-params** — agent clears it with an options object, which is the repo
  idiom anyway. *Not native to Biome* → needs a GritQL plugin or accept omission.
- **Duplicate-code detection** — directly targets the telemetry boilerplate;
  only fix is to extract the shared builder. *Not native to Biome* → needs a
  separate tool (e.g. jscpd) in the check pipeline, or omission.

Explicitly **excluded**: `max-lines` / `max-lines-per-function` (the seductive
trap — most gameable, produces "cycle a bunch and still get bad"). Size signal
lives in plan + review, not the gate.

Open for refine: whether to pull in non-native rules (max-params, duplicate
detection) via plugin/extra tooling or ship complexity + boundaries only;
exact complexity threshold; whether `shared/**` gets the full set or a subset.

## Wiring — three surfaces

- **Executor prompt:** inject the principle set into the v2 write-step prompt
  (the v2 analog of `v1/src/modes/patch/rules.md`; see `write.ts` /
  `write-behavior.md`). Few + sharp so it survives prompt pressure.
- **Plan mode:** the principles are the decomposition seams; plan flags or
  splits oversized subspecs (split-not-elaborate).
- **Review phase:** over-build detection becomes a reviewer mandate — flag a
  single-caller abstraction, a decision/effect fusion, a diff that should have
  been N subspecs. This is the gate for judgment a linter can't reach; ties into
  the in-flight review-debate work.

## Out of scope

- Retrofitting v1 (lint gate or principles). v2 only.
- Stylistic/formatting standards — Biome formatter already owns those.
- A general style guide — this is restraint + structural honesty, not a manual.
- The v2 write-step prompt rendering itself / review-phase mechanics — this
  intent supplies the *content/criteria*, not those subsystems.

## Verification (target state, outside this spec tree)

- Restraint principles live in the v2 write-step prompt source, injected each
  iteration; a test asserts they render.
- Biome gate active for `v2/src/**` + `shared/**`: complexity rule + extended
  import boundary as errors; `bun run check` green on existing v2 code (or the
  threshold tuned so it is) and red on a seeded violation.
- `shared/**` import boundary proven by a failing-then-passing fixture.
- Plan-mode decomposition + review criteria reference the same principle set
  (no second, divergent copy).
- `bun run typecheck` + `bun test` green; `bun run ready` passes.

## Documentation updates

- Record the principle set + gate as v2 reference (new `v2/docs` page, or fold
  into an existing standards/architecture doc — refine decides where).
- Update `write-behavior.md` if the write-step prompt content changes.
- Note the new Biome `v2/src/**` + `shared/**` overrides wherever lint/check
  conventions are documented.
- If any existing v1 behavior changes, update `v2/docs/v1-behaviors.md` (repo
  rule). Expected none — additive v2 + v2-scoped lint.

## Refinement

- Gate ships **native Biome only**: `noExcessiveCognitiveComplexity` +
  extended import boundary. Drop max-params and duplicate-code (jscpd/GritQL).
  Rules out adding a multi-tool lint pipeline for v2-only scope — itself the
  speculative-config/over-build failure mode this intent forbids. max-params is
  redundant with the options-object idiom; telemetry duplication is caught by
  the separate-decision-from-effect principle + review, which are the named
  surfaces for it. Resolves the seed's first "Open for refine" item.
- `shared/**` gets the **full native set**, not a subset: complexity rule + its
  own `shared/** must not import v1/**|v2/**` boundary. Rules out gating only
  `v2/src/**` and leaving shared ungated — shared is the lower layer both
  versions consume, so sprawl there is the costliest to leave unenforced.
  Resolves the seed's third item.
- Exact complexity threshold: rule id `noExcessiveCognitiveComplexity`, option
  key `maxAllowedComplexity`. `Deferred to first consumer: numeric value — pin
  when the gate first runs against existing v2/shared`. Start at the generous
  default (~15) and lower **only if** that default isn't already green on
  existing code. Rules out subspec 01's "lowest value green on current
  v2/shared" framing — lowest-green pins one notch above today's worst function
  and fires on the next legitimately-complex one, the constantly-firing gate the
  intent forbids. Supersedes the seed's "tune so green" only in direction: green
  is a floor (must pass), not the target.
- Test files are **excluded** from the complexity override: scope it to
  `v2/src/**` + `shared/**` non-test `.ts`, excluding `*.test.ts`. Rules out
  including them — test scaffolding is legitimately branchy and would both raise
  false positives and shift the green-on-existing baseline that sets the
  threshold above.
- Single canonical source for the principle text: one markdown file is the sole
  copy; the v2 write-step prompt injects it inline (v1 `rules.md` pattern), and
  plan mode + review + the v2/docs reference cite that same file. Rules out the
  three-surfaces failure the seed's own verification forbids — hand-maintained
  copies in prompt, plan, and docs that drift. Resolves the seed's "refine
  decides where" doc-location item: the canonical copy is a **registry prompt
  artifact** (markdown with `id`/`behavior`/`kind` frontmatter, fetched by id —
  same loader as `write.execute`), and `v2/docs/coding-standards.md` is the thin
  pointer to it. Rules out making the v2/docs page the canonical body — that
  would force the write step to read across into docs or keep a second copy; the
  artifact is the body, docs points.
- Only the executor surface ships wiring now. `v2/src` has a write step
  (`write-prompt.ts`/`write.ts`) but no plan mode and no review phase — plan
  mode is v1-only, review-debate is in-flight. So this spec lands: the canonical
  principle file, write-step injection, and the Biome gate. The plan-mode and
  review surfaces are `Deferred to first consumer: cite the principle file from
  the plan/review prompts — pin when a v2 plan mode / review phase exists`.
  Rules out the two wrong alternatives the seed leaves open: (a) building
  plan/review wiring against absent v2 consumers — the invent-precision failure
  this intent itself forbids; (b) editing v1's live plan/review prompts to cite
  it — breaks the stated v2-only scope. Supersedes the seed's verification line
  "Plan-mode decomposition + review criteria reference the same principle set"
  as an in-this-spec deliverable: the single-source file makes that citation
  *possible* later, but no plan/review consumer is wired here.
- Import-boundary patterns must be relative-aware: use `**/v1/**` / `**/v2/**`,
  not bare `v1/**` / `v2/**`. Every real cross-package import is relative
  (`../../shared/...`, a v2→v1 would be `../../v1/...`); bare anchored globs do
  not match those specifiers, so the existing `noRestrictedImports` overrides are
  inert no-ops. Rules out the seed's "same pattern as the existing block" — that
  copies the defect. The new `shared/**` boundary and the correction of v2's own
  (currently inert) v2→v1 override both use relative-aware globs verified to
  match the specifiers in-tree. v1's inert v1→v2 override stays untouched (v1
  retrofit out of scope). Acceptance must require an **empirically demonstrated
  error** on a real forbidden import, never "mirrors the existing block."
- Seeded-violation proof mechanism: a fixture file under a Biome-**ignored**
  path (added to `includes` `!` excludes), linted by an explicit one-off
  targeted invocation that overrides the ignore. Rules out a fixture inside the
  linted tree — it would leave a permanent red in `bun run check` — and resolves
  the seed's ambiguous "test-driven or excluded fixture" by picking one. This
  single fixture is the proof the gate bites (complexity red + boundary red).
- Write-step injection composition: add a dedicated placeholder to the
  `write.execute` artifact (not folded into `STEP_RULES`), populated at render
  time from the canonical artifact's body; the existing terminal-token step rule
  stays **last** (it is the output contract), principles precede it. Composition
  happens in the write render path (`write-prompt.ts`/`cli.ts`), not by inlining
  principle text into the `DEFAULT_STEP_RULES` string literal. Rules out two
  wrong forms: (a) putting principles after the output contract — breaks the
  recency the intent wants for the contract token; (b) hardcoding the text in
  `cli.ts` — a second copy, violating single-source.
- Render test asserts a stable marker / principle **count**, not exact wording.
  Rules out coupling the test to exact phrases — the text is meant to be tuned,
  and exact-match assertions fight that.
- `coding-standards.md` ownership across the two independent subspecs: the
  principle/wiring subspec creates the canonical artifact, the write injection,
  and `v2/docs/coding-standards.md` as a thin pointer; the gate subspec augments
  that same `coding-standards.md` with the Biome gate documentation. Stated
  explicitly because the subspecs run independently — rules out both creating or
  both assuming the other owns the file.

