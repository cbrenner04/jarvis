---
name: harness-suggestion-intake
---

# Intake channel for observers on other repos to suggest harness changes

## Problem

An observer driving Jarvis on a **non-Jarvis target repo** will surface harness gaps and friction (the same way the Jarvis-on-Jarvis observer does), but has no channel to feed them back to the Jarvis project. Creating wip-intents is a Jarvis-on-Jarvis activity — it requires the jarvis repo, which the other-repo observer isn't working in. So those observers' harness insights are currently lost.

## Direction

Provide a **lightweight** intake so an other-repo observer can submit a harness suggestion, which the Jarvis-on-Jarvis observer then triages into a wip-intent. Lightest options first (prefer zero-new-infra):

- A **GitHub issue** on the jarvis repo (optionally a `harness-suggestion` issue template) — the observer already has `gh`/web; no new code.
- Or a designated **inbox** (a file/dir convention in the jarvis repo) if issues aren't desired.
- Avoid a new `jarvis` subcommand unless friction proves it necessary (fewer-commands principle); a thin `jarvis suggest` wrapper is a *deferred* option, not the default.

The Jarvis-on-Jarvis observer runbook documents the triage side: incoming suggestions → wip-intents.

## Out of scope

- A heavyweight feedback service or multi-user intake (single operator).
- Auto-converting suggestions into specs — triage stays a human/observer judgment.

## Documentation updates

- Jarvis-on-Jarvis observer runbook: triage incoming harness suggestions into wip-intents.
- Wherever other-repo observers are onboarded: how to submit (the chosen channel).

## References

- Relates to the Jarvis-on-Jarvis observer's "create wip-intents for harness gaps" deliverable; this is the same loop opened to observers who aren't in the jarvis repo.

## Prerequisites

none
