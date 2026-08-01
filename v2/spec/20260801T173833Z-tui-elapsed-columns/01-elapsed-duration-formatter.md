# Elapsed duration formatter

Pure wall-clock elapsed formatter sized to the tree `elapsed` column budget. No TUI wiring in this
slice — sibling [02](./02-tui-elapsed-columns-render-and-local-tick.md) consumes it.

## Problem

`jarvis tui` reserves an 8-column `elapsed` slot but has no formatter. Ad hoc duration strings risk
overflow, inconsistent ranges, and `0s` for unset starts.

## Decisions

- Export `formatElapsedWallClock(startMs: number | null, endMs: number | null, nowMs: number): string`
  — rules out per-call `Date.now()` inside the formatter.
- `startMs === null` → `""` — rules out `0s` for unset starts.
- Active rows (`endMs === null`) measure `nowMs - startMs`; terminal rows (`endMs !== null`) measure
  `endMs - startMs` and ignore `nowMs` — rules out terminal ages that keep climbing when `nowMs`
  advances.
- Negative or zero duration after clamping → `""` — rules out negative display.
- Ranges (inclusive lower bound, exclusive upper on the next tier): `<60s` → `Ns`; `<3600s` → `Nm Ss`;
  `<86400s` → `Nh Nm`; else `Nd Nh` — rules out `…` truncation.
- Day tier caps `d`/`h` components so every `Nd Nh` string is ≤ 8 code units (naive `100d 23h`-scale
  values must not reach `formatTreeCell`) — rules out ellipsis as a second truncation path in [02].
- Output width ≤ 8 code units for every tier (repo tree-cell convention) — rules out wider strings.
- Module colocated with `tui-elapsed-format.test.ts` under `v2/src/tui/` — rules out daemon or ink
  dependencies in the formatter.
- Tests inject fixed `nowMs`; no painted ink assertions (`v2/docs/test-writing.md` § TUI test
  strategy).

## Tasks

- Add `formatElapsedWallClock` and `tui-elapsed-format.test.ts` pinning all four ranges, boundary
  widths at `59s`/`60s`, `3599s`/`3600s`, `86399s`/`86400s`, `null` start, terminal freeze vs active
  tick, and max-width samples per tier.
- Add `Mutation checkpoint:` comments on pins for `null` start, terminal `endMs` freeze, each range
  boundary, and day-tier width cap.
- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `tui-elapsed-format.test.ts` — `formatElapsedWallClock covers sub-minute through multi-day ranges within the 8-column budget` fails against the pre-fix absent module and passes after implementation; pin boundary-pins `59s`/`60s`, `3599s`/`3600s`, and `86399s`/`86400s`.
- [ ] `tui-elapsed-format.test.ts` — `formatElapsedWallClock never exceeds the 8-column budget` fails pre-fix and passes after implementation; pin max-width samples per tier (`59s`, `59m 59s`, `23h 59m`, and a day-tier duration that would naively overflow, e.g. `100d 23h`) and asserts every output length ≤ 8 code units.
- [ ] `tui-elapsed-format.test.ts` — `formatElapsedWallClock returns empty string when startMs is null` fails pre-fix and passes after implementation.
- [ ] `tui-elapsed-format.test.ts` — `formatElapsedWallClock freezes terminal elapsed when endMs is set` fails pre-fix and passes after implementation; advancing `nowMs` leaves the formatted string unchanged.
- [ ] `tui-elapsed-format.test.ts` — `Mutation checkpoint:` comments name guard-inversion mutations for `null` start, terminal freeze, each range boundary, and day-tier width cap; inverting each named guard turns the corresponding pin RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — internal pure function; operator semantics ship in [02](./02-tui-elapsed-columns-render-and-local-tick.md).
