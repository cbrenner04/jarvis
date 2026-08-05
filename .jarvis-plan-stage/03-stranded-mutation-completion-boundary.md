# Stranded mutation completion boundary

## Problem

- `git add -A` at completion can ship stranded mutation replacements when verification aborts abnormally.
- Working-copy-only checks miss mutations already staged or committed in `HEAD`.
- Operator guidance cites `SIGKILL` as the only stranding case; any abnormal verification settle can strand a replacement.

## Decisions

- Before completion commit, refuse when staged or committed content contains a linked directive's replacement text while the original is absent — rules out `git add -A` shipping stranded mutations and rules out working-copy-only comparison.
- Name the refusal with target path and directive coordinates — rules out silent completion.
- Replace the `SIGKILL`-only stranded-mutation caveat in gate-trust docs with completion-boundary refusal — rules out implying only hard kills strand mutations.
- Read directive inventory from the same verifier linkage used at the write boundary — rules out a divergent scan heuristic.

## Tasks

- Add a pre-commit stranded-mutation check on the completion path (`completion-commit.ts` and/or its caller) reading staged/committed content.
- Refuse completion with named path and directive when replacement survives without original.
- Add regressions: stranded replacement in the working tree blocked at commit; stranded replacement present in `HEAD` but absent from the working copy also blocked.
- Add a mutation-checkpoint pin whose directive removes the stranded-mutation guard.
- Update `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet with the full post-cluster behavior.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `completion-commit.test.ts` (or `write-loop.test.ts` if wired there) — `stranded replacement in staged content refuses completion` proves the completion boundary refuses when a target file contains a directive's replacement text while missing its original, naming path and directive; it fails against the current committer.
- [ ] `completion-commit.test.ts` (or `write-loop.test.ts`) — `stranded replacement in HEAD refuses even when working copy is clean` proves a mutation present in `HEAD` but absent from the working copy is still refused; it fails against working-copy-only comparison.
- [ ] `write-loop.test.ts` or `completion-commit.test.ts` — Mutation checkpoint: its regression carries `// @mutate` removing the pre-commit stranded-mutation check; reverting that guard turns the named pin red.
- [ ] `v2/docs/operator-runbook.md` § Gate trust replaces the `SIGKILL`-only stranded-mutation caveat with completion-boundary refusal after any abnormal verification settle.
- [ ] `v2/docs/v1-behaviors.md` records narrowed selection, blocking unparseable/unresolved, path-qualified pinning, scoped verification abort/timeout, and stranded-mutation refusal at the completion boundary.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — stranded-mutation refusal at completion boundary.
- `v2/docs/v1-behaviors.md` — implement-write mutation-checkpoint verifier trust bullet.
