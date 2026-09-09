---
name: implement-respects-target-repo-doc-layout
---

# Implement never writes jarvis's own doc conventions into a target repo

## Problem

An `implement` run on a product repo (`homestead-client`, a Vite SPA with no `v2/` tree) created `v2/docs/v1-behaviors.md` — jarvis's own documentation path — committed it in a subspec commit, and carried it through review into the published PR. The content was correct and about the product; only the location was jarvis convention leaking through the prompt corpus into a repo that references it nowhere. Evidence: #3426.

## Corpus audit (2026-09-07)

The sweep the third decision asks for, run against all 43 prompts in `prompts/`. Nine of the ten registered projects are not jarvis, so every leak below renders on nine targets that reference these paths nowhere. Three distinct severities:

**1. Guidance silently lost, not just mislocated — `prompts/intent/split.md:29`.** Step 2 says *"Read `v2/docs/spec-guidance-agent-core.md` and follow its sizing and reviewability rule."* That path resolves only inside the jarvis worktree, so off-jarvis the sizing rule is simply never applied — the agent is told to read a file that is not there, and step 1 ("Inspect the target repository for guidance") is the only thing left standing.

This one is sharper than a path leak because **the harness already solves it correctly everywhere else**. `readSpecGuidance()` (`shared/spec-guidance-path.ts:5`) reads that file from the *harness install directory*, not the target worktree, and injects it as a `SPEC_GUIDANCE` placeholder — `plan-draft.ts:85`, `review-plan.ts:59`, and `review-intent.ts:47` all do this, so they carry the guidance onto any target repo. `buildIntentSplitPrompt` (`shared/prompts/intent-split.ts:53`) declares only `WORKDIR`, `SEED_LABEL`, and `SEED_CONTENT`, and `split.md` has no `SPEC_GUIDANCE` placeholder. Intent split is the lone step that asks the agent to fetch what its siblings are handed.

**2. A global fragment on every workflow, every project — `prompts/global/documentation.md:9`.** *"update docs/specs … in the durable home required by `v2/docs/documentation-standard.md`"*. `behavior: global`, `order: 0`, so it renders into every step of every workflow. Nothing injects this file's content anywhere in the corpus (`readSpecGuidance` is the only such reader). This is the most likely direct cause of the #3426 incident in the problem statement above: a global instruction naming a `v2/docs/` path is exactly what produces a `v2/docs/v1-behaviors.md` in a Vite SPA.

**3. Jarvis's slice layout asserted as fact — `prompts/plan/draft.md:57`.** Names `bun run test:v2` / `test:integration:v2` for `v2/**`, and "all six" for `shared/**`, prefixed *"for this repo"* and suffixed *"following target-repo `AGENTS.md`"*. The hedges are real but the concrete script names are what an agent acts on, and no other repo has these surfaces.

**Correctly parameterized, for contrast:** `prompts/patch/rules.md:27,29` says *"Use commands from target repo `AGENTS.md`"* and *"Resolve scope … exactly as target-repo `AGENTS.md` specifies"*, naming no scripts. That is the pattern the three above should follow. (`patch/rules.md:30-31` still hardcodes `bun run typecheck` / `bun test`, but the patch lane is lower stakes.)

**Fix shape this suggests:** (1) is a wiring fix with an existing pattern to copy — give `intent-split` the `SPEC_GUIDANCE` placeholder its siblings already have, and delete the path instruction. (2) and (3) are prompt-text fixes toward the `patch/rules.md` phrasing. A corpus-wide guard against `v[12]/(docs|spec|src)/` literals in any fragment that renders off-jarvis would close the class and is cheap.

## Decisions

- Doc-update instructions in the implement prompt corpus are conditioned on the target repo's layout (its own docs home, discovered or configured), never on jarvis's `v2/docs/` convention; rules out harness-repo paths hard-coded in rules that render for every project.
- A cheap guard at commit or review: a path that exists in jarvis's layout but matches nothing in the target repo's tree or spec is flagged; rules out the leak surviving review silently.
- Sweep the prompt corpus for other jarvis-specific paths rendered into external-project prompts while fixing this; rules out repeating the class file-by-file.

## Acceptance criteria

- [ ] A test proves the implement rules rendered for a project without jarvis's layout carry no `v2/docs/`-style jarvis paths; fails against the current corpus.
- [ ] A corpus-wide test asserts no prompt fragment that renders off-jarvis contains a `v[12]/(docs|spec|src)/` literal; it fails today on `prompts/global/documentation.md`, `prompts/intent/split.md`, and `prompts/plan/draft.md`.
- [ ] `buildIntentSplitPrompt` renders spec guidance through a `SPEC_GUIDANCE` placeholder sourced from `readSpecGuidance()`, matching `plan-draft` / `review-plan` / `review-intent`, and `prompts/intent/split.md` no longer instructs the agent to read a path; a test proves the rendered split prompt carries the guidance text with no target-repo file present.
- [ ] An implement fixture on a non-jarvis-layout repo does not produce jarvis-convention doc paths, pinned by a test or the guard above.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — per-project doc-layout conditioning of write-step rules.
