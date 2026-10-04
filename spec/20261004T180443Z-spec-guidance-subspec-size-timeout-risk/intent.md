---
name: spec-guidance-subspec-size-timeout-risk
---

# Spec guidance warns that oversized single-file or open-ended subspecs invite iteration timeout

## Problem

Several 2026-10-03/04 implement runs hit the 45-minute wall clock mid-subspec while still making progress; oversized subspecs (large single-file rewrites or unbounded file lists) are a recurring timeout risk independent of harness rollover fixes.

## Decisions

- Add one terse bullet to `docs/spec-guidance.md`: a subspec that rewrites more than a few hundred lines in one file, or whose touched-file list is open-ended, is a timeout hazard and must be split or explicitly sized before implement dispatch.

## Prerequisites

## Documentation updates

- `docs/spec-guidance.md` — subspec sizing / timeout-risk bullet from the seed.
