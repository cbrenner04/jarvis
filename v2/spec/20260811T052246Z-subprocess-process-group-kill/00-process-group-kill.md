# 00 - Opt-in process-group spawn and kill

`realAsyncSubprocessRunner.runAsync` in `shared/subprocess.ts` kills only the direct child on abort (`child.kill("SIGTERM")`, SIGKILL after 50ms). Grandchildren — `bun test` pool workers under a gate command — survive and keep running. Add an opt-in per-call mode that spawns the child detached (its own process group), signals the whole group on abort or timeout, and surfaces the group id so an owner can record it and reap it later. Existing callers are untouched.

## Decisions

- Group mode is a single option, `processGroup?: { onGroupId?: (pgid: number) => void }` on `AsyncSubprocessOptions`; presence enables the mode and the optional callback surfaces the id — rules out a separate boolean plus id-callback pair, which admits the invalid "id without group mode" combination. The intent defers name/shape to the ready-gate caller: this is the minimal shape, and renaming it later is a mechanical change at one call site.
- Selection is a single line, `const groupMode = options?.processGroup !== undefined;`, that every group-only code path (spawn options, abort kill, timeout kill) reads from — the one anchor both the guard and keystone checkpoints below mutate.
- `onGroupId` is invoked once, synchronously after spawn, with `child.pid` (the detached child is its own group leader, so pgid === pid); it is never invoked when `processGroup` is absent, and not invoked when `child.pid` is `undefined` (spawn failed).
- Group kill signals `-pgid` via `process.kill`, SIGTERM then SIGKILL after the existing 50ms grace — rules out keeping `child.kill()` alongside, which would not reach grandchildren. When `child.pid` is `undefined` (spawn failed), the group-kill path is skipped entirely, same as the existing `onGroupId` carve-out — `process.kill(-undefined, …)` throws `TypeError`, outside the swallowed `ESRCH`/`EPERM` set.
- `process.kill` errors (`ESRCH`/`EPERM`, group already reaped) are swallowed — an already-dead group is the success case, not a rejection.
- In group mode, `timeoutMs` is enforced by an owned timer that runs the group-kill path instead of passing `timeout` to `execFile` — rules out relying on `execFile`'s timeout, which kills only the direct child and would leave the leak in place on timeout. Non-group mode keeps passing `timeout` to `execFile` unchanged.
  - Rejection contract: a group-mode timeout rejects with the same shape as today's timeout — `AsyncSubprocessError` carrying code `"ETIMEDOUT"` — so callers observe no divergence between group and non-group timeout handling.
  - Timer lifetime: the owned timer is cleared on settle (success, failure, or abort) and `.unref?.()`'d, matching the existing escalation timer, so a group-mode call never holds the event loop open.
- `detached: true` trades crash semantics: today a dying parent takes the child with it; a detached group survives parent death and, combined with `stdio: "ignore"`, is reachable only via the recorded group id. Latent here (no caller opts in yet) — the future reaper consumer must record the id durably to make this a net win.
- POSIX-only: negative-pid group signaling and `detached` semantics are not portable to Windows. `shared/` is consumed by both engines on the operator's Linux/macOS machines; this option assumes POSIX and is not required to work on Windows.
- Deferred: nothing here signals a stale/reused group id. A future reaper that persists a pgid and signals it later needs its own liveness/ownership check before doing so; out of scope for this subspec.
- Non-group calls keep today's spawn options and single-child kill path byte-for-byte; no existing caller opts in as part of this subspec.

## Task checklist

- [ ] Add `processGroup` to `AsyncSubprocessOptions` with a doc-comment covering group semantics and when `onGroupId` fires.
- [ ] Spawn detached and group-kill on abort/timeout when the option is present; leave the existing path in place when it is absent; skip the group-kill path when `child.pid` is `undefined`.
- [ ] Tests in `shared/subprocess.test.ts`: group id recorded, group killed on abort, group killed on timeout, grandchild dead after abort, default call unchanged (grandchild survives, no `onGroupId`).
- [ ] Docs per below.

## Acceptance criteria

- [ ] A group-mode `runAsync` call spawns detached and reports its group id: a new test in `shared/subprocess.test.ts` asserts `onGroupId` receives the child's pid; it fails against the pre-fix code.
- [ ] Aborting a group-mode call signals the whole group, not just the direct child: a new test asserts the spawned process is gone after abort; it fails against the pre-fix code.
- [ ] A group-mode call that exceeds `timeoutMs` is killed via the group path and its promise rejects with `AsyncSubprocessError` code `"ETIMEDOUT"`: a new test asserts this; it fails against the pre-fix code.
- [ ] A grandchild of a group-mode call is dead after abort: a new test spawns a fixture that provably forks a distinct intermediate process and a separately-identifiable long-lived grandchild (for example `sh -c 'sleep 100 & echo $! > "$PIDFILE"; wait'`, reading the grandchild pid from `$PIDFILE`), aborts, and asserts the grandchild pid is gone (`process.kill(pid, 0)` throws); it fails against the pre-fix code.
- [ ] A call without `processGroup` keeps today's spawn options and single-child kill path: a new test asserts no group-id callback fires and that a grandchild of a non-group call is still alive after abort, reaping it unconditionally (`try`/`finally`) so the test never leaks the orphan it creates.
- [ ] `shared/subprocess.test.ts` — `aborting a running child kills it via SIGTERM`; `escalates to SIGKILL when the child ignores SIGTERM after abort`; `an already-aborted signal kills the child before it can run` stay green (default behavior unchanged by the option).
- [ ] `shared/subprocess.test.ts` — `a non-group call leaves its grandchild running`; Mutation checkpoint: forcing group mode on for every call turns the default-path test red.
- [ ] `shared/subprocess.test.ts` — `a grandchild of a group-mode call is dead after abort`; Keystone checkpoint: forcing group mode off leaves the grandchild alive even for an opted-in call and turns the test red.
- [ ] `bun run typecheck` passes and `bun run test` passes (`shared/**` touched).

## Documentation updates

- `v2/docs/v2-architecture.md` § Steering semantics: note that the shared async runner can opt into process-group spawn/kill so SIGTERM→SIGKILL reaches grandchildren, and that the group id is surfaced to the caller for durable recording and later reaping.
- Inline doc-comment on `processGroup` in `shared/subprocess.ts` covering detached spawn, group signaling on abort and timeout, and `onGroupId` firing conditions.
- No `v2/docs/v1-behaviors.md` entry: no existing behavior changes — the mode is additive and opt-in.

## Implementer notes

Both `@mutate` directives target the same selector line and must quote text that occurs exactly once in the landed `shared/subprocess.ts`; adjust the quoted original to match the code you write, keeping the same semantic mutation and the same anchor:

- Guard checkpoint (in the default-path test body): `// @mutate shared/subprocess.ts "const groupMode = options?.processGroup !== undefined;" -> "const groupMode = true;"`
- Keystone (in the grandchild test body): `// @mutate shared/subprocess.ts "const groupMode = options?.processGroup !== undefined;" -> "const groupMode = false;"`
