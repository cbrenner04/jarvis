# v2 PR bodies are a bare template — the narrative slot exists but nothing fills it

## Problem

`pr-body-refresh.ts` builds a v2 PR body from a `Spec:` header block plus an attribution footer, and
**preserves** any agent narrative found between `<!-- jarvis:narrative:start -->` /
`<!-- jarvis:narrative:end -->` markers (`pr-body-refresh.ts:5-6,94-98`). But in v2 **nothing writes
those markers** — `NARRATIVE_START_MARKER` is referenced only in `pr-body-refresh.ts` itself
(the extract side). So the preserved-narrative path is dead: every v2 implement PR ships with only
the templated header and no description of what changed or why.

Config carries `prNarrative: "agent"`, implying a narrative is meant to be authored, but the v2
publication path never produces one. Observed this session: implement PRs published by the harness
(#1684, cleanup attempts) carried a bare `Spec:` header; the substantive PR bodies this session were
all operator-written by hand.

A reviewer opening a v2 PR gets the spec path and nothing else — no summary of the change, no
reproduction, no rationale. That pushes the whole burden onto diff-reading and is part of why every
implement PR needs a hand-review pass.

## Decisions

- The v2 publication path authors a narrative into the marker block; rules out a preserve-only
  seam with no producer. The shrink step already runs an agent post-completion and is the natural
  producer (`workflow-runner.ts:105-107,677`).
- The narrative describes the change at review altitude — what changed, why, how to verify — not a
  restatement of the spec; rules out echoing the `Spec:` header back.
- Markers are always emitted so `pr-body-refresh.ts`'s extract/preserve logic round-trips on a
  re-publish; rules out a narrative that a subsequent `pr edit` silently drops.
- Keep authorship inside an existing invocation (shrink) rather than adding a publication-time agent
  call; rules out a new per-PR agent round-trip. Pairs with
  [[completion-commit-message-is-a-fixed-template]] — same publication seam; decide the two
  authorship questions together.

## Notes

Not the same as the `acceptance-criteria-must-be-satisfiable-by-the-agent` seed: that one correctly
says the *implement agent* cannot write the PR body because the harness owns publication. This seed
is about the harness's *own* publication step producing a real narrative — the `prNarrative` job it
already claims to do.

## Documentation updates

- `v2/docs/workflow-runner.md` — document where the PR narrative is authored and the marker contract.
- `v2/docs/operator-runbook.md` § Gate trust / publication — note the PR body now carries a narrative.
