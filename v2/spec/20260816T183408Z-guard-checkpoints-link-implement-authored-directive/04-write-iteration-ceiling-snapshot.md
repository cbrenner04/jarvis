# Workflow snapshots preserve the write iteration ceiling

## Problem

Workflow snapshots omit the authored `maxIterations`, so resume can replace an explicit ceiling with a default and cannot distinguish legacy absence from an authored default.

## Behavior

Snapshots normalize and round-trip the write ceiling. Absent legacy values use the default; an explicit default remains authored. Redispatch persists a changed authored ceiling. Invalid persisted values refuse resume as unsupported snapshot context, and snapshot comparison and reconstruction apply the same validation.

## Decision ledger

- Persist the normalized authored ceiling in workflow snapshots — rules out substituting a default during reconstruction.
- Preserve absent-versus-explicit-default semantics — rules out treating old snapshots as authored configuration.
- Recompute the normalized snapshot value on redispatch — rules out retaining a stale ceiling after an authored step changes.
- Refuse invalid persisted ceilings as unsupported snapshot context in both comparison and reconstruction — rules out divergent recovery or an accidental extra budget.

## Tasks

- [ ] Carry normalized `maxIterations` through workflow snapshot creation, equality, storage, redispatch, and reconstruction.
- [ ] Cover absence, explicit default, authored ceiling changes on redispatch, invalid persisted values, and legacy fallback.

## Acceptance criteria

- [ ] `workflow snapshot preserves normalized write iteration ceiling` in `v2/src/daemon/daemon-resume.test.ts` fails against pre-fix omission and distinguishes an absent legacy value from an explicit default while reconstructing the authored ceiling.
- [ ] `redispatch updates the persisted write iteration ceiling` in `v2/src/daemon/daemon-resume.test.ts` proves an authored ceiling change replaces the prior normalized snapshot value.
- [ ] `invalid persisted write iteration ceilings refuse resume consistently` in `v2/src/daemon/daemon-resume.test.ts` proves snapshot equality and daemon reconstruction reject the same invalid value as unsupported snapshot context, while legacy absence retains the default.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `workflow snapshot preserves normalized write iteration ceiling`; Keystone checkpoint: dropping the normalized snapshot ceiling turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `redispatch updates the persisted write iteration ceiling`; Mutation checkpoint: inverting redispatch replacement turns this pin red.
- [ ] `v2/src/daemon/daemon-resume.test.ts` — `invalid persisted write iteration ceilings refuse resume consistently`; Mutation checkpoint: inverting shared validation or legacy fallback turns this pin red.
- [ ] Every added or modified snapshot, redispatch, validation, or legacy-fallback guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.

## Documentation updates

- None; resume-budget continuity is documented in subspec 05.
