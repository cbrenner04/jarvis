---
name: route-cleanup-archival-by-target
---

# Cleanup archives each spec to the home matching what it changed

## Problem

`jarvis cleanup` archives every spec into `v2/spec/completed/` regardless of what it changed,
so v1-work specs land in the wrong tree and the operator must hand-move them into
`v1/spec/completed/` (the manual stopgap in `operator-runbook.md` § End-of-session cleanup).

## Direction

Make `jarvis cleanup` archive a completed spec to the correct `completed/` home by what it
changed (changed files / declared target), eliminating the manual relocation. Drop the manual
stopgap from `operator-runbook.md`. The authoring and archival routing signals may be the same
mechanism or two — plan decides, but the archival destination must agree with the settled
layout. Mixed v1/v2 specs archive to the v1 home.

## Out of scope

- Authoring-time placement (separate behavior).
- Migrating already-accumulated completed specs (separate behavior).

## Prerequisites

- New seeds and specs are authored in the home matching their target.
