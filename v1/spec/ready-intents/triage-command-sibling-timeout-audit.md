---
name: triage-command-sibling-timeout-audit
---

# Sibling `triage-command.test.ts` merge tests have timeout headroom under load

## Behavior

Subprocess- or poll-heavy `--merge flag` cases in `v1/test/triage-command.test.ts`
besides `--merge classifies all spec check statuses correctly` are audited for
marginal per-test timeout headroom; any whose standalone runtime sits within ~1.5×
of their timeout get a per-test bump so parallel-load slowdown cannot tip them.

## Decisions

- Audit only `triage-command.test.ts` cases that spawn subprocesses or poll — rules out repo-wide timeout sweeps.
- Bump marginal cases via per-test `{ timeout: <ms> }` overrides, not global default changes — rules out raising the suite-wide bound for one file's outliers.
- Cases already well below their timeout are left unchanged — rules out blanket timeout inflation.
- Do not paper over via suite serialization or `sandbox-unrunnable` — rules out masking correct code with runner workarounds.

## Out of scope

- `triage --merge` runtime behavior or ready-gate policy changes.
- Broader test-suite parallelism tuning.

## Documentation updates

- None unless the audit surfaces a repeatable headroom convention worth noting where test conventions live.

## Prerequisites

- The `--merge classifies all spec check statuses correctly` test passes under full-suite parallel gate (`bun run test`).
