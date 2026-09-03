# Document handler module map

## Problem

After handler extraction, `v2/docs/daemon-host.md` still points operators and agents at monolithic `daemon.ts` handler implementations, obscuring where run-control RPC behavior lives.

## Decision ledger

- `daemon-host.md` owns the cross-file handler module map; rules out duplicating the map in `test-writing.md` or inline module headers.
- Map entries list module path, RPC methods owned, and primary deps/context inputs; rules out a narrative re-description of RPC contracts already in the transport table.
- No RPC contract edits; rules out behavior documentation changes beyond relocated source paths.

## Task checklist

- [ ] Add a "Run-control handler modules" section to `daemon-host.md` mapping `daemon-run-control-context.ts`, `daemon-run-lifecycle-handlers.ts`, `daemon-workflow-admission-handlers.ts`, and `daemon-pipeline-handlers.ts` to their RPC families and shared context seam.
- [ ] Update existing `daemon-host.md` prose that cites inline `daemon.ts` handler function names to cite the owning module where behavior moved.

## Acceptance criteria

- [x] `v2/docs/daemon-host.md` contains a run-control handler module map covering context, lifecycle, workflow-admission, and pipeline modules with RPC family boundaries.

## Documentation updates

- `v2/docs/daemon-host.md` — handler module map and relocated source citations.
