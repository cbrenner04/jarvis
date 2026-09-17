---
name: decisions-ledger-prompt-requires-bullet-list
---

# Decisions-ledger prompt asks for a Markdown bullet list, not "one per line"

## Problem

`prompts/plan/decisions-ledger.md` asks for decisions "as a ledger of atomic entries, one per line". Taken literally that produces bare consecutive lines, which Markdown reads as one soft-wrapped paragraph, so the `no-hard-wrap` staged lint rejects the draft (issue #3949: pipeline `0676c490`, lane `plan-accepts-and-validates-base-flag`, runs `635c94bc` and `11fc404b`).

## Decisions

- The guidance requires a Markdown bullet list (`- entry`), one entry per bullet, keeping the existing atomicity and load-bearing-only rules unchanged.
- Rules out relying on `bun run reflow:md` to repair the draft: reflow merges separate bare lines into one paragraph, destroying entry boundaries.
- The fragment `revision` bumps so the rendered prompt corpus change is visible.

## Acceptance criteria

- [ ] A prompt-render test asserts the rendered `plan.decisions-ledger` guidance names a Markdown bullet list; it fails against the current "one per line" text.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Prerequisites

## Documentation updates

- `v2/docs/spec-guidance.md` — the decisions ledger is a bullet list.
