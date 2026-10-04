## Verdict — changes required

### Blocking

1. **Auto-start must not be gated by `--no-auto-bounce`.**
   `v2/src/cli/stale-dispatch.ts:72` only calls `connectWithAutoStart` when `autoBounce` is true. The spec's stated gate is *mutating vs. read-only dispatch*, not the stale-bounce opt-out, and both new doc paragraphs assert unconditional auto-start. Today `jarvis run start --no-auto-bounce` on a fresh checkout still dies with a lifecycle error while the docs claim otherwise. Required outcome: every path through `withAutoBounceDispatch` auto-starts the keyed daemon when absent, regardless of the bounce flag; `--no-auto-bounce` continues to govern only stale-daemon restart. Code and docs must agree.

2. **The change is untested at the `withAutoBounceDispatch` boundary.**
   All new tests call `connectWithAutoStart` directly. Nothing pins the branch at line 72, the new stderr routing at line 115, or any exit code. AC 5 ("exits 1 with a connection error") and AC 8 ("pin every added or modified guard in both directions") are ticked without evidence. Required outcome: tests that drive the dispatch entry point (the `main`-level harness in `run.test.ts` is the existing precedent) and assert exit code 1 plus the connection-error text on deadline exhaustion, and assert dispatch actually happens on the success paths.

3. **Two ticked acceptance criteria have no corresponding test.**
   - The differently-keyed live daemon that must receive no request — explicitly listed in the spec's Tasks section, never written.
   - Read-only commands (`run list`, `run wait`, `tui`, `daemon status`) not auto-starting — structurally true via `withRunClient`, but unpinned.
   Required outcome: both are covered, or the ACs are untucked. A single cheap pin suffices for the read-only case.

### Should fix

4. **Post-start connect gets one bare attempt; the rarer race path gets a 5s retry loop.**
   Line 60 fails hard if the daemon it just started isn't accepting connections yet — the common case is less forgiving than the uncommon one. Worse, on that failure `client` is `undefined`, so it reports through `formatLifecycleError` rather than as a connection error. Required outcome: both post-start and post-race connects share one bounded retry with consistent error reporting.

5. **The initial connect error is discarded** (`catch {}`, line 34), removing the only diagnostic operators had before this change. Required outcome: that error survives into whatever is finally reported (e.g. as `cause`). Note: this is a diagnostics defect only — `startDaemon` probes the socket first, so a live-but-busy daemon yields `DaemonAlreadyRunningError` and is retried, not double-spawned.

6. **Test-fixture hazards.**
   - The shared `createPartialDeps` default ships `now: () => 0, sleep: async () => {}`, so the retry loop's termination depends entirely on a mock eventually connecting. Any future test that changes that mock hangs the suite instead of failing. Required outcome: the shared fixture advances time.
   - `return createMockIpc() as any` as a `startDaemon` return value is the wrong shape in a `strict` repo — remove it.
   - The race-pin test's bare `catch {}` passes on any error, including the wrong one — assert the specific rejection.
   - `expect(sleepCalls.length).toBeGreaterThan(0)` under-pins the deadline AC — assert the retry interval and attempt count.

7. **Docs are too long and one is incomplete.**
   The two new paragraphs are ~10 lines each and near-verbatim duplicates. Repo rule is terseness. Required outcome: each cut to 2–3 sentences carrying only the delta; the `v1-behaviors.md` bullet states the v1 behavior it differs from (every neighboring bullet does); the `write-behavior.md` addition matches the file's hard-wrap width. Drop the 5s literal from prose — documenting the number invites drift. Hardcoding the constant itself is fine; no config surface or named export is warranted.

### Explicitly not required

- Substring-based error routing at line 115 follows this file's own existing pattern (`startsWith("malformed RPC")`, `includes("recovery did not")`). Only worth converting to a typed error if the retry unification in (4) touches that code anyway.
- `now`/`sleep` being optional on `CliDeps` with `??` fallbacks is consistent with `promptConfirm`/`jarvisRoot`/`subprocessRunner`. Leave as is.
- Do not extract `connectWithAutoStart` into a new module. The spec places auto-start inside `withAutoBounceDispatch`, and the helper sits next to its sole caller.