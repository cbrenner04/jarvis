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

## Decisions (operator, 2026-06-22)

- **CLI nudge placement: end-of-run summary only** — not the `help` footer, not per-iteration.
  Surfaced once when a `run`/`prompt` completes; lowest-noise placement that an outside operator
  actually sees in context.
- **Single canonical `issues/new/choose` URL across all four surfaces** (README, AGENTS.md,
  `config.yml`, CLI end-of-run). One link to keep current, no drift; works whether clicked or
  pasted.
- **Runbook stays the source of truth** for the full submit/triage procedure; the new surfaces are
  thin pointers to the canonical URL, not duplicated invocations.

## Out of scope

- Changing the intake mechanism itself (GitHub issue + template) — only its discoverability.

## References

- `v1/spec/completed/2026-06-22T14-10-54Z-harness-suggestion-intake/` — the channel this makes
  discoverable.
- `v1/docs/operator-runbook.md` `## Harness suggestions from other repos` — current submit/triage home.
