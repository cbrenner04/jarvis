---
name: retire-claude-pool-contention-folklore
---

# Retire the Claude pool-contention warning, which rests on a measurement error

## Problem

`v1/src/modes/patch/pool-contention.ts` emits, and the v1 runbook documents:

```text
warning: selected patch primary shares Claude pool with a live Jarvis operator/orchestration session. Pause the competing session to avoid contention.
```

The observation it was built on was a missing measurement, not contention. Before claude was spawned with `--output-format stream-json --verbose`, **33 of 33** claude patch records carried `last_output_age_ms: null` — the idle-output watchdog was structurally blind to claude, so a working agent looked stalled. That produced two wrong diagnoses ("claude-haiku stalls to zero-output iteration-timeout", "claude-sonnet-5 is too slow for patch primary") and this warning. The contradicting evidence is direct: concurrent claude plan runs completed cleanly *during* the "stalled" patch run.

Cost today is behavioral, not cosmetic. The warning tells the operator to **pause a live session** — the opposite of the measured guidance, which is that lane count is not the ceiling (2026-09-06: seven concurrent lanes, load 6-21, zero watchdog false-kills). Acting on it throws away throughput to avoid a problem that does not exist.

## History

Originally a ready-intent under this name, lost in a bulk backlog purge without shipping. Re-seeded 2026-09-07 after a runbook audit found the citation dangling; re-verified against `main` — `pool-contention.ts:100` still emits the warning and the v1 runbook section still stands.

## Decisions

- The pool-contention warning and its detection are removed rather than reworded; rules out keeping a softened version of a claim with no supporting measurement.
- v1's claude adapter is left otherwise unchanged (maintenance-only engine); this seed removes a warning, it does not port v2's streaming flags to v1; rules out scope creep into v1 invocation behavior.
- The v1 runbook's **Shared model pool contention warning** section is deleted in the same change, along with the v2 runbook's pointer to this seed; rules out documentation outliving the code path.
- Real saturation guidance stays and is cross-linked: the ceilings that exist are gate-shaped (a `shared/**` gate cannot share the machine; load can manufacture `ready_gate_out_of_scope`), not pool-shaped; rules out deleting the warning and leaving no guidance on genuine contention.

## Acceptance criteria

- [ ] `v1/src/modes/patch/pool-contention.ts` and its detection call sites are removed; a test proves a patch run selecting a claude primary alongside a live session emits no pool-contention warning; it fails against the current emission.
- [ ] A guard test proves the warning string has zero occurrences in production source under `v1/` and `v2/`.
- [ ] `v1/docs/operator-runbook.md` no longer contains the **Shared model pool contention warning** section, and `v2/docs/operator-runbook.md` no longer points at this seed.
- [ ] `bun run typecheck`, `bun run test:v1`, and `bun run test:integration:v1` pass.

## Documentation updates

- `v1/docs/operator-runbook.md` — delete the section; cross-link the measured gate-shaped ceilings instead.
- `v2/docs/operator-runbook.md` — retire the pointer in § Choosing an actuator.
