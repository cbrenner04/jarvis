## Verdict

The spec needs targeted refinement, not restructuring. Required changes:

1. **Restate the telemetry decision.** The intent commits to `invocation_completed` rows carrying real agent/model metadata on `claude` settle. The current Decisions list omits this, and "existing tests stay green" ACs only prove non-regression — they don't prove real metadata now flows. Add a Decisions line and a new AC asserting real `claude` agent/model metadata appears on a settled invocation.

2. **Explain the `--output-format json` flag given deferred parsing.** The spec defers cost/usage propagation but still mandates this flag. State explicitly that the flag is included for forward compatibility, the JSON body is unused this slice, and classification reads only exit code/stderr — otherwise the flag reads as unexplained scope.

3. **Pin the `model_config` vs `error` classification mapping.** This is a harness subspec where internal structure is fair game per spec guidance. Name the specific stderr/exit-code signals that map to `model_config` vs generic `error` (cite the v1 `quota.ts` heuristic being ported), so the implementer isn't guessing at a boundary that already exists in the reference code.

4. **Classify abort explicitly.** Since `execute.ts`'s fallback loop is out of scope for new logic, state which of `ok | quota | model_config | error` an aborted (AbortSignal-triggered) invocation produces, so the existing fallback contract isn't stressed by an undefined case.

5. **Cover spawn-level failure (e.g., missing CLI binary).** State whether this classifies as `error` (matching v1) and add it to the required test coverage list — currently only success/quota/model_config/generic-error/abort are named, leaving binary-not-found unaddressed.

6. **Tighten the `v1-behaviors.md` update condition.** Replace the vague "if the shared port diverges from or narrows v1 behavior" hedge with a concrete, checkable criterion (e.g., does shared's classification set or precision differ from v1's today — yes/no), since this is genuinely new `shared/` functionality rather than a v1 behavior change, and the current phrasing leaves the doc-update trigger ambiguous.

7. **(Minor, cheap) Add a one-line Decisions rationale for the flag set** — e.g., "CLI flags ported verbatim from v1's `claude.ts` invocation" — since the flags are asserted as a task detail without stating they're a straight port.

Not required: splitting into multiple subspecs (the spawn/quota port has no independent consumer other than this wiring, so splitting would land dead code prematurely — keep as one subspec unless implementation reveals real size overrun), further specifying the `invoke` seam's exact signature (already an implementation-discovery detail, not a design gap), and a separate malformed-output test case (fold into the generic-error case unless v1's classifier has a distinct code path for it).