1. Define a race-free settlement boundary: all repair work must be cancelled and joined, the physical worktree lock and daemon registry claim must both be released, and only then may `completed`, `failed`, or `killed` become observable.

2. Clarify non-cooperative cancellation behavior. A run must remain nonterminal and retain ownership until the repair process and invocation promise are actually quiescent; terminal visibility cannot rely on abort signaling or bounded waiting alone.

3. Specify daemon kill semantics, including kill during repair. The kill request and durable `killed` observation must not imply settlement before repair quiescence and both ownership layers are released. Cover this through the real daemon path.

4. Treat `.jarvis.lock` and the daemon’s in-memory/registry claim as distinct resources. Acceptance coverage must prove both are released through their owning lifecycles, rather than merely deleting the lock file.

5. Cover every actual finalization-repair integration path that can reach the three scoped statuses, including ready-gate/publication and mutation repair across applicable fresh and resumed workflows. Tests must exercise realistic settlement writers rather than synthetic store transitions.

6. Make each matrix case state its expected terminal outcome and resumability. Behavior-preservation criteria must cite the existing tests that pin those results, as required by the refactor acceptance-criteria guidance.

7. Require immediate same-key re-admission after durable terminal status is observed, without awaiting the old workflow promise or deferred cleanup. Assert a positive dispatch event such as run creation or invocation start, not merely absence of refusal text.

8. Mutation-pin every distinct added or changed guard, including abort propagation, invocation joining, terminal ordering, physical-lock release, registry-claim release, and kill ordering. Removing or inverting each guard must turn its corresponding regression test red.

9. Scope terminology precisely to `completed`, `failed`, and `killed`. Do not claim coverage of every terminal status unless `blocked` and `interrupted` are included; otherwise explicitly explain their exclusion from repair settlement.

10. Split the oversized work into independently testable, serial subspecs: one for repair cancellation/join and durable-status ordering, followed by one for daemon kill, ownership release, and immediate re-admission. Preserve every original task and acceptance outcome exactly once across the replacements, divide documentation updates accordingly, and link every replacement from `index.md`.
