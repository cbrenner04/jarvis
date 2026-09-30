# 00 — Full UUID bypass on degraded listing

## Problem

After daemon self-handoff, `pipeline list` can stay `degraded` while predecessor rows are omitted from the merge. `resolvePipelineIdAcrossDaemons` only treats an argument as an exact id when `ids.includes(argument)`; any other argument of at least `PIPELINE_ID_PREFIX_MIN_LENGTH` characters hits the malformed/unavailable/degraded branch and refuses `pipeline_id_set_incomplete` before any verb RPC — including production hyphenated UUIDs the operator copied from an earlier listing. That contradicts operator docs that degraded listings still accept stable full ids.

## Decisions

- Full-id bypass applies only when the argument matches a standard hyphenated UUID (8-4-4-4-12 hex, case-insensitive); rules out treating every long opaque string as a full id.
- Short non-UUID fixture ids in `pipeline-daemon-resolution.test.ts` keep existing listing membership and prefix rules; rules out widening bypass to arbitrary ≥8-character tokens.
- A matching full UUID bypasses listing membership and prefix resolution before the `listing.snapshots === undefined || listing.degraded` branch; the resolver returns `{ kind: "unmatched", pipelineId: argument }` so the verb RPC receives the id verbatim and refuses `unknown_pipeline` when absent; rules out returning `incomplete` for full UUIDs on degraded listings.
- Prefix resolution when the stable listing is malformed, unavailable, or `degraded` still refuses `pipeline_id_set_incomplete` before any verb RPC; rules out allowing prefix resolution on incomplete listings.
- Predicate lives beside `resolvePipelineIdAcrossDaemons` in `v2/src/daemon/pipeline-daemon-resolution.ts` unless an existing shared helper already matches; rules out a new cross-package abstraction for one call site.
- `withStablePipelineClient` adds no admission logic beyond the resolver; a resolver unit test satisfies CLI admission unless a future seam appears; rules out a mandatory duplicate `pipeline.test.ts` case when the resolver test already fails against pre-fix.

## Tasks

- [ ] Add a hyphenated-UUID predicate and an early pass-through in `resolvePipelineIdAcrossDaemons` after exact listing membership and sub-prefix-length checks, before the incomplete-listing branch.
- [ ] Add `pipeline-daemon-resolution.test.ts` coverage: degraded listing omits the target id; a hyphenated full UUID argument is returned as `unmatched` with the same `pipelineId` for the verb RPC.
- [ ] Extend `pipeline.test.ts` only when the resolver case does not exercise the same admission seam as `withStablePipelineClient`.
- [ ] Align the `resolvePipelineIdAcrossDaemons` doc-comment with the bypass.
- [ ] Update operator and parity docs per ## Documentation updates.

## Acceptance criteria

- [ ] `pipeline-daemon-resolution.test.ts` proves a degraded listing that omits the target still passes a hyphenated full UUID through as `unmatched` with the same `pipelineId`; fails against the pre-fix code (reachable on main: full UUIDs absent from a degraded merge currently return `incomplete` — see `resolvePipelineIdAcrossDaemons` after `ids.includes`).
- [ ] `pipeline-daemon-resolution.test.ts` (`a degraded listing refuses a prefix even when a same-prefix local id exists`) stays green.
- [ ] `pipeline.test.ts` (`reports incomplete id sets before any verb RPC`) stays green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Stable-address pipeline control verbs: hyphenated full UUID arguments bypass listing membership when the id is absent from a degraded or incomplete merge (predecessor omission); prefix resolution still requires a complete healthy listing; exact ids present in the listing remain usable as today.
- `v2/docs/v1-behaviors.md` — pipeline control identity entry (`resolvePipelineIdAcrossDaemons`): full hyphenated UUID arguments bypass listing-membership gating for malformed/unavailable/degraded listings; prefix rules unchanged.
