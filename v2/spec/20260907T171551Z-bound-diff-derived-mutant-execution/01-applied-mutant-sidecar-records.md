# Applied-mutant sidecar records

## Problem

When a verifier child wedges or an operator inspects a live worktree mid-verification, an inverted production guard is indistinguishable from agent-authored corruption because nothing on disk records that the harness applied a mutant.

## Decision ledger

- Record each applied mutant atomically in `<worktree>/.jarvis-diff-derived-mutations/<candidate-sha256>.json` before mutating disk, containing `file`, `line`, and `mutation` text; rules out operators mistaking unrestored guards for agent edits.
- Remove each sidecar entry only by its owning candidate after restore completes; rules out one candidate clearing another's in-flight record while distinct production files run killing tests concurrently.
- Derive `<candidate-sha256>` deterministically from candidate identity (file, line, column span, mutation string); rules out collision-prone sequential filenames.

## Prerequisites

- Subspec 00 lands `testCandidate` restore-on-every-path semantics.

## Task checklist

- Add sidecar write (atomic rename) immediately before applying a mutant in `testCandidate`.
- Remove the sidecar in the same restore path that rewrites production bytes.
- Ensure concurrent candidates on different production files retain separate discoverable entries for the duration of their scoped tests.
- Add `diff-derived-mutation-verifier.test.ts` regression covering concurrent production-file candidates.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` proves each concurrent production-file candidate has a separately discoverable `<worktree>/.jarvis-diff-derived-mutations/<candidate-sha256>.json` entry identifying `file`, `line`, and `mutation` while applied, and that its owner clears the entry on restore; it fails against the pre-fix absent record reachable when `testCandidate` applies mutants without sidecar I/O.
- [ ] `bun run test:v2` passes.

## Documentation updates

- Deferred to subspec 04.
