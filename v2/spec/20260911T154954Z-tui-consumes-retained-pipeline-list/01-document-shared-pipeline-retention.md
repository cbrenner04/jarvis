# Document that TUI and CLI share pipeline display retention

## Problem

Operator docs do not say that the TUI's work tree and attention segment show the same retained pipeline set as `jarvis pipeline list`, nor that dismissal, retention, and stale-terminal attention suppression are three independent display rules. `operator-runbook.md` also still points at an obsolete seed for the retention concern that #3788 already resolved.

## Decisions

- Describe retention as a daemon-boundary display rule shared by both surfaces; rules out documenting a TUI-specific window.
- State that the dismissed toggle does not widen history; rules out operators reading `d` as a way to recover beyond-window terminals.
- Point *listing* recovery of older terminal pipelines at `jarvis pipeline list --since`/`--state`, which has no TUI equivalent; scope this to listing only, since ID-prefix resolution and direct by-ID commands already reach an evicted pipeline via `loadPipeline`, independent of the cap.
- `v2/docs/v1-behaviors.md:291` already documents the `pipeline_list` cap, its `sinceMs`/`state` exemptions, and durable-row preservation; add the TUI-inheritance fact as an amendment to that entry rather than a new one.
- Retire the obsolete `pipeline-list-display-retention` seed reference in `operator-runbook.md`; the unbounded-row-growth concern it named shipped in #3788.

## Task checklist

- [ ] Runbook cross-links the three independent display rules and drops the obsolete seed reference.
- [ ] `v2/docs/tui.md` documents retained pipeline membership, scoping the `--since`/`--state` recovery claim to listing.
- [ ] `v2/docs/v1-behaviors.md:291`'s entry is amended to note TUI inheritance.

## Acceptance criteria

- [ ] `v2/docs/operator-runbook.md` states that TUI and CLI default pipeline views share the daemon's terminal retention, cross-links dismissal and stale-terminal attention suppression as independent display rules, and no longer references the `pipeline-list-display-retention` seed.
- [ ] `v2/docs/tui.md` documents which pipelines the work tree and attention segment can show, that the dismissed toggle does not request history, and that listing older terminal pipelines (not resolving one directly by ID) requires `jarvis pipeline list --since`/`--state`.
- [ ] The `v1-behaviors.md:291` entry on the `pipeline_list` cap is amended to state that TUI pipeline-derived surfaces (work tree, counts, attention) inherit the same retention.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — shared retention plus cross-links to dismissal and attention suppression; drop the obsolete seed reference.
- `v2/docs/tui.md` — retained pipeline membership and its interaction with the dismissed toggle and attention recency; scope history recovery to listing.
- `v2/docs/v1-behaviors.md` — amend the existing `pipeline_list` cap entry (`:291`) to record TUI inheritance.
