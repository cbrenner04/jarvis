---
name: render-completion-commit-errors-in-run-cli
---

# Render completion-commit errors in run CLI output

## Module-boundary surface

- CLI: `jarvis run list` tabular output and `jarvis run wait` JSON output.

## Problem

- The CLI cannot show a generic completion-commit message even when daemon run results carry operator-error detail.

## Decisions

- Preserve `error.completionCommitError` in `run wait` JSON — rules out reducing the daemon error object to closed reason fields.
- Append one JSON-encoded `completionCommitError` column to `run list`, using `-` when absent — rules out shifting existing columns or allowing tabs and newlines to corrupt row boundaries.
- Keep `publicationFailure` output unchanged — rules out making the generic message replace structured publication diagnostics.

## Prerequisites

- Daemon `list` and `wait` project the durable message as `error.completionCommitError` (shipped in `20260804T202247Z-project-completion-commit-errors-on-run-results`).
