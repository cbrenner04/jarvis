# Diff-derived mutation gate has no escape hatch for provably-equivalent mutations

## Problem

The diff-derived mutation verifier blocks (`surviving_mutation_failed`) whenever a mutated changed guard leaves every co-located test green. For most guards a green result means missing coverage. But some mutations are **equivalent** — they cannot change observable behavior, so no test can kill them — and the gate has no way to accept them. It strands correct implements with no recovery: you cannot add a killing test (the mutation is behavior-neutral), and there is no annotation, allowlist, or config to mark a site equivalent. The only escape is deleting or restructuring the code until the operator/flip candidate disappears.

Common equivalent-mutation shapes seen in real implements:

- **Loop bounds:** `while (++i < n && depth > 0)` — flipping `depth > 0` to `depth <= 0` makes the loop skip, but for realistic inputs the downstream output is identical (the un-processed remainder is not observable through the tested surface).
- **Redundant guards:** `if (chars[i] === "<" && isLt(i))` where `isLt(i)` already implies `chars[i] === "<"` — the `===` is a flip candidate but flipping it cannot change the branch outcome.

## Evidence (2026-08-30)

The `mutation-verifier-masks-type-generic-brackets` fix (a comparison-heavy angle-bracket masking loop) stranded its implement three times: the agent's own `write.mutation-repair` arm burned 3 iterations and could not kill the surviving `operator-flip: === → !==`. Hand-inspection removed two genuinely-redundant guards, but a third surviving mutation (`operator-flip: > → <=` on the `depth > 0` loop bound at `diff-derived-mutation-verifier.ts:246`) is behavior-neutral for every realistic fixture and could not be killed. The fix is correct and behavior-tested (type-generics yield no candidate) but is not landable through the gate. Its pipeline PRs (#3164/#3166/#3169) were closed unlanded. This is distinct from the co-location gap (fixed in #3172) and the type-generic false-positive (which `mutation-verifier-masks-type-generic-brackets` itself fixes): here the verifier is correct that no test kills the mutation, but the mutation is one no test *can* kill.

## Decisions

- Add an explicit, auditable escape hatch for a specific `(file, line, mutation)` site: a directive the operator/agent places at the mutation site (for example a `// mutation-equivalent: <reason>` comment on the guard line) that the verifier reads and treats as a covered/accepted candidate for that exact site and mutation string only. Rules out a blanket per-file disable or a global gate off-switch.
- The directive must name the mutation it accepts (the `operator-flip: X → Y` / `guard-flip` string) so it accepts only the proven-equivalent transform, not every mutation at that line. Rules out silencing real coverage gaps at the same site.
- Prefer restructuring over annotation where cheap (extract a redundant guard so no flip candidate exists) — the escape hatch is for genuinely-irreducible equivalents (loop bounds), not a substitute for coverage. Document that ordering. Rules out the hatch becoming the default response to any surviving mutation.
- Record accepted sites in the run log so an escape-hatch use is visible in `jarvis run log` and reviewable in the PR diff. Rules out silent acceptance.

## Acceptance criteria

- [ ] A verifier unit test proves a changed guard line carrying the accept-directive for its exact mutation string yields NO `surviving_mutation_failed` for that mutation, while a different mutation at the same line (or the same directive naming a different mutation) still surfaces; it fails against the pre-fix verifier, which blocks regardless.
- [ ] A verifier unit test proves the directive is scoped to the exact `(file, line, mutation)` — it does not suppress the same mutation string on a different line.
- [ ] `jarvis run log` records an accepted-equivalent-mutation event naming the site and mutation.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — completion-verification paragraph: the accept-directive for provably-equivalent mutations, its exact-site scoping, and the "restructure first" guidance.
- `v2/docs/operator-runbook.md` — recovery note: when a surviving mutation is a genuine equivalent (loop bound, redundant guard), restructure to remove the candidate or apply the accept-directive with a reason; do not add a vacuous test.
