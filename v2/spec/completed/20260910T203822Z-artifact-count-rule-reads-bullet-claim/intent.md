---
name: artifact-count-rule-reads-bullet-claim
---

# The one-artifact-per-bullet rule counts artifacts a bullet builds, not paths it mentions

Unsplit rationale: the rule, its path counter, and its refusal message all live in the single plan-draft contract normalizer (`shared/module-boundary-surfaces.ts`), which `v2/src/execution/write.ts` consumes verbatim as the `contract_miss` reason — so there is exactly one module-boundary surface to change and no dependency ordering to express.

## Primary implementation surface

- `shared/module-boundary-surfaces.ts` (plan-draft contract normalizer: `assertSingleArtifactBullets`, `referencedArtifactPaths`)

## Problem

`assertSingleArtifactBullets` counts distinct backticked paths per bullet unconditionally, with no reading of what the bullet claims about them. Two well-formed bullet kinds are rejected: a stays-green regression AC naming two existing test files (creates nothing), and a `## Decisions` bullet naming every call site one decision governs. Both settle non-resumable `contract_miss` (`nextAction: inspect_spec`), costing a hand-landing on an otherwise complete draft. Two occurrences in one session: runs `b43f46d5` (#3680) and `06d7f3d4` (#3700).

## Decisions

- The artifact-count rule applies only to bullets asserting an artifact is created or changed; two exemptions, both read from bullet wording alone (never from which section the bullet sits in, so no section-context threading is needed): (a) a bullet asserting named existing artifacts stay unchanged (e.g. "X and Y stay green"), and (b) a bullet naming multiple call sites affected by one decision — the atomicity protected there is one decision per bullet, not one file per bullet.
- The refusal message distinguishes *builds/changes two artifacts* from *mentions two paths under an exemption* and names which reading was applied.

## Acceptance criteria

- [ ] A test proves an acceptance bullet asserting two named existing test files stay green passes the contract; it fails against the pre-fix unconditional path count.
- [ ] A test proves a `## Decisions` bullet naming two call sites governed by one decision passes the contract; it fails against the pre-fix rule.
- [ ] A test proves a bullet genuinely requiring two new artifacts is still rejected, with a message naming both and stating the reading applied.
- [ ] `shared/module-boundary-surfaces.test.ts` and `v2/src/execution/write.test.ts` stay green (contract_miss reason passthrough unchanged by this change).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — state what the one-artifact rule counts and what it exempts, with an example of each.
- `v2/docs/v1-behaviors.md` — record the changed contract behavior.

## Prerequisites
