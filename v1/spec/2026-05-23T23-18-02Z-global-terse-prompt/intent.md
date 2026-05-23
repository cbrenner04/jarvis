---
name: global-terse-prompt
---

Add a shared "be terse" directive to the prompts every agent jarvis dispatches,
so terse output (code, comments, PRs, spec edits) is enforced on all target
repos — not just this one (the AGENTS.md rule covers only this repo). Runs
through the prompt-governance system, not inline edits.

Goal: a global terseness fragment in shared `prompts/`, layered into the
agent-facing prompts so both jarvis1 and v2 emit it.

Decisions to design around:

- New `global.terse` fragment (frontmatter `id`/`behavior`/`kind: fragment`/
  `revision` per `v1/docs/prompt-governance.md`).
- Layer it as a global fragment (default `global -> behavior -> step`). The
  renderer primitive exists (`assemblePrompt` in `v1/src/prompts/renderer.ts`),
  but no fragment artifacts exist yet and the live patch/plan render path likely
  does not pass global fragments — wiring that path is part of this work.
- Keep the directive tiny: minimize output, no filler or restating, comment
  density matches surrounding code, lean PRs/specs. Mirror `v2/docs/v2-vision.md`
  § Be terse.
- Bump affected prompt `revision`s and update rendered snapshots under
  `v1/test/`. The change ships to jarvis1 too — intended.

Scope:

- Add the `global.terse` fragment file (location per planning; no `fragments/`
  dir exists yet — prompts are still mode-organized under `prompts/{plan,patch}`).
- Wire it into the agent-facing prompts (`patch.prompt.body`, plan
  draft/refine/review; consider `patch.rules`).
- Update revisions + snapshots; `bun run ready` green.
- Document the global fragment in `v1/docs/prompt-governance.md`.

Out of scope: behavior/step prompt rewrites beyond adding the terseness layer;
adopting the full behavior-organized `prompts/` layout.

## Refine turn 1

Implementation note: the renderer already accepts `globalFragmentIds`, but the
current registry seed list only loads the five rollout artifacts plus
`patch.rules`, and both plan draft/refine/review still render their step prompt
bodies directly. Drafting should therefore treat this as a two-part plumbing
change: register the new fragment artifact in `v1/src/prompts/registry.ts`, then
move the plan prompt builders onto the same assembled prompt path patch mode uses
so the fragment is actually emitted in all agent-facing prompts.

Keep the layering decision narrow. The new fragment should be the single source
of terseness guidance for prompt bodies; do not duplicate the same prose into
each step template. Decide explicitly whether `patch.rules` also receives the
terse directive or remains unchanged. If patch mode already includes the fragment
ahead of `patch.prompt.body`, repeating the same instruction inside `patch.rules`
would create avoidable prompt noise and weaken the "tiny directive" goal.

Prompt-governance fallout is broader than one file addition. The rollout docs
and tests currently describe only the existing artifact set and snapshot
coverage, so this work likely needs updates in registry tests, rendered snapshot
tests, and governance documentation to acknowledge fragment artifacts and their
revisioned outputs rather than treating them as an internal implementation
detail.

## Refine turn 2

The current registry is still an explicit seed list in `v1/src/prompts/registry.ts`,
not prompt-tree discovery. Keep this change mechanical: pick one concrete source
path for `global.terse`, add it to that seed list, and avoid expanding scope
into the broader `prompts/fragments/...` layout migration described only in
`v2/docs/prompts.md`. The intent is shared prompt source and shared layering
behavior, not a v2 runtime implementation under `v2/src`.

Plan-mode plumbing has one extra constraint beyond "use `assemblePrompt`":
`draft.ts`, `refine.ts`, and `review.ts` each currently mutate the raw template
string for `targetDir` / flat-layout path wording before placeholder render.
Drafting should preserve those path rewrites and existing pass-context injection
when moving onto assembled prompt bodies, especially for external no-commit spec
layouts and review pass numbering.

Patch mode already assembles `patch.prompt.body` and then injects `patch.rules`
through the `<PATCH_RULES>` placeholder. That makes `patch.rules` the wrong home
for duplicate terseness wording unless the design explicitly wants the rule block
itself to carry that policy. Default decision should be: keep `patch.rules`
unchanged, layer `global.terse` ahead of `patch.prompt.body`, and let the shared
fragment be the only terse directive in agent-facing prompt text.

Documentation fallout is at least two files, not one. Besides
`v1/docs/prompt-governance.md`, `v1/docs/agents.md` currently says the first
registry rollout includes only `patch.prompt.body`, `patch.rules`, and the three
plan prompts, and that relocation stage one introduced no wording/registry
changes. This intent should assume those statements need revision alongside the
registry and rendered-snapshot tests.

## Refine turn 3

Two runtime details are easy to regress when moving plan prompts onto assembled
rendering. First, `buildDraftPrompt`, `buildRefinePrompt`, and
`buildReviewPrompt` currently start from the raw step body, perform path-text
rewrites on that string, then inject placeholders. Drafting should keep that
order even after introducing `assemblePrompt`, so the fragment is layered into
the final template without breaking the existing `spec/<NAME>/` replacement
logic for committed vs flat layouts and review-pass context. Second, assembled
prompts join fragments with blank lines; patch mode already trims and applies a
newline normalization after `<PATCH_RULES>` injection, while plan mode does not.
Keep the change narrow and preserve current rendered formatting except for the
intentional new terse directive, because the prompt snapshot tests compare full
rendered bodies byte-for-byte.

Testing/documentation scope should stay focused on the assembled outputs, not on
inventing a separate fragment snapshot scheme in this change. The registry test
should assert that `global.terse` is now part of the loaded artifact set, and
the rendered snapshot test should continue to verify the final patch/draft/
review/refine prompts keyed by the affected step `revision`s after the fragment
is layered in. `v1/test/prompt.test.ts` currently hard-codes the exact patch
prompt line sequence around `patch.rules`; expect those assertions to need
updates once the shared prompt body gains a prefixed terse fragment. Treat the
v2 requirement as shared prompt-source alignment only: no `v2/src` runtime work
exists yet, so satisfying "jarvis1 and v2 emit it" means placing the fragment in
the shared top-level `prompts/` tree and updating any v1/v2 docs that still
describe the old artifact inventory.
