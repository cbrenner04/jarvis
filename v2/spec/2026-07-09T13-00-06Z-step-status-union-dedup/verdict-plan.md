Verdict: No refinements required. The spec may proceed as drafted.

Rationale:
- Finding 1 (regression guard): the change is type-only and behavior-preserving by TypeScript structural typing, not a behavioral refactor, so the spec-guidance citation rule for "behavior unchanged" ACs doesn't apply — there's no runtime behavior to pin, and the import itself is the structural anti-drift mechanism (no second literal exists to diverge from). Adding a test that only asserts an import exists would be test-for-thoroughness, which the ledger/AC guidance explicitly discourages.
- Finding 2 (rename on export): out of scope — the intent's decision line fixes the type name and import direction; introducing a rename is unrequested scope creep.
- Finding 3 (downstream consumer coverage): moot absent a concrete example. No consumer was identified where the inline literal and the exported type could diverge (e.g., via `satisfies` or an exhaustiveness switch); the existing `bun run typecheck` AC already catches structural incompatibilities, which is the correct and sufficient check for a type-only dedup.

The current AC set (export + import wiring, `bun run typecheck` passes) matches the intent's scope and the "keep one definition" decision with no invented precision or unrequested test coverage.