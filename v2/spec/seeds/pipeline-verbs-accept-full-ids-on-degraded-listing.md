---
name: pipeline-verbs-accept-full-ids-on-degraded-listing
---

# Pipeline verbs accept full ids against a degraded listing

## Problem

After every `v2/src` merge the daemon self-handoff leaves `pipeline list` degraded for 2-6 min. In that window `jarvis pipeline approve|resume|dismiss <full-36-char-id>` refuses `pipeline_id_set_incomplete: Cannot resolve prefix <full id>`, contradicting `v2/docs/operator-runbook.md` § Stable-address pipeline control verbs ("Exact listed ids remain usable against a degraded listing"). Cause: `resolvePipelineIdAcrossDaemons` (`v2/src/daemon/pipeline-daemon-resolution.ts`, called from `v2/src/commands/pipeline.ts`) short-circuits an exact id only when it is present in the listing (`ids.includes(argument)`); a degraded or unavailable listing omits predecessor-owned pipelines, so any argument ≥ `PIPELINE_ID_PREFIX_MIN_LENGTH` that is absent falls through to the degraded/unavailable refusal before any verb RPC — full UUIDs included.

## Evidence

- 2026-09-30: `pipeline resume ebb385e7-6df7-45f8-b05e-5347475fa5fb` refused 11:18-11:24, then `pipeline_no_live_owner` once.
- 2026-09-30: `approve`/`resume` of `290a22ee-8c14-41ca-8b55-1a02aa081183` refused 11:26 and 11:29-11:31.
- `reports/20260930T110000Z-operator-structural-recovery.md` friction: `pipeline dismiss` of full id `bb738352` refused `pipeline_id_set_incomplete` persistently.

## Decisions

- A well-formed full pipeline id (UUID shape) bypasses prefix resolution entirely and goes straight to the verb RPC, which refuses `unknown_pipeline` itself; rules out gating full ids on listing membership.
- Prefix resolution against a malformed/unavailable/degraded listing still refuses `pipeline_id_set_incomplete`.

## Acceptance criteria

- [ ] A CLI test with a degraded listing that omits the target proves a full UUID argument reaches the verb RPC unchanged (fails against current code).
- [ ] A CLI test proves an 8+-char prefix against a degraded listing still refuses `pipeline_id_set_incomplete` before any verb RPC.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Stable-address pipeline control verbs: full UUIDs skip listing resolution; only prefixes need a healthy listing.
