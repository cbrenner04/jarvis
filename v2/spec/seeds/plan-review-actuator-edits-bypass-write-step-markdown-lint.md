---
name: plan-review-actuator-edits-bypass-write-step-markdown-lint
---

# Plan/intent review-actuator edits are not markdown-linted, so an actuator-introduced lint error strands finalization

## Problem

The plan/intent write step lints its staged Markdown before finalizing (shipped: plan-intent-write-steps-lint, #2669/#2671). But the **review actuator** runs *after* the write step and edits the staged spec files (applying debate/critic refinements) without re-running that lint. An actuator edit that introduces a Markdown-lint violation therefore slips past the write-step gate and only fails later at CI `lint:md` (CI now runs it) and/or the completion gate — after the draft is committed — stranding finalization.

## Evidence

- 2026-08-07: the `plan-review-premise-falsification` plan actuator embedded the retired fan-out replay criterion wrapped in outer backticks around a sentence that already contained `` `(project, branch)` ``, producing MD038 (spaces-in-code-span) at `00-…-pass.md:36`. The write-step lint had already passed on the pre-actuator draft; the actuator edit was never re-linted. CI `lint:md` failed and the draft stranded. Operator hand-fixed the backticks (italics+parens) and merged.

## Decisions

- The review actuator (plan and intent) MUST re-run the same staged-Markdown lint after applying its edits, before the completion commit — rules out an actuator-introduced lint error reaching CI/completion. Reuse the existing write-step lint seam (`runHarnessMarkdownlint` / `lint:md` staged-file pass), not a new linter.
- On actuator-lint failure, prefer a bounded self-repair/reprompt of the actuator (as the write step already does) over stranding — rules out a hard strand on a fixable authoring slip.

## Acceptance criteria

- [ ] The plan (and intent) review-actuator path lints its staged Markdown after applying edits; a test injects an actuator edit that introduces a Markdown-lint violation and asserts the pass is caught before the completion commit (fails against the pre-fix path that lints only the pre-actuator draft).
- [ ] Mutation checkpoint: in that pinning test, a `// @mutate` directive disabling the post-actuator lint pass turns the regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` (and `test:shared` if the seam is shared) pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the review actuator re-lints staged Markdown before the completion commit.
