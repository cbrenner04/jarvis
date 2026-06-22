## Verdict

### Upheld — required fixes

**1. Subspec 02 ships a contradictory, dead determinism seam.**
The `__testClock` production seam added to `v1/src/modes/patch/run.ts` and `iteration.ts`, together with the 105-line `v1/test/mock-clock.ts` helper, is never exercised: no test injects the clock and nothing imports `mock-clock.ts`. Meanwhile the assertions these were built for live in `run.sandbox-unrunnable.test.ts` and remain wall-clock/real-process bound — real `sleep`, real `Date.now()`, real `runAgent` spawn, and the verbatim `iterationTimeoutMs: 4000` allowance with its `4000ms` assertion. This is internally inconsistent two ways:

- 02's lead Decision says the refactor removes the 4000ms wall-clock allowance; it is still present.
- 02's AC1 is checked `[x]` asserting "timing is driven by an injected clock/poller"; as shipped, timing is still wall-clock and the seam that would satisfy this is unused.

The intent forbids production change beyond *needed* additive DI seams. A seam that no test uses is not needed, so the `__testClock` plumbing and `mock-clock.ts` violate that constraint as dead production/test surface (and `mock-clock.ts` additionally carries latent bugs — no-op `clearTimeout`/`clearInterval`, an interval `runAll()` that never terminates — making it a trap for any future reuser).

**Required outcome:** Resolve the contradiction so the code and 02's acceptance criteria agree. The two legitimate end-states are mutually exclusive — exactly one must hold:
- (a) The timing coverage is irreducibly real-OS (real process-group kill semantics): then the unused `__testClock` seam and `mock-clock.ts` must not exist, the coverage stays in the `*.sandbox-unrunnable.test.ts` sibling under 02's escape-hatch AC, and 02's AC1 / lead Decision text must be corrected to describe the marked-exception route actually taken rather than claiming an injected clock and a removed allowance; **or**
- (b) the clock is genuinely injectable: then the seam must be wired into the assertions and the 4000ms wall-clock allowance actually removed, satisfying AC1 as written.

What must be true either way: no dead production seam or unused helper remains, and 02's `[x]` AC1 and Decision text accurately describe the shipped behavior. (Path (a) is the lower-risk resolution given the assertions appear to need real process-group kill semantics.)

**2. `findings.md` describes an approach that was not delivered.**
The work-list records `run.test.ts`'s remediation as "inject clock + poller … route descendant/process interaction through injected spawn / `DescendantTracker` seams." The delivered `run.sandbox-unrunnable.test.ts` uses real `runAgent`, a real `trap '' TERM` script, and a real process-group kill — neither injected clock nor injected spawn. 05's checklist claims findings were reconciled, but the entry still prescribes the untaken approach.

**Required outcome:** Reconcile `findings.md` so the `run.test.ts` entry reflects the route actually taken (marked-exception, real-OS process-group coverage), consistent with the fix to finding 1.

### Not blocking (record only, no action required)

- `run.test.ts` remains agent-runnable while issuing real `git` calls (heavier real-git use than several exiled files), so "agent-runnable" overstates its sandbox-safety. This is residual debt outside 02's R4-narrowed scope and does not break any green claim (green basis is sandbox-off); it does not require action under this spec.
- The agent-adapter `spawn` seams and v2 `withExternalWorktree` seams are additive, default-preserving, and actually used — no action. R1 (smell checklist present, "Out of scope" no longer disavows conversion) is satisfied. Subspecs 00, 01, 03, 04, 05 land clean.