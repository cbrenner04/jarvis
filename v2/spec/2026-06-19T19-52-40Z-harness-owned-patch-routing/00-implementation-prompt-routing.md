# Implementation prompt routing

## Problem

`getActiveLinkedSubspecPath` already selects the active linked subspec, but
`patch.prompt.body` still tells the agent to discover repo guidance and pick the
first unchecked index link. Implementation prompts pass only `index.md` as
`SPEC_PATH`, so the agent re-derives routing and may disagree with the harness.
(`buildSpecTree` full-tree inlining is review/shrink-only today, not
implementation iterations.)

## Decisions

- Harness owns subspec selection for normal implementation iterations via
  `getActiveLinkedSubspecPath`; the prompt states the resolved path and inlines
  the subspec body. Rules out agent-side index routing instructions.
- `patch.prompt.body` wire contract: registry `placeholders:` becomes
  `[SPEC_PATH:string!, SIBLINGS_BLOCK:string!, REPO_GUIDANCE:string!,
  ACTIVE_SUBSPEC_PATH:string!, ACTIVE_SUBSPEC_BODY:string!, PATCH_RULES:string!]`;
  bump `patch.prompt.body` revision. Rules out ad-hoc template substitution
  without registry provenance.
- `SPEC_PATH` remains: the operator-passed spec path (`index.md` or direct
  subspec path). Display/identity only; task content comes from
  `ACTIVE_SUBSPEC_*`. Rules out dropping `SPEC_PATH` or repurposing it as the
  active subspec body carrier.
- Delimiter style matches plan prompts: repo guidance between
  `<<<REPO_GUIDANCE_BEGIN>>>` / `<<<REPO_GUIDANCE_END>>>`; active subspec
  between `<<<ACTIVE_SUBSPEC_BEGIN>>>` / `<<<ACTIVE_SUBSPEC_END>>>` with path
  line before the body block. Rules out bare inline substitution without
  sentinels.
- Remove discover-yourself and pick-task lines from `patch.prompt.body`. Rules
  out dual routing prose in the implementation template.
- Slim `patch.rules` `## Iteration`: drop the first-unchecked-link rule; keep
  tick/blocker/index-checkbox semantics unchanged. Rules out repeating harness
  routing in rules.
- Repo guidance preload reads `AGENTS.md` and root `CLAUDE.md` from the
  registered target repo root (`project.root`), not worktree-only discovery;
  omit each file silently when absent. Rules out missing preload when those
  files exist only at repo root and are not symlinked into the worktree.
- Normal implementation prompts carry the active subspec only — not sibling
  subspec bodies, not `index.md` checklist prose, not a full spec-tree dump.
  Rules out `buildSpecTree` on the implementation path.
- Direct non-index spec runs (`<spec-path>` is not `index.md`) inject that file
  as `ACTIVE_SUBSPEC_PATH` / `ACTIVE_SUBSPEC_BODY`; omit index-routing
  instructions. Rules out index-routing when the operator already passed a
  subspec path.
- When `getActiveLinkedSubspecPath` returns `undefined` (bare-task index or all
  linked subspecs checked), preserve today's fallback: still spawn the agent;
  `ACTIVE_SUBSPEC_PATH` and `ACTIVE_SUBSPEC_BODY` are empty strings and the
  prompt omits the active-subspec block; no AC snapshot gate. Rules out
  requiring active subspec path/body on every call or stopping before spawn.
- `buildVerdictActuatorPrompt` shares migrated `patch.prompt.body` with routing
  prose removed; `REPO_GUIDANCE` and active-subspec placeholders are empty;
  appended `## Review Verdict` section is the task source. Rules out mandatory
  active-subspec or repo-guidance blocks on the actuator path.
- `buildFixupPrompt` prepends ready-failure preamble then shares migrated
  `patch.prompt.body` with routing prose removed; `REPO_GUIDANCE` and
  active-subspec placeholders are empty; fix-up preamble is the task source.
  Rules out injecting a linked subspec or repo-guidance preload on fix-up.
- Bump `patch.rules` revision when the iteration section changes; regenerate
  `patch.prompt.body` rendered fixtures per prompt governance. Rules out
  shipping stale snapshot fixtures.

## Tasks

