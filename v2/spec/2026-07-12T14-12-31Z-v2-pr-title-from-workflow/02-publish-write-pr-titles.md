# Publish write PR titles

## Problem

Direct write and spec workflows need the spec subject, not a fixed completion title.

## Decisions

- An `index.md` spec uses its trimmed H1 as the title — rules out directory names or completion-commit subjects.
- A non-index `specPath` uses its sibling `index.md` H1 — rules out the active subspec H1.
- Missing, unreadable, malformed, blank, or whitespace-only index H1 is unresolvable — rules out v1-style basename substitution.
- Write publication retains its resolved title through completed-run retry — rules out recomputing after the spec changes.

## Scope

- Resolve a spec/write creation title from the applicable index H1.
- Route direct-write and workflow-runner publication through that resolution.
- Preserve the resolved title for completed-run retry.
- Cover index, non-index, unresolvable-index, and retry cases.

## Acceptance criteria

- [x] A newly created direct-write or spec-workflow PR is titled with the trimmed H1 from its `index.md`.
- [x] A newly created non-index direct-write PR uses its sibling `index.md` H1.
- [x] A missing, unreadable, malformed, blank, or whitespace-only applicable index H1 creates `jarvis: complete run`.
- [x] Retrying completed direct-write or spec-workflow publication uses its original resolved title when the index can no longer be resolved.
- [x] Focused write-loop and workflow-runner automated tests cover index publication, non-index publication, fallback, and durable retry.

## Documentation updates

- None; operator-facing completion semantics are documented with the plan slice.
