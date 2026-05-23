---
name: v2-prompt-governance
---

Design v2 prompt governance and extraction. This is a follow-on v2
architecture intent seeded from `v1-behaviors.md`, `v2-vision.md`, and the
prompt decisions recorded in `wip-v2-musings.md`. It should
land after the v1 behavior catalog, because the behavior catalog tells us what
prompts currently *do*, while this intent decides how prompt artifacts are
owned, rendered, reviewed, tested, and carried forward.

Goal: produce a concrete prompt-governance design for v2, with enough detail
that later v2 implementation specs know where prompts live, how prompt changes
are reviewed, how prompt behavior is protected by tests, and how v1 shares the
same prompt artifacts. The output is a design doc plus follow-on implementation
intents, not a broad prompt rewrite.

Why this matters:

- Jarvis behavior is heavily shaped by English instructions sent to agents.
- v1 has prompts split across Markdown templates, inline TypeScript string
  construction, injected rules, generated handoff text, and agent-specific
  wrapping.
- v2 should not bury those instructions inside unrelated control-flow code. If
  prompts are code, they need stable ownership, reviewability, and tests where
  tests make sense.
- v1 must stay reliable while v2 is built. In this context, "reliable v1" means
  a stable engine, not frozen prompt text.

Decisions to design around:

- Prompts live in a shared top-level `prompts/` directory, abstracted out of
  `v1/` and `v2/`, treated as first-class code.
- `jarvis1` reads the shared, evolving prompts. It does not pin a frozen prompt
  snapshot. One source of truth means improvements reach both engines.
- Prompts are organized by behavior, not by mode/operation. The tree mirrors the
  v2 behavior vocabulary (write, review-and-update, human; see `v2-vision.md`),
  with concrete step prompts (create-intent, draft-spec, implement, review-spec,
  code-review, security-review) grouped under their behavior. The old
  plan/implement/review/run "mode" framing is not the organizing axis.
- Prompts are rendered by layering scoped fragments plus explicit per-step
  overrides. Fragments are either overarching (global, e.g. terseness rules) or
  behavior-specific (planning rules ≠ implementation rules). Default render =
  global fragments → behavior fragments → the step's task text; a step may
  explicitly add or remove fragments when it is the exception. The override
  syntax is part of this design.
- Prompts carry no cli/model coupling. A workflow step references a prompt by a
  stable identifier; the agent (cli+model) is a per-project config binding over
  the step, never part of the prompt artifact.
- Extraction from v1 should happen before v2 architecture implementation starts.
  The intended sequence is: finish the behavior catalog, design prompt
  governance, extract prompts, then proceed into broader v2 architecture work.
- Exact prompt strings do not need a separate review artifact apart from this
  design and the extraction specs. The prompt governance doc should inventory
  prompt surfaces by purpose and lifecycle, but it should not create a second
  catalog that duplicates the behavior catalog.
- The initial `prompts/` layout should be the design's best conservative
  recommendation based on the current codebase. Prefer a simple structure that
  can support v1 and v2 immediately over an elaborate taxonomy.
- Prompt artifacts include anything being piped into an agent, not only the
  primary English instruction body. Be thoughtful about how much code belongs in
  the prompt layer, but treat injected rules, generated next-step text, and
  transport wrappers that shape the submitted prompt as part of the prompt
  surface.
- Use rendered prompt snapshots as the initial test strategy. Full prompt evals
  are explicitly deferred. Normal planning, implementation, and PR review still
  apply to prompt changes.
- The design must propose a versioning strategy for shared evolving prompts so
  future prompt changes are intentional and reviewable.

Initial scope:

- Inventory every v1 prompt surface by purpose and lifecycle, not by
  implementation file:
  - patch/implementation prompt and injected patch rules,
  - plan refine prompt,
  - plan name-only prompt,
  - plan draft prompt,
  - plan review prompt,
  - disambiguation and confirmation text that asks the human to choose a path,
  - generated next-step and handoff text when it effectively instructs a future
    human or agent action,
  - agent-specific prompt transport or wrapping, including prompt markers used
    for telemetry correlation.
- Propose the internal layout of the shared top-level `prompts/` directory. The
  share-vs-frozen and top-level-vs-per-version questions are already settled:
  root `prompts/`, shared and evolving. Consider at least:
  - organization by behavior (write, review-and-update, human), mirroring the
    v2 behavior vocabulary, with concrete step prompts (create-intent,
    draft-spec, implement, review-spec, code-review, security-review) grouped
    under their behavior — not by the old plan/implement/review/run modes;
  - the fragment scopes: overarching/global fragments versus behavior-specific
    fragments versus per-step prompt bodies, and how a step references its
    prompt by stable identifier;
  - how engine-specific or agent-specific variants are represented if any are
    unavoidable;
  - where prompt metadata, version identifiers, and rendered snapshots belong.
