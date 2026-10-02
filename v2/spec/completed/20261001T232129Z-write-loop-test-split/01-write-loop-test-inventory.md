# write-loop test inventory guard

## Problem

Describe-area moves out of `write-loop.test.ts` can drop leaf cases silently; the intent requires merge-base title preservation with surplus allowed, matching the resume-path inventory pattern but anchored on `write-loop.test.ts` only.

## Surface

Primary: `v2/src/execution/write-loop-test-inventory.test.ts` (new).

## Prerequisites

- Subspec 00 complete: `write-loop.test-support.ts` exists and `write-loop.test.ts` imports it.

## Decision ledger

- New `write-loop-test-inventory.test.ts` follows `workflow-runner-resume-inventory.test.ts`: parse-only anchor array, `locateParseOnlyInventoryArrayBody`, merge-base resolution via `git merge-base HEAD` against `main` / `origin/main` / `refs/remotes/origin/main`; rules out ad-hoc base refs or prefix-blind regex over the module.
- Source bucket is merge-base `v2/src/execution/write-loop.test.ts` leaf titles only; rules out requiring parity for cases that always lived in other stems (`write-loop-input`, `write-loop-intent-landing`, …).
- Destination scan is missing-only multiset parity: every merge-base leaf title must appear in the owned destination union; extra destination titles are allowed; rules out resume-style strict equal-count parity across buckets.
- Owned destinations are `write-loop.test.ts` plus every `v2/src/execution/write-loop-*.test.ts` basename not on the merge-base exclusion roster (`write-loop-input`, `write-loop-intent-landing`, `write-loop-draft-reprompt`, `write-loop-idle-watchdog`, `write-loop-session-log`, `write-loop-staged-markdown-lint`, any `*.sandbox-unrunnable.test.ts` stem, and `write-loop-test-inventory.test.ts`); rules out scanning unrelated pre-existing co-located suites as move targets.
- Scanner expands `test.each` rows into leaf titles and keys nested `describe` paths; rules out counting only outer templates.
- `write-loop-test-inventory.test.ts` fails against the pre-fix tree where the file is absent; rules out treating the guard as documentation-only.

## Task checklist

- Add `write-loop-test-inventory.test.ts` with merge-base loading of `write-loop.test.ts`, owned-destination discovery, missing-only parity assertion, and `test.each` row expansion (reuse shared locator helpers when present).
- Keep the inventory passing while all titles still live in `write-loop.test.ts` (pre-move tree).

## Acceptance criteria

- [x] `write-loop-test-inventory.test.ts` fails against the pre-fix tree where the file does not exist.
- [x] `write-loop-test-inventory.test.ts` passes with all merge-base `write-loop.test.ts` leaf titles present in owned destinations (single-file pre-move tree included).
- [x] `bun run typecheck` passes.

## Documentation updates

None — inventory header documents the guard (same as resume inventory).
