# Classify terminal untouched-path gate failures

## Problem

Terminal ready-step evidence can name red test files, but classification must be conservative when
either evidence or the run's touched set is ambiguous.

## Decision ledger

- Use `ready_gate_out_of_scope` only as a path-ownership heuristic: it says complete terminal
  evidence lies outside the allowed set, not that a run caused or did not cause a failure.
- Select records only from the final failed ready step and its final test attempt. Missing,
  malformed, stale, or partial boundaries/records remain `ready_gate_failed`.
- Validate each attributed path as a nonempty normalized repo-relative path. Reject absolute,
  escaping, malformed, or normalization-colliding records; deduplicate valid exact normalized paths
  in first-seen order — rules out accidental false attribution.
- Allowed paths are the normalized union of the spec-tree files and all base-to-HEAD changes plus
  untracked files. Derive git paths with NUL-safe parsing and include both sides of rename/copy and
  deletions — rules out newline, whitespace, rename, copy, and delete gaps.
- Fail closed as `ready_gate_failed` if base diff, untracked inventory, status/path parsing,
  normalization, or spec-tree enumeration cannot be resolved completely.
- Classify only complete, validated terminal test evidence whose every path is outside the allowed
  set. A successful, mixed, deadline-killed, non-test, `requiredIntegrationScope`, or otherwise
  unattributed gate remains on its existing outcome. `requiredIntegrationScope` has no equally
  complete terminal file attribution and is therefore never eligible.

## Task checklist

- Parse and validate terminal ready-step failure records into `ReadyGateError`.
- Derive the fail-closed allowed set from base-relative git changes, untracked paths, and spec tree.
- Classify only complete terminal evidence outside that set.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` adds pre-fix-failing coverage that fully attributed
      terminal test failures outside the base diff plus spec tree become `ready_gate_out_of_scope`
      with normalized outside paths, while mixed, absent, malformed, stale-retry, later-non-test, or
      partial attribution remains `ready_gate_failed`.
- [ ] The same test proves path validation and scope derivation fail closed for absolute, escaping,
      colliding, whitespace/newline unusual names, untracked paths, rename/copy/delete paths,
      normalization failures, and unavailable diff or inventory input.
- [ ] The same test proves successful, deadline-killed, and `requiredIntegrationScope` failures are
      not misclassified; inverting terminal-record parsing, complete-evidence validation,
      path validation, scope resolution, or all-paths-outside classification turns its corresponding
      test RED.

## Documentation updates

- `v2/docs/write-behavior.md` — terminal attribution contract, conservative fallback, path-ownership
  meaning, and `requiredIntegrationScope` exclusion.
