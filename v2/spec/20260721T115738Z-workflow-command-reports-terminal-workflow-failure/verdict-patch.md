# Verdict: Required Refinements

1. **Successful entry `list` must expose `loopOutcomeKind: "complete"`.**  
   The completed acceptance criterion requires both entry `wait` and `list` to report the successful workflow outcome. Current list projection omits it, and the success regression asserts only status.

2. **Entry `wait` and `list` must share identical outcome projection semantics.**  
   Owner selection, resumability, and adjusted error retryability/next action must derive through one consistent contract. The current hardcoded wait result and separately computed list result can drift, violating the spec decision.

3. **Projection must occur only when the entry outcome disagrees with the terminal rollup owner.**  
   Encode this condition or establish it as a documented, tested invariant. This bounds re-sourcing to the behavior authorized by the spec.

4. **Update `v2/docs/write-behavior.md`.**  
   Document the actual list column count/order, including the three mutation fields, and distinguish a resumable owning shrink row from the intentionally non-resumable projected entry row. The current durable CLI contract contradicts implementation and operator semantics.

5. **Pin the attached-command failure exit contract.**  
   Add an exact workflow-command assertion showing a corrected `surviving_mutation_failed` payload is printed and exits nonzero. Generic failed-status and general exit-table coverage do not fully substantiate the completed intent’s specific terminal-outcome claim.
