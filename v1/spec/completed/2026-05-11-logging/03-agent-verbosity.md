# 03 — Agent subprocess verbosity flags

## Problem

Claude non-interactive output is acceptable today; Codex is too noisy **for the harness use case**. Cursor unclear. Maintainability favors **delegating verbosity to upstream CLIs**, not rewriting transcripts.

## Decisions

- Inspect each upstream CLI (`claude`, `codex`, `cursor`) documented flags/help (or authoritative docs linked in commit or README citations).
- **Codex**: prefer **explicit quiet / non-interactive** flags or defaults that approximate Claude’s readability; cite chosen flags inline in source or short module comment adjacent to invocation.
- **Claude**: default already OK — only add verbosity flags if harmless and optional; skip churn if nothing needed.
- **Cursor**: classify output level after checking available flags — choose closer to Claude than raw Codex.
- Optionally map to **config knobs** (`~/.jarvis/config.json`) if multiple presets help; minimal v1 can hardcode sane defaults documented in README.

## Tasks

- [x] Document decisions per agent in README or harness doc section (exact flags/strings).
- [x] Implement argv changes in respective `src/agents/*.ts`.
- [x] Regression tests for argv assembly (fixture expectations on command arrays / spawn mocks).

## Acceptance criteria

- `bun test` covers flag strings after change.
- Humans agree Codex chatter reduced without hiding quota/error signals relied on elsewhere.

## Documentation updates

- `README.md`: link or embed “recommended defaults” rationale for each CLI.