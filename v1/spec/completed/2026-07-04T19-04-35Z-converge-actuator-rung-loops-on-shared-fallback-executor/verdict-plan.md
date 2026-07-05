## Verdict: Required Refinements

**1. Per-rung abort-signal ownership must be pinned down explicitly (blocking).**

`executeWithQuotaFallback` forwards a single caller-supplied `signal` to every rung's `invoke()` call — it has no per-rung controller concept. Today's review/shrink loops construct a fresh `AbortController` *inside* the per-rung loop iteration, so each rung gets a clean, non-aborted signal. The only existing consumer of the shared executor (plan's verdict-actuator) sidesteps this entirely: it never sets `shouldAdvance` for idle-timeout, so its single top-level controller is never asked to serve a second rung after an abort. Review and shrink are different — they must advance past an idle-timeout rung — so copying the plan pattern verbatim (one controller spanning the whole `executeWithQuotaFallback` call) would hand rung 2 an already-permanently-aborted signal, which is very likely to break "idle-timeout advances to next agent" instead of preserving it.

Both subspecs must add:
- An explicit Decision stating how idle-watchdog abort scoping works when rung iteration is owned by the shared executor (e.g., each binding's `invoke()` owns and disposes its own internal controller/watchdog rather than relying on a single top-level signal for idle purposes) — enough to make clear the mechanism will not leak an aborted signal across rungs, without prescribing the exact code shape.
- A Task Checklist item requiring this per-rung abort scoping to be implemented, not just described in prose.

**2. Review binding must support the idle-watchdog spawn/liveness hooks it doesn't have today (blocking).**

`createReviewInvocationBinding`'s `invoke()` today only forwards `cwd`/`signal`/`additionalReadDirs` — it has no `onSpawned` (pgid capture) or liveness-timestamp hook, both of which the current inline review loop relies on for the idle watchdog. The 00 subspec's Decisions text ("idle watchdog wiring stays as today, attached per binding invocation") assumes this plumbing already exists in the binding; it doesn't. Add a Decision + Task Checklist item in 00 (and confirm/replicate in 01 if `createShrinkInvocationBinding` has the same gap) requiring the binding to expose whatever hook surface the watchdog needs (pgid capture, last-output liveness tracking) before the rung loop can be converted.

**3. Acceptance criteria must actually pin the regression class this refactor risks introducing.**

The existing "stays green" ACs are insufficient here: the `FakeAgent` used in the idle-watchdog fallback test never inspects `opts.signal.aborted`, so a poisoned/pre-aborted signal silently reaching the fallback rung would still pass. Add an AC (to both 00 and 01) requiring either a test assertion that the fallback rung's invoke is called with a non-aborted signal, or a dedicated unit test on the new per-rung controller-ownership mechanism — something that would fail if abort-signal scoping regresses to "one controller for the whole executor call."

**4. Cross-subspec consistency note (non-blocking, minor).**

Since 00 and 01 independently need the same per-rung abort-scoping resolution, whichever lands first should establish the pattern in code, and the other subspec should say it reuses that established pattern rather than re-deriving it. A one-line cross-reference is sufficient; no structural change needed.

No other findings require refinement.