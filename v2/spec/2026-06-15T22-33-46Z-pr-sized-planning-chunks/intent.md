---
name: pr-sized-planning-chunks
---

## Raw seed

<<<RAW_SEED_BEGIN>>>
---
name: pr-sized-planning-chunks
---

**Scope.** This intent lives under `v2/spec/` for plan-mode routing only.
**Implementation is v1 harness work** — changes land in `prompts/**`,
`v1/**`, and docs. It does not target the v2 write loop or `v2/src/**`.
v2 should follow the documented planning behavior after v1 lands.

# PR-sized planning chunks

Recent v2 planning produced a single daemon/logging/run-control implementation
PR that was far too large to review confidently. The implementation did what
the spec asked; the failure was that the spec grouped a program area into one
review unit. The post-completion shrink step can remove bloat, but it cannot
make an oversized spec reviewable. Sizing has to happen during planning.

Change plan-mode guidance and prompts so generated subspecs are PR-sized
mergeable chunks, not commit-sized checklist items inside one giant spec PR.
The draft agent should use this constraint while shaping the spec. Review agents
should explicitly reject or request a split when a subspec is likely to produce
an oversized PR.

## Desired behavior

- A subspec represents one independently mergeable PR-sized implementation
  chunk.
- Planning should target reviewable PRs, not large feature bundles. Use roughly
  1000 changed lines including tests/docs as a hard reviewability warning, but
  do not put numeric line targets in implementation prompts.
- If a proposed subspec is likely to exceed that size, split it during planning
  by independently observable behavior.
- Prefer vertical slices that add one capability at a time over umbrella
  subspecs like "daemon host + IPC + logs + run control".
- Review agents must call out oversize subspecs before implementation starts.
- Intent drafting does not need this sizing rule yet; keep it in the draft and
  review planning surfaces.

## Evidence

The daemon-host/IPC/logging PR bundled socket lifecycle, protocol framing,
autostart, state-store changes, structured log storage, log streaming,
detached run scheduling, ownership, steering, shared child-process spawning,
docs, and tests. That should have been many specs/PRs. The bad outcome was not
that the implementation missed the spec; it was that the planning unit was too
large to trust.

## Documentation updates

- `v1/docs/spec-guidance.md`: subspecs are PR-sized merge units; split likely
  oversized subspecs before implementation.
- Plan prompt docs/templates as needed: draft agent uses PR sizing while
  decomposing; reviewer agents verify and push back on oversize chunks.
- `v2/docs/v1-behaviors.md`: document the v1 planning behavior that v2 should
  preserve/follow.

## Out of scope

- Do not add PR batching, stacked-PR automation, or anti-fatigue workflow yet.
  More PRs may create review fatigue, but the immediate fix is to make each PR
  reviewable.
- Do not enforce line counts in patch-mode implementation prompts.
- Do not re-plan v2 phase 3+ in this spec. After this lands, re-plan phase 3
  and beyond using the new sizing rule.

## Refine skip

Intent is complete: the scope is v1 planning guidance/prompts, the sizing rule
belongs in draft/review planning surfaces rather than intent or implementation,
and v2 replanning is explicitly follow-up work after this behavior lands.

<<<RAW_SEED_END>>>

## Intent

**Scope.** Lives under `v2/spec/` for plan-mode routing only. Implementation is
v1 harness work: changes land in `prompts/**`, `v1/**`, and docs — not the v2
write loop or `v2/src/**`. v2 follows the documented planning behavior once v1
lands.

# PR-sized planning chunks

A recent v2 planning run produced one daemon/logging/run-control PR too large to
review confidently. The implementation matched the spec; the failure was the
spec grouping a whole program area into a single review unit. The shrink step
removes bloat but cannot make an oversized spec reviewable — sizing has to
happen *during* planning.

Change plan-mode guidance and prompts so generated subspecs are PR-sized
mergeable chunks, not commit-sized checklist items inside one giant spec PR. The
draft agent applies this constraint while shaping the spec; review agents reject
or request a split when a subspec is likely to produce an oversized PR.

## Desired behavior

- A subspec = one independently mergeable, PR-sized implementation chunk.
- Plan toward reviewable PRs, not large feature bundles. Treat ~1000 changed
  lines (incl. tests/docs) as a hard reviewability warning, but keep numeric
  line targets out of implementation prompts.
- If a proposed subspec is likely to exceed that size, split it during planning
  along independently observable behavior.
- Prefer vertical slices that add one capability at a time over umbrella
  subspecs like "daemon host + IPC + logs + run control".
- Review agents must flag oversize subspecs before implementation starts.
- Intent drafting does not get this rule — it belongs only on the draft and
  review planning surfaces.

## Evidence

The daemon-host/IPC/logging PR bundled socket lifecycle, protocol framing,
autostart, state-store changes, structured log storage, log streaming, detached
run scheduling, ownership, steering, shared child-process spawning, docs, and
tests — many specs/PRs collapsed into one. The bad outcome wasn't a missed spec;
it was a planning unit too large to trust.

## Documentation updates

- `v1/docs/spec-guidance.md`: subspecs are PR-sized merge units; split likely
  oversized subspecs before implementation.
- Plan prompt docs/templates as needed: draft agent uses PR sizing while
  decomposing; reviewer agents verify and push back on oversize chunks.
- `v2/docs/v1-behaviors.md`: record the v1 planning behavior v2 should preserve.

## Out of scope

- No PR batching, stacked-PR automation, or anti-fatigue workflow yet. More PRs
  may create review fatigue, but the immediate fix is per-PR reviewability.
- No line-count enforcement in patch-mode implementation prompts.
- No re-plan of v2 phase 3+ here. Re-plan phase 3 and beyond with the new sizing
  rule after this lands.

## Refinement

- The ~1000-line threshold lives in `v1/docs/spec-guidance.md`; draft/review
  prompts reference the sizing rule without hardcoding the number — rules out
  baking `1000` into prompt text, which the plan-prompt coherence principle
  forbids and which would drift from the doc.
