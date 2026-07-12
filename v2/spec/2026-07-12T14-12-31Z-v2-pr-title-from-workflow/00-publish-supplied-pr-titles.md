# Publish supplied PR titles

## Problem

The publisher creates every new PR as `jarvis: complete run`.

## Decisions

- Completion publication accepts a caller-supplied creation title — rules out publisher-owned workflow inference.
- Missing, unreadable, malformed, blank, or whitespace-only subjects resolve to `jarvis: complete run` — rules out basename substitution or failed publication.
- Every matching open PR, draft or ready, keeps its title — rules out mutating an existing review surface.

## Scope

- Carry a creation title into draft-PR creation.
- Apply the fixed fallback only when that input is absent or unusable.
- Cover creation fallback and reuse of draft and ready PRs in publisher tests.

## Acceptance criteria

- [ ] A new draft PR uses the supplied creation title.
- [ ] A new draft PR uses `jarvis: complete run` when its supplied subject is missing, unreadable, malformed, blank, or whitespace-only.
- [ ] Reusing matching open draft or ready PRs leaves each existing title unchanged.
- [ ] Focused `completion-publisher` automated tests cover supplied title, fallback, and draft/ready reuse.

## Documentation updates

- None; operator-facing workflow semantics are documented with their final workflow slice.
