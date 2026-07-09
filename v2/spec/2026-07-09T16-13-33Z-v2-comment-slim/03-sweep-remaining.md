# 03 - Sweep remaining v2/src comments

Sweep the rest of `v2/src` (outside the files covered by subspecs 00-02) against `v2/docs/documentation-standard.md`'s inline tiering; trim narration comments that restate names/types/bodies, keep constraint comments. When in doubt, keep.

## Decisions

- Zero behavior or signature changes; comments only.
- Explicit keep-list, do not touch:
  - `v2/src/execution/workflow-runner.ts`: the snapshot-grafting guard comment (~line 428, "Guards against grafting a foreign invocation's snapshot...").
  - `v2/src/execution/write-loop.ts`: the telemetry-presence rule comment (~line 245, "operator-session-only telemetry attachment...").
  - `v2/src/execution/review-debate.ts`: the review-debate read-only convention comment.
  - `v2/src/daemon/daemon.ts`: the revision-inactive-statuses rationale (already excluded via subspec 01).
- Out of scope: test files, doc files, any code (non-comment) change, and — explicitly, regardless of landing order — `tui-monitor-types.ts`, `tui-daemon-client.ts`, `daemon.ts`, `log-stream.ts` (owned by subspecs 00-02).
- Run this subspec after 00-02 land, to avoid comment-collapse conflicts in shared files.

## Task checklist

- [ ] Walk each non-test `.ts`/`.tsx` file under `v2/src` excluding `tui-monitor-types.ts`, `tui-daemon-client.ts`, `daemon.ts`, and `log-stream.ts`.
- [ ] Trim comments restating names/types/bodies per the tiering rule; leave ambiguous cases untouched.
- [ ] Confirm every keep-list comment above is present, unmodified.

## Acceptance criteria

- [ ] `bun run typecheck` passes with no signature changes anywhere in `v2/src`.
- [ ] `bun run test:v2` and `bun run test:integration:v2` stay green (behavior unchanged).
- [ ] Every keep-list comment (snapshot-grafting guard, telemetry-presence rule, review-debate read-only convention, revision-inactive-statuses rationale) is present, unmodified.
- [ ] `git diff` for this subspec's touched files excludes `tui-monitor-types.ts`, `tui-daemon-client.ts`, `daemon.ts`, `log-stream.ts`, and touches only comment/whitespace lines elsewhere.

## Documentation updates

None — comments-only change, no operator-facing or cross-file behavior changed.