- Propose a prompt rendering contract:
  - how prompt artifacts are assembled by layering scoped fragments (global →
    behavior → step task text), including the explicit per-step override syntax
    for adding or removing fragments;
  - how placeholders are typed and validated,
  - how user-provided content is delimited,
  - how prompt-injection protections are represented,
  - which prompt-adjacent behavior belongs in renderer code versus template
    text.
- Propose a review, testing, and versioning standard:
  - prompt diffs should be reviewable like code;
  - rendered prompt snapshots should protect meaningful behavior without making
    harmless wording edits painful;
  - v2 tests for prompt renderer source should follow the v2 co-location rule
    and live next to that source rather than under a parallel `v2/test/` tree;
  - prompt versioning should make behavior-affecting shared changes visible for
    both `jarvis1` and v2;
  - broader evals are out of scope for now and should be left as a future
    decision.
- Moving v1's prompts out of v1 source into the shared `prompts/` directory is
  in scope for the follow-on extraction work, but that extraction should be a
  relocation, not a rewrite. The default bias is no v1 prompt wording changes:
  v1 keeps reading the same text, just from `prompts/` instead of inline.
  Wording edits, if any, follow the normal shared-prompt review and snapshot
  standard since they affect both engines.
- Produce follow-on implementation intents if the design recommends extraction,
  shared directories, snapshots, prompt renderer changes, or versioning support.

Expected output:

- A design document at `v2/spec/prompts.md` that includes:
  - prompt inventory,
  - recommended `prompts/` directory/layout decision,
  - v1 shared evolving prompt decision,
  - prompt artifact taxonomy,
  - rendering and placeholder rules,
  - review and rendered snapshot testing expectations,
  - prompt versioning strategy,
  - migration sequence,
  - unresolved risks or tradeoffs.
- One or more follow-on intents under `v2/spec/wip-intents/` for prompt
  extraction and any required prompt renderer or snapshot-test work. Keep these
  implementation intents atomic and testable.

Relationship to the behavior catalog:

- `v1-behaviors.md` catalogs user-observable behavior and prompt *effects*.
- This file governs exact prompt artifacts and the mechanics around them.
- Do not duplicate the behavior catalog. Reference it when needed, but keep this
  document focused on prompt ownership, rendering, testing, versioning, and
  migration.

Out of scope:

- Rewriting v1 prompts in any way.
- Prompt eval infrastructure beyond rendered snapshot tests.

## Refine turn 1

- The design should draw a hard boundary between prompt artifacts and renderer/runtime logic. Current v1 code mixes both: prompt templates and `rules.md` are prompt artifacts, while non-recursive placeholder substitution, boundary enforcement, spec parsing, quota fallback, and git/write-boundary checks are runtime behavior that should stay in code even when prompts move to `prompts/`.
- Treat "prompt surface" as a taxonomy with at least four buckets so extraction work stays conservative: agent-bound prompt bodies/fragments, agent transport wrappers and correlation markers, human-facing chooser/confirmation text, and generated handoff/next-step text. The inventory should classify each current v1 surface into one of those buckets and say whether it belongs in shared prompt source immediately, later, or not at all.
- The design should require stable prompt IDs that are independent of file paths. Workflows/steps should reference those IDs, snapshots should key off those IDs, and any future file moves within `prompts/` should not silently change runtime bindings or review history.
- Snapshot testing should cover more than the happy-path rendered text. The follow-on work likely needs deterministic tests for: fragment layering order, add/remove override behavior, placeholder validation failures, non-recursive substitution, delimiter preservation for injected user content, and any unavoidable engine-specific wrapper selection. That keeps the initial test strategy focused on renderer correctness instead of broad evals.
- Because v1 already has separate plan prompts, a patch prompt assembled in TypeScript, and human-facing disambiguation text outside the agent loop, the migration sequence should likely be split into at least two implementation intents: first a no-wording-change extraction/relocation pass for existing artifacts, then renderer/snapshot/versioning support. Combining relocation with new composition rules would make prompt diffs hard to audit.
- The versioning section should avoid a frozen-copy scheme but still make prompt-affecting changes obvious in review. A good target for the design is an explicit prompt revision signal per prompt ID or rendered snapshot set, so a PR can show "this shared prompt behavior changed" even though both `jarvis1` and v2 read the same evolving source.
- The design doc should explicitly decide how much agent-specific wrapping is allowed. Current intent says prompts carry no cli/model coupling, but v1 does have agent transport/wrapper behavior and prompt markers. The likely conservative rule is: step identity and core instruction text stay shared, while any unavoidable adapter-specific wrapper remains a thin, separately classified layer with snapshot coverage and a bias toward minimization.

