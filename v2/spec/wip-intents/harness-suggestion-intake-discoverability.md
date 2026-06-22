---
name: harness-suggestion-intake-discoverability
---

# Harness-suggestion intake: make the submit path discoverable to outside operators

## Problem

The harness-suggestion intake (`harness-suggestion-intake`, completed) put the submit
instructions only in `v1/docs/operator-runbook.md` — a doc whose own scope note
(`operator-runbook.md:5`) explicitly disclaims outside operators as its audience. An operator
driving Jarvis on some *other* target repo has no reason to open the Jarvis-on-Jarvis runbook,
so the pointer sits behind a door its intended reader won't open. The intake channel exists but
isn't discoverable from any surface an outside operator actually touches.

## Crux

Put the submit-side pointer on the surfaces outside operators do read. The runbook keeps owning
triage; discovery is the gap.

## Wanted changes

- **`README.md`** — short "Hit a harness gap?" pointer to the intake (issue template /
  `issues/new/choose`). README is the one doc every outside operator reads to install/use Jarvis.
- **`AGENTS.md` (`CLAUDE.md`)** — a pointer so coding agents working in *any* target repo can
  surface harness friction back through the channel.
- **`.github/ISSUE_TEMPLATE/config.yml`** — `contact_links` to polish the GitHub issue chooser.
- **CLI nudge** — surface the intake link in `jarvis` output (where? help footer vs run/prompt
  completion). Operator wants this; scope the lowest-noise placement.

## Open questions

- CLI nudge placement: `jarvis1 help` footer, end-of-run summary, or both? Avoid per-iteration
  noise.
- Single canonical link (the `issues/new/choose` URL) reused across all four surfaces, or
  CLI-vs-web split per surface?
- Does the runbook's existing submit section stay the source of truth (others link to it), or do
  the new surfaces carry the invocation directly?

## Out of scope

- Changing the intake mechanism itself (GitHub issue + template) — only its discoverability.

## References

- `v1/spec/completed/2026-06-22T14-10-54Z-harness-suggestion-intake/` — the channel this makes
  discoverable.
- `v1/docs/operator-runbook.md` `## Harness suggestions from other repos` — current submit/triage home.
