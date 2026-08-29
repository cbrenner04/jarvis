---
name: split-spec-guidance-agent-core
---

# Split spec-guidance into an injected agent core and an operator doc

## Problem

`v1/docs/spec-guidance.md` (371 lines, ~30KB) is injected wholesale as `SPEC_GUIDANCE` into every plan draft, every plan debate role, the plan actuator, and every intent review role (`shared/prompts/review-plan.ts:60`, `shared/prompts/review-intent.ts:18`, `v2/src/execution/write.ts:783-785`). A plan run with one debate cycle renders it 5–7×. Roughly half the file is operator/v1-CLI material the agent cannot act on: spec-location conventions, `repo:` resolution order, `jarvis1` resume mechanics, non-index-spec prompting, external no-commit storage. This is the largest recurring token cost in the harness and it ships on every plan and intent invocation.

## Decisions

- Split into two documents: an agent-facing authoring core (AC contracts, mutation/keystone-checkpoint rules, heading contracts, sizing/reviewability boundary, authored-markdown style, agent workflow) and an operator doc (location conventions, resolution, CLI mechanics). All `SPEC_GUIDANCE` injection sites read only the core. Rules out shipping operator CLI docs to every agent.
- The split is lossless: every paragraph of the current file lands in exactly one of the two documents, verifiable by diff. Rules out silently dropping guidance during the move.
- One durable home for the core, referenced by both engines' injection sites; the operator doc keeps or inherits the current `v1/docs/spec-guidance.md` cross-links. Rules out two drifting copies of the authoring rules.

## Acceptance criteria

- [ ] The injected core contains no `jarvis1` operator-command content, pinned by a render test grepping the assembled plan-draft prompt.
- [ ] The core retains the load-bearing contracts (exact `## Acceptance criteria` / `## Blocker` headings, mutation-checkpoint directive rules, keystone rules, human-only markers, agent-verifiable AC rules), pinned by render-test substrings.
- [ ] Every current section is present in exactly one of the two documents (split inventory in the spec), no automated guard.
- [ ] Plan and intent workflows render successfully against the new injection source, pinned by existing render-coverage tests.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass; `bun run lint:md` green on the new documents.

## Documentation updates

- The two new/split documents themselves; `v2/docs/prompts.md` — name the injection source; `CLAUDE.md` spec-guidance pointer if the path changes.
