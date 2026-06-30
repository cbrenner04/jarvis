---
name: review-feedback-red-ci-fallback
---

# `review-feedback` falls back to failing CI context

## Problem

`jarvis1 review-feedback <worktree>` exits with `no open review comments` when a PR is red only because CI failed. The operator has no Jarvis-owned path to route deterministic CI failures back through an agent.

## Desired behavior

When the PR has open review comments, `review-feedback` keeps today's comment collection and agent loop unchanged.

When the PR has no open review comments but has red CI checks, `review-feedback` collects failing check names and concise per-check log excerpts, prepares a CI-focused review prompt, and runs the existing agent/commit/push loop.

When the PR has no open review comments and no red CI checks, preserve today's `no open review comments` success exit.

## Decisions

- Extend `review-feedback`, not a new command — rules out `jarvis1 fix-ci` or a separate subcommand.
- Open review comments take priority — rules out merging CI excerpts into comment prompts or running dual loops when comments exist.
- Red-check detection reuses triage `--merge` green/pending/red classification — rules out a parallel CI state vocabulary.
- Prompt input is failing check names plus bounded excerpts per check, not full workflow logs — rules out ingesting entire CI logs.
- Deferred to first consumer: pending CI when comments are absent — pin when the no-comments branch is drafted.
- Deferred to first consumer: excerpt fetch mechanism and per-check byte cap — pin when prompt shape is drafted.
- Deferred to first consumer: commit message text for CI-only fixes — pin when commit path is drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — CI fallback trigger, comment priority, bounded excerpt policy, unchanged green/no-comment exit.

## Prerequisites
