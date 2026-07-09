---
name: write-loop-test-thinning
---

# Thin write-loop.test.ts duplicate and supersetted coverage

`write-loop.test.ts` has crash-resume test pairs that only differ by
with/without a log sink, three abort tests where the last is a superset of the
first, a byte-for-byte duplicate test, and a terminal-mapping quartet that can
be table-driven.

## Decisions

- Merge the with/without-sink crash-resume test pairs.
- Collapse the three abort tests into one (the last supersets the first).
- Drop the byte-for-byte "omitting the log sink leaves loop behavior
  unchanged" duplicate.
- Table-drive the terminal-mapping quartet.

## Out of scope

- Src changes.
- Dropping crash-resume or abort coverage itself, only the duplicated cases.

## Verification

Test-count diff vs baseline in the PR body; every dropped test named with its
surviving owner.

## Prerequisites
