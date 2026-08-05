# Stranded mutation completion boundary

## Problem

- `git add -A` at completion can ship stranded mutation replacements when verification aborts abnormally.
- Working-copy-only checks miss mutations already staged or committed in `HEAD`.
- Operator guidance cites `SIGKILL` as the only stranding case; any abnormal verification settle can strand a replacement.

## Decisions

- After `git add -A` into the completion temp index, refuse when **staged** blob content (and `HEAD` for the HEAD regression) shows a directive's replacement text while the original is absent — rules out working-copy-only comparison and rules out `git add -A` shipping stranded mutations.
- Scope refusal to directives **applied during the current write-step `verifyMutationCheckpoints` run and not confirmed restored** — rules out false positives when a legitimate implementation intentionally lands replacement text after clean verification and restore.
- Name the refusal with target path and directive coordinates — rules out silent completion.
- This is **pre-commit completion refusal** (`contract_miss` on the completion path), distinct from `surviving_mutation_failed` at ready finalization — rules out conflating the two failure taxonomies.
- Build the directive inventory from the same verifier linkage path as the write boundary (re-parse active subspec / linked directives) — rules out a divergent scan heuristic.
- Replace the `SIGKILL`-only stranded-mutation caveat in gate-trust docs with completion-boundary refusal — rules out implying only hard kills strand mutations.

## Tasks

- Add a stranded-mutation check on the completion path (`completion-commit.ts` and/or its caller) after `git add -A` into the temp index, reading staged blob content (and `HEAD` for the second regression).
- Refuse completion with named path and directive when a verify-run directive's replacement survives without its original in staged/committed content.
- Add regressions in `completion-commit.test.ts`: stranded replacement in staged content; stranded replacement present in `HEAD` but absent from the working copy.
- Add a mutation-checkpoint pin whose directive removes the stranded-mutation guard.
- Update `v2/docs/v1-behaviors.md` implement-write mutation-checkpoint bullet with the full post-cluster behavior.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `completion-commit.test.ts` — `stranded replacement in staged content refuses completion` proves the completion boundary refuses when staged content contains a verify-run directive's replacement text while missing its original, naming path and directive; it fails against the current committer.
- [ ] `completion-commit.test.ts` — `stranded replacement in HEAD refuses even when working copy is clean` proves a verify-run mutation present in `HEAD` but absent from the working copy is still refused; it fails against working-copy-only comparison.
- [ ] `completion-commit.test.ts` — `stranded replacement in staged content refuses completion`; Mutation checkpoint: its regression carries `// @mutate` removing the pre-commit stranded-mutation check; reverting that guard turns the named pin red.
- [ ] `v2/docs/operator-runbook.md` § Gate trust replaces the `SIGKILL`-only stranded-mutation caveat with verify-run-scoped completion-boundary refusal after any abnormal verification settle.
- [ ] `v2/docs/v1-behaviors.md` records narrowed selection, blocking unparseable/unresolved, path-qualified pinning, scoped verification abort/timeout, and stranded-mutation refusal at the completion boundary.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — verify-run-scoped stranded-mutation refusal at completion boundary.
- `v2/docs/v1-behaviors.md` — implement-write mutation-checkpoint verifier trust bullet.
