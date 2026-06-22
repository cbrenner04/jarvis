---
name: intake-nudge-on-cli-run-completion
---

# Nudge the intake link once when a run/prompt completes

## Problem

Even with the intake on README/AGENTS, an outside operator working in the terminal has no
in-context reminder that harness friction has a submit path. The CLI should surface the link
once, where the operator already is — without adding per-iteration or help-footer noise.

## Wanted behavior

- When a `run`/`prompt` invocation completes, the end-of-run summary surfaces the canonical
  intake URL once.
- The nudge appears only at completion — not in the `help` footer, not per iteration.
- It uses the same single canonical `issues/new/choose` URL as the other surfaces.

## Decisions

- End-of-run summary is the only placement — lowest-noise spot an outside operator actually sees
  in context (rules out help footer and per-iteration nudges).

## Out of scope

- Changing the intake mechanism — only its discoverability.
- README / AGENTS / issue-chooser pointers (separate behavior).

## Prerequisites

- The GitHub harness-suggestion issue template and intake channel exist and the canonical issues/new/choose URL resolves.
- The CLI emits an end-of-run summary on run/prompt completion.
