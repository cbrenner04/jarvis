# Lossless split spec-guidance documents

## Problem

`v1/docs/spec-guidance.md` mixes agent authoring contracts with operator CLI and resolution guidance; every plan and intent invocation injects the whole file as `SPEC_GUIDANCE`. Token savings require both destination documents authored and verified lossless before the follow-on injection intent can switch sources without dropping guidance.

## Decision ledger

- Agent core durable home is `v2/docs/spec-guidance-agent-core.md`; rules out the injection intent choosing a different filename.
- `v1/docs/spec-guidance-operator.md` is interim staging for this spec only; follow-on inject overwrites `v1/docs/spec-guidance.md` with that content and deletes the staging file — steady-state operator home remains `v1/docs/spec-guidance.md`; rules out treating the staging path as permanent.
- Preserve `v1/docs/spec-guidance.md` byte-for-byte unchanged through this spec; rules out breaking live `SPEC_GUIDANCE` reads between sequential plan runs.
- Lossless partition unit is paragraphs, list items (each bullet block), fenced code blocks, and the title/intro line; inventory rows may subdivide within a heading; rules out heading-only assignment when a heading spans both surfaces.
- Partition by unit ownership per the split inventory below; when a former `## Authoring` paragraph spans both surfaces, relocate sizing and prerequisite prose under agent-core headings rather than duplicating it; rules out leaving authoring contracts in the operator doc or CLI mechanics in the agent core.
- Split the monolith `seeds/`/`ready-intents/` paragraph at the consumption clause: agent core owns queue/promotion/fan-out text through `` Fan-out writes reviewed, one-per-surface intents to `ready-intents/`; `` with no `jarvis1` substring; operator doc owns the trailing consumption sentence (`` later `jarvis1 plan` runs consume those intents one at a time. ``) verbatim under operator `## Authoring`; rules out shipping `jarvis1` in agent core or duplicating queue semantics in operator.
- Replace monolith self-referential "this file" (and equivalent phrasing) with a repo-relative cross-link to the other split document where the partition makes "this file" wrong; rules out leaving post-split self-references that point at the wrong doc.
- Cross-link the two new documents using repo-relative paths from each file's location; do not repoint `AGENTS.md` or other monolith pointers until the injection intent lands; rules out premature pointer churn that would reference a not-yet-injected source.

## Split inventory

Map each former `v1/docs/spec-guidance.md` heading (or inventory sub-row within a heading) to exactly one destination. Units under `` ## Authoring with `jarvis1 plan` or `jarvis1 intent` `` that the ledger assigns to agent core relocate under agent-core headings (for example `## Sizing and intent boundaries`, `### Intent prerequisites`); they are not duplicated under the operator `## Authoring` section.

| Former heading | Destination |
| --- | --- |
| `# Spec Guidance for Agents` (title) | `v2/docs/spec-guidance-agent-core.md` |
| Intro paragraph (`This file is stable guidance…`) | `v2/docs/spec-guidance-agent-core.md` |
| `## Spec location conventions` | `v1/docs/spec-guidance-operator.md` |
| `### In-repo specs (committed)` | `v1/docs/spec-guidance-operator.md` |
| `### External specs (no-commit)` | `v1/docs/spec-guidance-operator.md` |
| `## Land the spec before implementing it` | `v1/docs/spec-guidance-operator.md` |
| `## Plan same-seam siblings serially` | `v1/docs/spec-guidance-operator.md` |
| `` ## Authoring with `jarvis1 plan` or `jarvis1 intent` `` (CLI mechanics, draft PR workflow, resume suffix, structured-index operator workflow) | `v1/docs/spec-guidance-operator.md` |
| `## Authoring…` paragraphs: self-referential deliverables rule, fresh-plan seed flow, sizing boundaries (`subspec` / `intent` / `spec`, reviewability cap, intent-split guidance) | `v2/docs/spec-guidance-agent-core.md` |
| `## Authoring…` `seeds/`/`ready-intents/` queue paragraph through fan-out clause (through `` …intents to `ready-intents/`; ``; no consumption sentence) | `v2/docs/spec-guidance-agent-core.md` |
| `## Authoring…` consumption sentence (`` later `jarvis1 plan` runs consume those intents one at a time. ``) | `v1/docs/spec-guidance-operator.md` |
| `### Intent prerequisites` | `v2/docs/spec-guidance-agent-core.md` |
| `## Subspecs` | `v2/docs/spec-guidance-agent-core.md` |
| `### Authored markdown style` | `v2/docs/spec-guidance-agent-core.md` |
| `### Behavioral acceptance criteria` | `v2/docs/spec-guidance-agent-core.md` |
| `#### Behavior-preserving (refactor) ACs: cite the test, don't paraphrase` | `v2/docs/spec-guidance-agent-core.md` |
| `#### Rule-out and invariant guards: cite reachability on the base` | `v2/docs/spec-guidance-agent-core.md` |
| `#### Failing-test requirement for runtime-behavior subspecs` | `v2/docs/spec-guidance-agent-core.md` |
| `#### Human-only acceptance criteria` | `v2/docs/spec-guidance-agent-core.md` |
| `#### Agent-verifiable acceptance criteria` | `v2/docs/spec-guidance-agent-core.md` |
| Subspec heading contract bullets (`## Acceptance criteria`, `## Blocker`) | `v2/docs/spec-guidance-agent-core.md` |
| `## Agent Workflow` | `v2/docs/spec-guidance-agent-core.md` |
| `## Non-index spec handling` | `v1/docs/spec-guidance-operator.md` |

## Prerequisites

none

## Task checklist

- Author `v2/docs/spec-guidance-agent-core.md` with every agent-core inventory row, an agent-facing title and intro, a repo-relative cross-link to the operator staging doc, and no `jarvis1` substring.
- Author `v1/docs/spec-guidance-operator.md` with every operator inventory row, an operator-facing title and intro, and a repo-relative cross-link to the agent core.
- Copy monolith units verbatim into their assigned destination; adjust only heading placement, repo-relative intra-doc and cross-doc links, self-referential "this file" rewrites per the ledger, and the `seeds/`/`ready-intents/` paragraph split — no other substantive rewrites.
- Leave `v1/docs/spec-guidance.md` untouched.
- Run `bun run lint:md` on the new documents.

## Acceptance criteria

- [x] `v2/docs/spec-guidance-agent-core.md` exists, links to `v1/docs/spec-guidance-operator.md`, and contains the `## Subspecs`, `### Authored markdown style`, `### Behavioral acceptance criteria`, subspec heading-contract bullets, and `## Agent Workflow` sections from the split inventory.
- [x] `v1/docs/spec-guidance-operator.md` exists, links to `v2/docs/spec-guidance-agent-core.md`, and contains the `## Spec location conventions`, `## Land the spec before implementing it`, `## Plan same-seam siblings serially`, operator-facing `## Authoring` material, and `## Non-index spec handling` sections from the split inventory.
- [x] Together the two documents contain every paragraph of `v1/docs/spec-guidance.md` with no paragraph duplicated across them; the split inventory above matches the landed partition. (no automated guard)
- [x] `v1/docs/spec-guidance.md` is byte-identical to the merge-base version (`git diff <merge-base> -- v1/docs/spec-guidance.md` is empty).
- [x] `shared/prompts/plan-draft.test.ts` bundled-guidance assertions stay green.
- [x] `v1/test/modes/plan/prompts.test.ts` bundled-guidance assertions stay green.
- [x] `bun run lint:md` passes with the new documents in the lint corpus.

## Documentation updates

- `v2/docs/spec-guidance-agent-core.md`
- `v1/docs/spec-guidance-operator.md`
