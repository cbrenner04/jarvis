---
name: intake-url-on-operator-read-surfaces
---

# Surface the harness-suggestion intake on the docs an outside operator reads

## Problem

The intake submit path lives only in `v1/docs/operator-runbook.md`, whose scope note
disclaims outside operators as its audience. An operator (or coding agent) driving Jarvis
on another target repo never opens that doc, so the channel isn't discoverable from any
surface they actually touch.

## Wanted behavior

- `README.md` carries a short "Hit a harness gap?" pointer to the canonical
  `issues/new/choose` URL — README is the doc every outside operator reads to install/use Jarvis.
- `AGENTS.md` (`CLAUDE.md`) carries a pointer so coding agents in any target repo can surface
  harness friction back through the channel.
- `.github/ISSUE_TEMPLATE/config.yml` adds a `contact_links` entry pointing at the same intake,
  polishing the GitHub issue chooser.
- All three use the single canonical `https://github.com/cbrenner04/jarvis/issues/new/choose` URL —
  thin pointers, not duplicated submit/triage procedure.

## Decisions

- One canonical `issues/new/choose` URL across all surfaces — no drift, works clicked or pasted.
- Runbook stays source of truth for the full submit/triage procedure; these are thin pointers only.

## Out of scope

- Changing the intake mechanism (GitHub issue + template) — only its discoverability.
- The CLI end-of-run nudge (separate behavior).

## Prerequisites

- The GitHub harness-suggestion issue template and intake channel exist and the canonical issues/new/choose URL resolves.