- Extend `buildPrompt` to accept optional `repoGuidance`, `activeSubspecPath`,
  `activeSubspecBody`; pass empty strings for actuator/fix-up/shared-template
  call sites without a linked active subspec.
- Wire `v1/src/modes/patch/run.ts` implementation iterations: resolve active
  linked subspec via `getActiveLinkedSubspecPath`, read subspec body from the
  worktree when defined; read repo guidance from `project.root`.
- Update `prompts/patch/instructions.md` placeholders, delimiters, and revision
  per wire contract.
- Update `prompts/patch/rules.md` `## Iteration` per decisions; bump fragment
  revision.
- Wire `buildVerdictActuatorPrompt` and `buildFixupPrompt` to migrated template
  with empty `REPO_GUIDANCE` / active-subspec placeholders.
- Update `v1/test/prompt.test.ts`: active subspec path/body present; sibling
  subspec/index routing omitted; non-index direct path; undefined linked
  subspec fallback; actuator and fix-up positive context contracts.
- Regenerate `patch.prompt.body` rendered fixtures and snapshot assertions.
- Update `v1/docs/run-loop.md` `## Iteration` and `## Iteration banner`;
  `v1/docs/spec-guidance.md` `## Agent Workflow`; replace stale
  implementation-prompt bullets in `v2/docs/v1-behaviors.md`.
- Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] Normal index-routed implementation prompts name the harness-selected
      active subspec path and inline that subspec's full body inside
      `<<<ACTIVE_SUBSPEC_*>>>` delimiters; they do not instruct the agent to
      pick the first unchecked index link.
- [ ] Normal index-routed implementation prompts do not inline sibling subspec
      bodies, `index.md` checklist prose, or a full spec-tree dump.
- [ ] When the operator passes a subspec path (not `index.md`), the prompt
      names that path, inlines that file's body in the active-subspec block,
      and omits index-routing instructions.
- [ ] When `getActiveLinkedSubspecPath` returns `undefined`, the harness still
      spawns the agent; the prompt omits the active-subspec block and carries
      no inlined linked-subspec body.
- [ ] When repo-root `AGENTS.md` and/or `CLAUDE.md` exist under `project.root`,
      the implementation prompt inlines their contents in
      `<<<REPO_GUIDANCE_*>>>` delimiters; when absent, that section is omitted
      without error.
- [ ] The implementation prompt does not instruct the agent to discover repo
      guidance on its own.
- [ ] `prompts/patch/rules.md` no longer states that the active task is the
      first unchecked subspec link in `index.md`; tick/blocker/index-checkbox
      rules are otherwise preserved.
- [ ] `buildVerdictActuatorPrompt` output uses migrated `patch.prompt.body`
      without pick-task or discover-yourself prose; `REPO_GUIDANCE` and
      active-subspec blocks are absent; `## Review Verdict` carries the task.
- [ ] `buildFixupPrompt` output prepends ready-failure preamble, uses migrated
      `patch.prompt.body` without pick-task or discover-yourself prose, and
      omits `REPO_GUIDANCE` and active-subspec blocks.
- [ ] `v1/test/prompts/rendered-snapshots.test.ts` passes with regenerated
      `patch.prompt.body` fixtures reflecting the new template and slimmer
      rules body.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md` (`## Iteration`, `## Iteration banner`): harness-owned
  active-subspec injection, bounded repo-guidance preload, and intentional
  banner/task excerpt (`getFirstUncheckedTask`) vs harness-injected linked
  subspec when the index mixes bare tasks and linked subspecs.
- `v1/docs/spec-guidance.md` (`## Agent Workflow`): patch agents do not pick the
  first unchecked subspec; harness injects the active linked subspec.
- `v2/docs/v1-behaviors.md`: replace stale implementation-prompt and
  agent-routing bullets (do not only append). Cite `v1/src/modes/patch/run.ts`,
  `v1/src/modes/patch/prompt.ts`, `prompts/patch/instructions.md`,
  `prompts/patch/rules.md`.

## Out of scope

- Review/shrink diff bounding (`01-review-shrink-diff-bounds.md`).
- Plan mode prompts.
- Harness auto-tick or index checkbox flipping.
- Shared spec-parser extraction.
