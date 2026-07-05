# Extract `worktree_claimed` check into a standalone function

`v2/src/daemon/daemon.ts` repeats the same live-claim check (`if
(_registry.isClaimed(key)) return { kind: "error", code: "worktree_claimed",
... }`) inline in `start`, `resume`, and `revise` (lines ~536, ~852, ~729).
It has no unit coverage independent of a real IPC round trip.

## Decision

Extract the check into a standalone exported function taking the
`WorktreeOwnershipRegistry` and `OwnershipKey` as explicit parameters,
returning the same error-shaped result, or `undefined` when not claimed.
Call it from `start`, `resume`, and `revise` in place of the inline
`isClaimed` branch. No behavior change — same rejection, same message,
same `code`.

## Acceptance criteria

- [x] `daemon-registry.test.ts` and the `start` RPC-level `worktree_claimed`
      coverage in `daemon-start-list.test.ts` stay green (behavior
      unchanged by the extraction).
- [x] `resume` rejects with `worktree_claimed` at the RPC level when the
      target worktree is already claimed — new regression coverage, since
      no existing test asserts this today.
- [x] `revise` rejects with `worktree_claimed` at the RPC level when the
      target worktree is already claimed — new regression coverage, since
      no existing test asserts this today.
- [x] New unit tests exercise the extracted function directly against a
      `WorktreeOwnershipRegistry` and `OwnershipKey` (claimed and
      unclaimed cases), with no IPC server or write-loop involved, and
      assert `undefined` is returned in the unclaimed case.
- [x] `start`, `resume`, and `revise` each call the extracted function
      rather than inlining `_registry.isClaimed(key)` themselves.

## Documentation updates

- `v2/docs/daemon-host.md`: note under
  `#admission-guards-for-start-resume-revise` that the live-claim check is
  a standalone exported function shared by `start`, `resume`, and `revise`.
