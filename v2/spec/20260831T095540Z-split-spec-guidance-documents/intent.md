---
name: split-spec-guidance-documents
---

# Lossless split of spec-guidance into agent core and operator docs

## Prerequisites

## Surface

Durable documentation.

## Problem

- `v1/docs/spec-guidance.md` is one monolith mixing agent authoring contracts with operator CLI and resolution guidance; every plan and intent invocation injects the whole file as `SPEC_GUIDANCE`.
- A token-saving split needs both destination documents authored and verified lossless before any injection site can switch sources without dropping guidance.

## Behavior

- Add the agent authoring core at `v2/docs/spec-guidance-agent-core.md`.
- Add the operator guidance at `v1/docs/spec-guidance-operator.md` (spec-location conventions, `repo:` resolution, `jarvis1` CLI mechanics, merge-first workflow, resume behavior, and non-index-spec handling).
- Partition every paragraph of the current monolith into exactly one of the two pinned paths; record the section-to-document inventory in the spec, mapping each former heading to `v2/docs/spec-guidance-agent-core.md` or `v1/docs/spec-guidance-operator.md`.
- Leave `v1/docs/spec-guidance.md` byte-for-byte unchanged until the follow-on injection intent lands; rules out an intermediate state where live injection reads operator-only material.

## Decision ledger

- Agent core owns subspec contracts, authored-markdown style, sizing/reviewability boundaries, intent prerequisites, behavioral AC rules (human-only markers, agent-verifiable ACs, refactor citation, rule-out reachability, failing-test requirement), heading contract, and patch-run agent workflow; rules out leaving authoring contracts in the operator doc.
- Operator doc at `v1/docs/spec-guidance-operator.md` owns spec-location conventions, external no-commit storage, `repo:` resolution order, merge-first and same-seam serial planning, `jarvis1 plan`/`intent`/`run` mechanics, resume suffix behavior, and non-index-spec prompting; rules out shipping that material in the injected core.
- Agent core durable home is `v2/docs/spec-guidance-agent-core.md`; rules out the injection intent choosing a different filename.
- Preserve `v1/docs/spec-guidance.md` unchanged through this intent; rules out breaking live `SPEC_GUIDANCE` reads between sequential plan runs.

## Acceptance criteria

- [ ] `v2/docs/spec-guidance-agent-core.md` and `v1/docs/spec-guidance-operator.md` exist and together contain every section of the current `v1/docs/spec-guidance.md` with no paragraph duplicated across them; the spec carries a split inventory mapping each former heading to exactly one of those paths (no automated guard).
- [ ] `v1/docs/spec-guidance.md` is unchanged from the repository base at merge; `shared/prompts/plan-draft.test.ts` and `v1/test/modes/plan/prompts.test.ts` bundled-guidance assertions stay green.
- [ ] `bun run lint:md` is green on the new documents.

## Documentation updates

- `v2/docs/spec-guidance-agent-core.md` and `v1/docs/spec-guidance-operator.md`.
- Cross-link the operator entry from the agent core and vice versa; do not repoint `AGENTS.md` or other monolith pointers until the injection intent lands.
