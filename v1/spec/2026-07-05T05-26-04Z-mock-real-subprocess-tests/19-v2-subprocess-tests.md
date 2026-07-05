# v2 subprocess tests

## Problem

Five v2 files spawn real subprocesses/sockets:
`daemon.sandbox-unrunnable.test.ts`, `external-worktree.sandbox-unrunnable.test.ts`,
`ipc.sandbox-unrunnable.test.ts`, `log-stream.sandbox-unrunnable.test.ts`,
`testing/preload.sandbox-unrunnable.test.ts` — source of
`v2-test-runner-unbounded-spawn` gotcha.

## Decisions

- Socket/cross-process cases needing real IPC may stay with justification.
- `testing/preload` audit same as shared preload (subspec 02).

## Task checklist

- [ ] Convert bulk to mocked subprocess tests per file.
- [ ] Drop `.sandbox-unrunnable` suffix from converted files.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh where mockable.
- [ ] Remaining real-subprocess/socket tests justified inline.

## Documentation updates

- None.