## Refine turn 2

- The inventory should name the current v1 surfaces explicitly so drafting does not miss any: patch prompt body assembled in `v1/src/modes/patch/prompt.ts`, injected patch `rules.md`, plan templates under `v1/src/modes/plan/prompts/`, inline-draft prompt, TTY-only non-index confirmation text in patch run, project disambiguation chooser text, printed next-step/handoff commands from plan mode, and Codex's invocation marker wrapper. For each, the design should state whether the first extraction pass moves it into shared prompt source verbatim, leaves it in runtime code, or defers it as adapter-local.
- Stable prompt IDs should be first-class metadata, not inferred from paths or filenames. The design should pick one conservative binding mechanism, such as frontmatter or sidecar metadata, and require runtime lookup by ID. File layout can change later, but duplicate IDs, missing IDs, or step references to unknown IDs should be hard validation failures.
- The versioning strategy should be tied to those stable IDs. A useful boundary is: wording or fragment-set changes bump a prompt revision signal for the affected ID, while pure file moves or comment-only metadata edits do not. Snapshot outputs should record both prompt ID and revision so reviews can see which shared behaviors changed without introducing frozen prompt copies.
- The rendering contract should stay narrow in the first implementation. Conservative bias: prompt source owns ordered fragments, task text, delimiters, placeholder declarations, and explicit add/remove fragment overrides; renderer code owns placeholder substitution, validation, delimiter insertion, wrapper selection, and any invariants about non-recursive rendering. Do not let templates encode conditional logic that really belongs in TypeScript.
- The design should decide whether human-facing chooser and confirmation text actually belongs under `prompts/` or just in the broader prompt-surface inventory. A likely boundary is: keep interactive CLI UX strings in runtime code unless they are intended for shared review/versioning alongside agent instructions, but still catalog them so future extraction is deliberate rather than accidental.
- The migration sequence should likely become three clearly separated steps even if only two follow-on intents are created: first inventory plus no-wording-change relocation of existing prompt artifacts, second renderer and snapshot infrastructure with stable IDs/revisions, third optional adoption of layered fragment composition for steps that still use inline assembly such as patch prompt construction. That keeps the first relocation diff auditable and avoids mixing mechanical moves with semantic prompt changes.

## Refine turn 3

- The design should make the first-pass ownership calls explicit, not implied. Based on the current v1 code, the conservative default looks like:
  - move into shared prompt source verbatim in the extraction pass: `v1/src/modes/patch/rules.md`, the plan prompt files under `v1/src/modes/plan/prompts/`, and the stable instruction text currently assembled in `v1/src/modes/patch/prompt.ts`;
  - keep in runtime code for now: project disambiguation chooser text in `v1/src/disambiguation-prompt.ts`, the non-index confirmation text in `v1/src/modes/patch/run.ts`, and printed plan next-step/handoff output in `v1/src/commands/plan.ts`, unless the design deliberately decides these human-facing strings need shared prompt governance too;
  - classify as adapter-local prompt surface, minimized and snapshot-covered rather than moved into shared core prompt artifacts: Codex's invocation marker wrapper in `v1/src/agents/codex.ts` and any equivalent transport framing needed only for a specific agent adapter.
- The design doc should require one concrete metadata shape for prompt artifacts and snapshots. A conservative choice is leading frontmatter per prompt/fragment with at least: stable prompt `id`, behavior, step or fragment kind, and revision signal. Runtime lookup should bind by `id` only; file paths are organizational detail and must not be part of the stable contract.
- The extraction intent and the renderer/snapshot intent should stay mechanically separate. The first should be auditable as a relocation-only change with no wording edits and no new composition semantics. The second should introduce registry lookup by prompt ID, revision-aware rendered snapshots, validation failures for missing/duplicate IDs, and deterministic renderer tests for ordering, overrides, placeholder handling, delimiters, non-recursive substitution, and wrapper selection.
- If the design keeps layered composition as a later migration step, it should say so directly. The current patch prompt builder mixes static instruction text with runtime-generated sibling-directory bullets; drafting should preserve that distinction so a later composition step can extract only the static prompt body while leaving list generation and other conditional runtime formatting in TypeScript.
