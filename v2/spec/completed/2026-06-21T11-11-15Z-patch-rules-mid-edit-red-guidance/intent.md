---
name: patch-rules-mid-edit-red-guidance
---
# Patch-rules guidance: mid-edit red is not pre-existing breakage

## Problem

The patch agent treated an intermediate red suite — tests run before its own edits
(e.g. snapshot updates) were finished — as evidence of pre-existing, unrelated breakage,
and raised a blocker on that basis. The injected patch rules say nothing about this.

## Direction

Add guidance to the inline-injected patch rules:

- A red suite observed mid-edit is not evidence of pre-existing breakage.
- "Pre-existing / unrelated / baseline failures" is not grounds for a blocker without
  base-ref confirmation.
- Finish your edits and re-run before concluding the suite is broken.

## Out of scope

- Harness-side base-ref validation and snapshot handling (separate intents); this is the
  agent-side guidance only.

## Documentation updates

- `prompts/patch/rules.md` — the mid-edit-red guidance (the rules file is the doc).

## Prerequisites

