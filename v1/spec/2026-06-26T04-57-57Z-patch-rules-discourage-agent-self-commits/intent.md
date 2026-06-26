---
name: patch-rules-discourage-agent-self-commits
---

# Patch rules instruct the agent to leave committing to jarvis

## Problem

Some patch agents (e.g. haiku) create their own commits during a subspec.
Jarvis owns all commits, so agent self-commits interleave agent-style commits
with jarvis completion commits and (today) can abort the run. Reducing
self-commits lowers the blast radius even where the harness is robust to them.

## Behavior

The injected patch-mode rules tell the agent not to run `git commit` (or
otherwise create commits) — jarvis owns staging and committing. This is a
belt-and-suspenders complement: the harness must remain robust to a
self-committing agent regardless of this instruction, so this intent only
changes the guidance the agent receives, not harness commit handling.

## Prerequisites
