---
name: implement-owns-its-prompt-ids
---

# Implement owns its prompt ids: retire "Patch Mode" vocabulary from the v2 primary path

## Problem

v2's implement workflow runs on `patch.prompt.body` + `patch.rules` — a prompt headed "Patch Mode" in v1 vocabulary — at `v2/src/execution/implement-workflow-steps.ts:513`, `v2/src/execution/write.ts:91`, and `shared/prompts/review-implement.ts:86`. All four `implement/review-*.md` files carry `behavior: patch` (the field that controls fragment auto-attachment; currently inert, silently misleading). `intent/split.md` carries `behavior: plan`, which auto-attaches `plan.decisions-ledger` and `plan.defer-to-consumer` to the split prompt as an unreviewed side effect of the label. `patch/rules.md` also hard-codes jarvis-repo-specific scar tissue (bun serial-rerun flake recovery, machine-config fixture hygiene, setTimeout-guard extraction) into the generic rules sent to any target repo — immediately after a rule saying to use the target repo's `AGENTS.md` commands. And `v2/docs/prompts.md` is wrong about its first entry: it claims `write.execute` is the default for plan/implement/standalone write and injects `REPO_GUIDANCE`/`ACTIVE_SUBSPEC_BODY`, but the artifact declares three placeholders and implement actually uses `patch.prompt.body`; the doc omits the review families entirely.

## Decisions

- The body and rules artifacts move to implement-owned ids; v1's call sites update mechanically to the new ids (id strings only, maintenance-scope), keeping one artifact per prompt. Rules out forking a second copy of the body prompt to preserve the old id.
- The prompt heading and prose drop "Patch Mode" for the behavior's real name. Rules out v1 sequencing vocabulary in the primary engine's core prompt.
- `behavior:` frontmatter is corrected to match actual fragment intent, and any wanted cross-behavior fragment attachment becomes an explicit `add:` list — `intent/split.md`'s plan-fragment attachment is decided explicitly, not inherited from a label. Rules out silent attachment via mislabeled behavior.
- Jarvis-repo-specific rules migrate out of the generic rules artifact into this repo's injected repo guidance (`AGENTS.md`/spec guidance), leaving the rules artifact target-repo-neutral. Rules out shipping bun-specific recovery rules to non-bun targets and delivering them twice here.
- `v2/docs/prompts.md` is corrected and extended to cover the live corpus: per-workflow step prompts, review families, ownership, and render path. Rules out the doc describing a wiring that does not exist.
- Sequenced after the terse-review-roles and fragment-policy seeds so files are not rewritten twice. Rules out interleaved churn on the same artifacts.

## Acceptance criteria

- [ ] The rendered v2 implement step prompt contains no "Patch Mode" text, pinned by a render test.
- [ ] No registered artifact's `behavior:` attaches a fragment its step did not explicitly opt into; the intent-split prompt's fragment set is asserted, pinned.
- [ ] The generic rules artifact contains no jarvis-repo-specific tool commands, pinned by a render test; the migrated rules are present in this repo's injected guidance.
- [ ] v1 patch runs render green with the updated ids, pinned by v1 prompt tests.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — full rewrite per above; `v2/docs/v1-behaviors.md` — record the id migration; `v1/docs/prompt-governance.md` — ownership note.
