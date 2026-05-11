# Rule File Reference Cleanup

Remove stale references to deleted root-level rule docs. Harness-owned rules
now live under `rules/` and are injected inline by the prompt builder.

## Tasks

- [x] Remove stale test references to deleted root-level rule docs.
- [x] Update specs that still described target-repo rule scaffolding.
- [x] Verify no exact references to the deleted root-level rule docs remain.

## Documentation updates

- Historical specs now describe the current register-only init behavior and
  harness-owned rule location.
