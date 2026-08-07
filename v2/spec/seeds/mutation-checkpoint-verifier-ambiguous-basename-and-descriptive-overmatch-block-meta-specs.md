---
name: mutation-checkpoint-verifier-ambiguous-basename-and-descriptive-overmatch-block-meta-specs
---

# Mutation-checkpoint verifier blocks a spec whose subject is mutation-checkpoint tooling: ambiguous-basename pinning refs and descriptive criteria mis-parsed as checkpoints

## Problem

Two verifier behaviors combine to hard-block (`contract_miss`, `unresolved_pinning_test`, `resumable:false`) any spec *about* mutation-checkpoint authoring, even with a correct implementation:

1. **Ambiguous basename → `unresolved_pinning_test`.** A criterion references its pinning file by bare basename (`` `write.test.ts` ``). Two files share that basename (`v2/src/execution/write.test.ts`, `v2/src/commands/write.test.ts`), so `resolvePinningTestPath` cannot disambiguate and the checkpoint is reported unparseable. Extension tolerance (#2696) does not cover same-basename-different-dir collisions.
2. **Descriptive criteria over-matched as checkpoints.** `selectMutationCheckpointCriteria` flags *any* AC block containing `@mutate` / `Mutation checkpoint:` / `Keystone checkpoint:` substrings. A spec that *documents* those tokens as feature content (e.g. "drives `contract_miss` on a subspec with a directive-shaped `@mutate` criterion") is treated as an actual checkpoint and put through pinning resolution it was never meant to satisfy.

Net: the implement run committed correct, fully-tested code (mutation pin hand-verified to redden; subagent review sound; 256 tests green) but settled `blocked/contract_miss` on four criteria — one real checkpoint plus three descriptive criteria — all reporting `unresolved_pinning_test`. Not resumable; the criteria text is the immovable trigger. Operator hand-published.

## Evidence

- 2026-08-07: `20260807T145131Z-plan-draft-must-validate-mutation-criterion-names-enclosing-test` implement (`9759dece`) → `contract_miss` `failedContractId: spec.criteria-ticked`, `failureReason: "Unparseable mutation checkpoints"` listing 4 criteria, each `reason: unresolved_pinning_test`, `reference: write.test.ts`. Three of the four are ordinary functional AC that merely mention `@mutate`/`Keystone checkpoint:`/`` `write.test.ts` `` as feature description.

## Decisions

- Pinning resolution MUST disambiguate a basename that matches multiple on-disk files instead of failing `unresolved_pinning_test` — prefer the copy under the run's touched surface, else report the specific ambiguity (candidate paths) so authoring can path-qualify. Path-qualified references (`v2/src/execution/write.test.ts`) must always resolve.
- Checkpoint selection MUST NOT treat a criterion as a mutation/keystone checkpoint solely because it contains the token as descriptive content — require the checkpoint shape (leading `Mutation checkpoint:` / `Keystone checkpoint:` prefix, or a real `// @mutate <path> "x" -> "y"` directive), not a bare substring match, so functional AC describing checkpoint tooling are not gated.
- Preserve current gating for genuine checkpoints — this narrows false positives only.

## Acceptance criteria

- [ ] A criterion whose pinning reference is a basename matching >1 on-disk file resolves (to the touched-surface copy) or fails with a distinct ambiguous-basename diagnostic naming the candidates — not a generic `unresolved_pinning_test`; a regression drives the two-`write.test.ts` case.
- [ ] A functional acceptance criterion that mentions `@mutate` / `Mutation checkpoint:` / `Keystone checkpoint:` only as descriptive prose (no checkpoint prefix, no real `// @mutate` directive) is NOT selected as a checkpoint; a regression pins a spec whose AC document checkpoint tooling and asserts no `contract_miss`.
- [ ] Mutation checkpoint: in the named regression, a `// @mutate` directive inverting the selection/resolution guard turns that regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — path-qualify pinning references when the basename is ambiguous; the verifier no longer flags descriptive criteria.
- `v1/docs/spec-guidance.md` § Mutation-checkpoint criteria — reference the pinning file by repo-relative path when its basename is not unique.
