# 00 - Memory watermark reader and config

A `start` admission decision needs a free-memory reading and a configurable
floor. This slice adds the reader and config only; no admission wiring yet.

## Decisions

- Floor lives in the per-machine config file (`~/.jarvis/v2.json`, read via
  `v2/src/config/machine-config-loader.ts`), not per-project — memory is a
  machine property, matching the existing `agents` key's per-machine scope.
- Config shape: `memory.minFreeGb: number` (floor as an absolute GB amount) —
  rules out a percentage-of-total form, since the architecture doc's driving
  example ("keep N GB free") is absolute and a personal machine's total RAM is
  stable enough that a GB floor is simpler to reason about than a percentage.
- Unset `memory.minFreeGb` (or absent `memory` key) means no gating — headroom
  checks always pass — preserving today's ungated `start` behavior for the
  solo operator who hasn't opted in yet.
- `minFreeGb` must be a positive finite number when present; validate at load
  time (same style as `validateMachineConfigAgents`), throwing on `0`,
  negative, or non-numeric values.
- The free-memory reader wraps `os.freemem()` behind an injectable function
  parameter (default `os.freemem`) so callers and tests can supply a fake
  reading — rules out reading `os.freemem()` inline at every call site, which
  would make admission logic untestable without mocking global state.
- Deferred to first consumer: percentage-of-total floor variant, and a
  max-count safety backstop on top of the memory gate — pin either when a
  caller needs it.

## Task checklist

- [ ] Add `memory.minFreeGb` support to `machine-config-loader.ts`: parse and
      validate when the `memory` key is present.
- [ ] Add a `hasMemoryHeadroom(configPath?, freeMemReader?)` function (or
      equivalent) in a new module under `v2/src/daemon/` or `v2/src/config/`
      that reads the configured floor and reports whether current free memory
      clears it; returns `true` when unconfigured.

## Acceptance criteria

- [ ] `hasMemoryHeadroom` returns `true` when `memory.minFreeGb` is unset,
      regardless of the injected reader's value.
- [ ] `hasMemoryHeadroom` returns `false` when the injected free-memory reader
      reports less than the configured `minFreeGb` (converted to bytes), and
      `true` when it reports at or above it.
- [ ] Loading a machine config with `memory.minFreeGb` set to `0`, a negative
      number, or a non-numeric value throws, matching the existing
      `validateMachineConfigAgents` error style.

## Documentation updates

- Add a "Memory watermark" section to `v2/docs/daemon-host.md` documenting the
  `memory.minFreeGb` config key, its unset-means-ungated default, and the
  injectable-reader shape (link forward to admission wiring landing in
  01/02).
