---
name: per-project-ready-gate-retry-knob
---

# Per-project knob for ready-gate retry count

## Problem

Known-flaky target suites need more retries than the default; stable suites want fewer (or zero) to
fail fast. A single hardcoded retry count can't serve both.

## Behavior

Add a per-project config knob controlling how many times the completion ready gate is re-run on red
before the fix-up loop engages. Absent the knob, the default retry behavior applies unchanged.
Setting it raises retries for known-flaky projects or lowers them to fail fast on stable ones.

## Out of scope

- The retry-on-red behavior itself (prerequisite).
- Discarding fix-up commits.

## Prerequisites
- The completion ready gate retries on red before entering the fix-up loop.
