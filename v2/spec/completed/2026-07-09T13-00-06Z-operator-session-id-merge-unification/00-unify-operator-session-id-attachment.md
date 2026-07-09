# Unify operator-session-id attachment semantics

## Problem

`applyOperatorSessionId` (`v2/src/daemon/daemon.ts:1240`) and
`withOperatorSessionId` (`v2/src/cli.ts:431`) both stamp `telemetry.operatorSessionId`
onto a `WriteLoopInput` but disagree: the daemon function merges the daemon id
into any existing `telemetry` (daemon id always wins); the CLI function returns
`input` unchanged whenever `telemetry` is already set. Two functions, two
undocumented policies, one concept.

## Decisions

- Single merge policy: always merge the given `operatorSessionId` into
  `input.telemetry`, overwriting any existing `operatorSessionId` while
  preserving other `telemetry` fields (`sinkPath`, `workflow`, `role`). This is
  `applyOperatorSessionId`'s current behavior.
- Rationale for picking overwrite over defer-if-present: at the CLI call site
  (`v2/src/cli.ts:100`), `parsed.input` is built by
  `buildWriteLoopInputFromCliValues`, which never sets `telemetry` — so
  `withOperatorSessionId`'s defer branch is dead code today. Both call sites
  tolerate either policy; overwrite is the stricter guarantee for telemetry
  correctness.
- One function, one name, defined once in `v2/src/execution/write-loop.ts`
  (already imported by both `daemon.ts` and `cli.ts`, and owner of the
  `WriteLoopInput`/`telemetry` type) — avoids a new module for a single
  function and avoids either call site importing from the other's file.
  Named `applyOperatorSessionId` (reuses the surviving daemon name; the
  losing `withOperatorSessionId` name is retired with its defer behavior).
- Delete `applyOperatorSessionId` (old daemon.ts definition) and
  `withOperatorSessionId`; both call sites switch to the new
  `applyOperatorSessionId` exported from `write-loop.ts`.

## Task checklist

- [ ] Add exported function `applyOperatorSessionId` in
      `v2/src/execution/write-loop.ts` that merges `operatorSessionId` into
      `input.telemetry` per the merge policy above, with a doc-comment
      stating the policy explicitly (non-obvious contract: overwrite-wins
      merge, not defer-if-present).
- [ ] Update `v2/src/daemon/daemon.ts:1255` to call
      `write-loop.ts`'s `applyOperatorSessionId`; remove the old
      daemon-local definition.
- [ ] Update `v2/src/cli.ts:100` to call `applyOperatorSessionId`; remove
      `withOperatorSessionId`.
- [ ] Update `v2/src/daemon/daemon-operator-session.test.ts` to import and
      exercise `applyOperatorSessionId` from `write-loop.ts` (same
      merge-policy assertions).
- [ ] Update `v2/src/cli.test.ts:578` ("withOperatorSessionId does not
      overwrite caller-supplied telemetry") to match the unified overwrite
      policy — the old defer-if-present assertion no longer holds — and add
      an assertion that non-`operatorSessionId` `telemetry` fields
      (`sinkPath`, `workflow`, `role`) on the CLI-supplied input are
      preserved after the merge.

## Acceptance criteria

- [x] Exactly one exported function, `applyOperatorSessionId` in
      `v2/src/execution/write-loop.ts`, implements operator-session-id
      attachment; no other `applyOperatorSessionId` or
      `withOperatorSessionId` definitions exist anywhere in `v2/src`.
- [x] The function's doc-comment states the merge policy: daemon-supplied
      `operatorSessionId` always overwrites any existing value, other
      `telemetry` fields are preserved.
- [x] `daemon-operator-session.test.ts` stays green against the unified
      function (behavior unchanged for the daemon call site).
- [x] `cli.test.ts` reflects the unified overwrite policy at the CLI call
      site: a caller-supplied `telemetry.operatorSessionId` is overwritten,
      not preserved, AND other caller-supplied `telemetry` fields
      (`sinkPath`, `workflow`, `role`) are preserved through the merge.
- [x] `bun run typecheck` and `test:v2` pass.

## Documentation updates

- Merge policy is documented via the doc-comment on the unified function
  per `v2/docs/documentation-standard.md` inline tiering (genuinely
  non-obvious contract: overwrite vs. defer is not derivable from the
  function's name/signature alone).
- No `v2/docs/v1-behaviors.md` update: both prior functions are v2-only
  (`v2/src/daemon/daemon.ts`, `v2/src/cli.ts`), with no v1 counterpart.
