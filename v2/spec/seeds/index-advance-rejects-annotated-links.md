---
name: index-advance-rejects-annotated-links
---

# Index advancement rejects annotated links, stranding every completed subspec as `blocked`

## Problem

`advanceLinkedSubspecCheckbox` (`shared/linked-subspec-routing.ts`) identified index link lines with its own pattern, anchored at the closing paren:

```text
/^\s*-\s\[(.)\]\s+\[([^\]]+)\]\(([^)]+)\)$/
```

An index link may carry a trailing annotation (`— why`, `(after 00)`), which plan drafts now emit as standard. Such a line never matched, so the link counter never advanced, the function returned `undefined`, and `completeLinkedSubspec` settled `index_routing_mutated`.

The failure lands *after* the subspec is genuinely finished: the write step commits, settles `done` / `completed`, and only then does routing refuse to tick the box. The run ends `blocked` with `resumable: false`, so the documented recovery does not apply and the completed work is stranded on a branch with no PR.

`parseSpec` was fixed for exactly this in [#3744](https://github.com/cbrenner04/jarvis/pull/3744) and carries a comment explaining why it must not anchor — but `advanceLinkedSubspecCheckbox` kept a private copy of the pattern, so the guard at the top of the function (`parseSpec(...).linkedSubspecs[linkIndex]`) passed while the rewrite below failed. That divergence is the defect; the fourth call site of this class after [#3732](https://github.com/cbrenner04/jarvis/pull/3732) (publication landing), [#3739](https://github.com/cbrenner04/jarvis/pull/3739) (plan-draft contract), and #3744 (`spec-parser`).

## Evidence (2026-09-12)

Two of two implement lanes in one session, different specs, different agents, identical settlement:

| Branch | Active subspec | Outcome |
| --- | --- | --- |
| `20260911T021740Z-handoff-daemon-generations-at-stable-address` | `00-stable-public-daemon-address.md` (7/7 criteria ticked) | `run_execution_failed: implement.index_routing_mutated` → `blocked`, `resumable: false` |
| `20260912T152453Z-classify-and-checkpoint-gate-refusals` | `00-classify-refusal-cause.md` (6/6 criteria ticked) | same |

Both committed real work (17 and 9 files). Reproduced directly:

```text
advanceLinkedSubspecCheckbox("- [ ] [00-a.md](./00-a.md) — does a thing", 0) -> undefined
advanceLinkedSubspecCheckbox("- [ ] [00-a.md](./00-a.md)",                0) -> "- [x] …"
```

## Decisions

- One exported matcher in `shared/spec-parser.ts` decides what an index link line is, and every consumer uses it; rules out a fifth private copy of the pattern drifting from the other four.
- `advanceLinkedSubspecCheckbox` reads checked-state from the line it is rewriting rather than from a capture group of its own pattern; rules out reintroducing a parse the shared matcher already owns.
- Shipped by hand 2026-09-12 with the fix, because it blocked every multi-subspec implement.

## Acceptance criteria

- [x] `advanceLinkedSubspecCheckbox` advances an annotated index link (`— why`, `(after 00)`) at any position, and the regression fails against the anchored pattern.
- [x] `completeLinkedSubspec` returns `ok: true` for an annotated index, not `index_routing_mutated`.
- [x] An already-checked annotated link is returned unchanged rather than refused.
- [x] `shared/spec-parser.ts` exports the single link-line matcher and `parseSpec` uses it.
- [x] `bun run typecheck`, `bun run check`, `test:shared`, `test:v2` pass.

## Documentation updates

- [x] `v2/docs/v1-behaviors.md` — index advancement tolerates annotated links.
