## Verdict — required refinements

1. **Fix intro accuracy on test duplication**  
   The intro says `daemon-start-list.test.ts` “duplicates the same logic.” That file reimplements a simplified in-process subset (no `normalizeBindings`, different error text, different settlement). State that it **simulates** run-control behavior; known drift stays until the follow-on intent migrates tests to the factory.

2. **Clarify test-consumption sequencing**  
   Intro and decision #1 read as if tests consume the factory in this slice, but the spec defers `daemon-start-list.test.ts` migration. State the factory is **exported for** test use; **enforceable consumption here is production-only** via `startDaemon`. Test wiring is the follow-on’s contract.

3. **Record intent-narrowing on `logReader`**  
   Intent names `logReader` as a factory dep; run-control handlers do not use it (`tail` does). Add an explicit decision: this slice **omits `logReader` from factory deps** — rules out blocking extraction on a tail-only dependency. Keep deferral of exact shape for the follow-on that wires fakes.

4. **Add a doc-comment acceptance criterion**  
   Tasks and Documentation updates require doc-comments per `v2/docs/documentation-standard.md`, but no AC enforces them. Add a criterion that the exported factory and deps type have doc-comments per that standard.

5. **Pin the production `writeLoopExecutor` split**  
   AC #1 requires an injectable `writeLoopExecutor`; deferral only covers the **test-fake** shape. Pin the production boundary: factory owns the fire-and-forget IIFE and claim/release/cleanup around settlement; injected executor runs the write-loop body only; `logsPath` and log-sink open/close stay in `startDaemon`’s production wrapper — rules out placements that block follow-on fakes.

6. **Record `logsPath` as out of scope for factory deps**  
   Add a decision that `logsPath` is **not** a public factory dependency in this slice; it remains a `startDaemon` production-wrapper concern until the follow-on pins test wiring.

## Rationale (summary)

- **#1–2:** Misstated duplication and implied same-PR test migration conflict with the deferred follow-on and preservation ACs that pin **current test behavior**, not production parity.  
- **#3:** Without intent-narrowing, the `logReader` deferral looks like an oversight against the seed intent.  
- **#4:** Spec guidance treats inline doc-comments as contract; tasks alone are not enforceable.  
- **#5–6:** Injectable `writeLoopExecutor` without a production split invites incompatible abstractions and API churn before the follow-on adds fakes.

## Not required

- Do **not** add `daemon-lifecycle.test.ts` to preservation ACs — it exercises `daemon-lifecycle`, not run-control handler wiring in `daemon.ts`.  
- Do **not** add factory naming, return-shape, or standalone exercisability ACs — AC #2 plus `daemon.sandbox-unrunnable.test.ts` suffice for this extraction slice; run-control RPC semantics through the factory belong to the follow-on.  
- `v1-behaviors.md` skip remains correct — no operator or wire change.
