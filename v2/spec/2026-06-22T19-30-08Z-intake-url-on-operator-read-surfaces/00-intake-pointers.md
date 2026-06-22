# 00 — Intake pointers on README, AGENTS, and issue chooser

## Problem

The harness-suggestion intake (submit + triage procedure) lives only in
`v1/docs/operator-runbook.md`, which disclaims outside operators as its
audience. An operator or coding agent driving Jarvis on another target repo
never opens that doc, so the channel isn't discoverable from any surface they
actually touch: `README.md`, `AGENTS.md`/`CLAUDE.md`, or the GitHub issue
chooser.

## Decisions

- Single canonical URL `https://github.com/cbrenner04/jarvis/issues/new/choose` on all three surfaces — rules out per-surface variants (e.g. CLI `gh` snippets or template-specific links) that would drift.
- Each surface is a thin pointer, not a copy of the submit/triage procedure — the runbook stays sole source of truth; rules out duplicating steps that then rot independently.
- `AGENTS.md` is the file to edit; `CLAUDE.md` is a symlink to it — rules out editing the symlink path or both.
- `config.yml` keeps `blank_issues_enabled: true` — rules out forcing all issues through templates, which would change unrelated issue-filing behavior.

## Task checklist

- [ ] Add a short "Hit a harness gap?" pointer to `README.md` linking the canonical intake URL.
- [ ] Add a pointer to `AGENTS.md` so coding agents in any target repo can surface harness friction through the channel.
- [ ] Add a `contact_links` entry pointing at the canonical intake URL to `.github/ISSUE_TEMPLATE/config.yml` (create the file).

## Acceptance criteria

- [ ] `README.md` contains a "Hit a harness gap?" pointer whose link is exactly `https://github.com/cbrenner04/jarvis/issues/new/choose`.
- [ ] `AGENTS.md` contains a pointer directing coding agents to surface harness friction at exactly `https://github.com/cbrenner04/jarvis/issues/new/choose`.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` exists with a `contact_links` entry whose `url` is exactly `https://github.com/cbrenner04/jarvis/issues/new/choose`.
- [ ] None of the three surfaces restates the submit or triage procedure; each is a thin pointer and `v1/docs/operator-runbook.md` remains the only place carrying the full procedure.

## Documentation updates

- The three edited surfaces (`README.md`, `AGENTS.md`, `.github/ISSUE_TEMPLATE/config.yml`) are themselves the documentation deliverable.
- No `v1/docs/operator-runbook.md` change: it stays source of truth for the full procedure, unchanged.
- No `v2/docs/v1-behaviors.md` change: this adds discoverability pointers and a new config file; it does not alter existing v1 runtime behavior.
