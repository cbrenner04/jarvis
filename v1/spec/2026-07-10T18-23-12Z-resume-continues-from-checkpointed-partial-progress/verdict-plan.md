1. Define the authoritative, process-persistent evidence for a resumable checkpoint, including exact accepted metadata, active-subspec association, immediate-predecessor requirements, and whether intervening commits invalidate it. The current commit does not identify a subspec, so the spec must either add reliable identity or explicitly bound the weaker `HEAD checkpoint + still-active subspec` contract.

2. Define one-shot consumption semantics across invocations. Cover timeout → continuation notice → non-timeout/no-commit attempt → next prompt, ensuring stale checkpoint `HEAD` does not repeat the notice contrary to “no change when the prior iteration was not a timeout.”

3. Pin detection-failure behavior. Git or persisted-state inspection failures must have a defined outcome, and malformed or partial metadata must not accidentally enable continuation context.

4. Require coverage of both optional prompt states under the revision-aware registry contract: absent output remains byte-for-byte stable, present output includes the continuation direction, and shared plus Codex-wrapper artifacts remain governed. Clarify fixture versus focused-test ownership rather than implying unsupported duplicate snapshots.

5. Replace scoped verification with `bun run typecheck` and full `bun run test`. Changes under root `prompts/**` trigger the repository’s full-suite fallback.

6. Keep the decisions ledger atomic: separate prompt-template/placeholder ownership, revision bumping, and fixture regeneration. Each entry must name the plausible alternative it rules out, per the plan ledger standard.
