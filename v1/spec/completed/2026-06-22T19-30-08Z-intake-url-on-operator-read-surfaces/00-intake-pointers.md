# 00 — Intake pointers on README and AGENTS

## Problem

The harness-suggestion intake (submit + triage procedure) lives only in
`v1/docs/operator-runbook.md`, which disclaims outside operators as its
audience. An operator or coding agent driving Jarvis on another target repo
never opens that doc, so the channel isn't discoverable from any surface they
actually touch: `README.md` or `AGENTS.md`/`CLAUDE.md`.

## Decisions

- Single canonical URL `https://github.com/cbrenner04/jarvis/issues/new/choose` on both surfaces — rules out per-surface variants (e.g. CLI `gh` snippets or template-specific links) that would drift.
- Each surface is a thin pointer, not a copy of the submit/triage procedure — the runbook stays sole source of truth; rules out duplicating steps that then rot independently.
- `AGENTS.md` is the file to edit; `CLAUDE.md` is a symlink to it — rules out editing the symlink path or both.
- Do not add an `issues/new/choose` `contact_link` to `.github/ISSUE_TEMPLATE/config.yml` — `contact_links` render on the chooser page to route filers *off* it, so a link back to the chooser reloads the page it's on, and the `harness-suggestion` template already appears there as a first-class option. Rules out the intent's "same URL on every surface" framing for the chooser, where the canonical URL *is* the page.

## Task checklist

- [ ] Add a short "Hit a harness gap?" pointer to `README.md` linking the canonical intake URL.
- [ ] Add a pointer to `AGENTS.md` so coding agents in any target repo can surface harness friction through the channel.

## Acceptance criteria

- [x] `README.md` contains a "Hit a harness gap?" pointer whose link is exactly `https://github.com/cbrenner04/jarvis/issues/new/choose`.
- [x] `AGENTS.md` contains a pointer directing coding agents to surface harness friction at exactly `https://github.com/cbrenner04/jarvis/issues/new/choose`.
- [x] Neither surface restates the submit or triage procedure (no numbered submit/triage steps); each is a thin pointer and `v1/docs/operator-runbook.md` remains the only place carrying the full procedure.

## Documentation updates

- The two edited surfaces (`README.md`, `AGENTS.md`) are themselves the documentation deliverable.
- No `v1/docs/operator-runbook.md` change: it stays source of truth for the full procedure, unchanged.
- No `v2/docs/v1-behaviors.md` change: this adds discoverability pointers; it does not alter existing v1 runtime behavior.
