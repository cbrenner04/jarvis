---
name: prnarrative-template-low-value-vs-agent-default
---

# `template` prNarrative produces low-value PR descriptions

## Problem

The `template` prNarrative (`v1/src/pr-shared.ts` `generateTemplateNarrative`)
emits a deterministic subspec-titles + commit-subjects list that conveys little
of *what changed or why* — low review value. The `agent` narrative is markedly
better on the same changes. The default is `template` for both patch and plan
(`v1/src/config.ts`). The reporter initially credited `template` for good
descriptions that were in fact agent-authored (intake issue #521).

Left as-is, the default narrative under-serves review on every PR that doesn't
opt into `agent`.

## Direction

Take a hard look at `template` output quality. Options for plan to weigh:

- Substantially improve `template` — pull a real summary / why / risk from the
  diff + spec, not just titles and subjects.
- Or reconsider defaulting `prNarrative` to `agent`, documenting the tradeoff
  (deterministic/cheap template vs. contextual/token-heavier agent) so the
  operator chooses deliberately.

## Out of scope

- Removing the `template` mode entirely (cheap/deterministic has a place).
- The `agent` extraction contract (sentinel delimiters), which already works.

## References

- `v1/src/pr-shared.ts` — `generateTemplateNarrative`.
- `v1/src/config.ts` — `prNarrative` defaults (patch + plan).
- `v1/docs/worktrees-and-commits.md` — PR narrative section.
- Intake issue #521; completed `restore-useful-pr-descriptions`,
  `pr-description-sentinel-extraction`.
