# Cleanup archives each spec to the home matching what it changed

repo: cbrenner04/jarvis

`jarvis cleanup` archives every completed spec into `<configured targetDir>/completed/`, so after the
route-by-target flip (`targetDir: v1/spec`) v2 specs are missed and the operator hand-moves trees by the
runbook stopgap. Route archival by the spec's authored home — the same declared-target signal authoring
uses: a spec living under `v1/spec/` archives to `v1/spec/completed/`, under `v2/spec/` to
`v2/spec/completed/`. Mixed v1/v2 is satisfied transitively (route-by-target authored it under `v1/spec/`).
Drop the manual relocation from `operator-runbook.md`.

- [x] [00 - Archive by authored home](./00-archive-by-authored-home.md)
