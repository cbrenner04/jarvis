---
name: pipeline-verbs-accept-full-ids-on-degraded-listing
---

# Pipeline verbs accept full ids against a degraded listing

Unsplit rationale: One CLI-admission seam — stable-address id resolution in `resolvePipelineIdAcrossDaemons` before any verb RPC; `pipeline-daemon-resolution.test.ts` plus operator docs prove resolver behavior; extend `pipeline.test.ts` when the CLI path needs the same proof.

## Problem

After daemon self-handoff, `pipeline list` stays `degraded` for minutes. Full-UUID `pipeline approve|resume|dismiss` then refuses `pipeline_id_set_incomplete`, contradicting runbook wording that treats degraded listings as still accepting control ids. `resolvePipelineIdAcrossDaemons` only accepts an exact id when `ids.includes(argument)`; omitted predecessor rows make full UUIDs fall into the degraded prefix refusal even when the operator passes the stable address from `list`.

## Decisions

- Production pipeline ids are UUIDs. Bypass applies only when the argument matches the standard hyphenated UUID predicate (8-4-4-4-12 hex, case-insensitive); short non-UUID fixture ids in resolver tests keep existing listing/prefix rules. Such a full id bypasses listing membership and prefix resolution (including before the `snapshots === undefined || degraded` branch); the verb RPC refuses `unknown_pipeline` if absent.
- Prefix resolution against a malformed, unavailable, or degraded listing still refuses `pipeline_id_set_incomplete` before any verb RPC.

## Acceptance criteria

- [ ] `pipeline-daemon-resolution.test.ts` gains a case: degraded listing omits the target id but a hyphenated full UUID argument is returned unchanged for the verb RPC; fails against the pre-fix code. Extend `pipeline.test.ts` if the CLI admission path is not fully covered by that case.
- [ ] `pipeline-daemon-resolution.test.ts` (`a degraded listing refuses a prefix even when a same-prefix local id exists`, 2026-09-13 regression) stays green; extend only if prefix refusal moves seams.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Stable-address pipeline control verbs: replace “exact listed id” on degraded listings with full UUID bypass when the id is absent from the merge (predecessor omission); only prefixes need a complete healthy listing.
- `v2/docs/v1-behaviors.md` — pipeline control identity entry: full hyphenated UUID arguments bypass listing membership gating (degraded/malformed/unavailable); prefix rules unchanged.

## Prerequisites

## Primary implementation surface

- `v2/src/daemon/pipeline-daemon-resolution.ts`
