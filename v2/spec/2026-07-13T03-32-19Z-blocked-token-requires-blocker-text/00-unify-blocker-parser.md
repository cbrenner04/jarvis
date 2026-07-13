# 00 - One `## Blocker` parser

## Problem

`extractBlockerSection` (`v2/src/execution/write.ts:100`) is a verbatim duplicate of the private
`extractBlockerBody` (`shared/spec-parser.ts:110`) — same exact-heading match, same empty-body
rule. Subspec 01 adds a third call site; land the unification first so the new contract is built on
one definition.

## Behavior

Behavior-preserving. `shared/spec-parser.ts` exports the parser; `write.ts` imports it and deletes
its copy. No caller's observable behavior changes.

## Decisions

- `shared/spec-parser.ts` is the canonical home and `write.ts`'s copy is deleted — `shared/**` is
  the version-agnostic home per the repo layout rules, and `shared/**` must not import from
  `v2/**`; rules out keeping the v2 copy, which would force a forbidden import direction.

## Acceptance criteria

- [ ] A single exported `## Blocker` parser lives in `shared/spec-parser.ts`; `v2/src/execution/write.ts`
      has no local copy and imports it (`hasGenuineBlocker` and `parseSpec`/`detectBlocker`/
      `stripBlockerSection` all resolve to that one definition).
- [ ] `spec-parser` and `write` test suites stay green (behavior unchanged by the extraction).
- [ ] Plan-draft's `plan.draft.blocker` gate stays green (behavior unchanged by the extraction).

## Documentation updates

None — internal deduplication with no behavior, prompt, or operator-facing change.

## Blocker

Code change is done: `extractBlockerBody` exported from `shared/spec-parser.ts`, `write.ts`'s
duplicate deleted, `hasGenuineBlocker` now calls the shared export. But every Bash invocation in
this session — including a bare `true` — fails with E2BIG (sandbox command line exceeds the OS
exec argument limit from ~198 registered git-worktree deny-paths), and bypassing the sandbox is
also blocked ("Run outside of the sandbox"). I cannot run `bun run typecheck` or the test suites to
verify the acceptance criteria. This requires operator action outside this session: prune stale git
worktrees (`git worktree remove` / `git worktree prune`) and restart, or relax the sandbox via
`/sandbox`.
