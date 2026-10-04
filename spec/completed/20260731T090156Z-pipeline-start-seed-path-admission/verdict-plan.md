Validating key codebase claims so the verdict is grounded in the current implementation.
## Verdict: required refinements

1. **Outside-root rejection in acceptance criteria** — Decisions require containment under the registered project root after symlink resolution for any resolved path outside the root (e.g. `../` traversal), not only symlink escapes. AC3 must treat plain outside-root rejection as a required case with test coverage, not an optional extension of the symlink case.

2. **Unreadable-file rejection semantics** — Removing `readFileSync` drops today’s unreadable failure path unless admission still probes readability without loading content. The spec must state whether pre-admission unreadable rejection remains (via a non-content probe such as read access) or is dropped from the rejection contract and AC3.

3. **Containment policy alignment** — Replace the loose “implement-style where practical” decision with explicit intent-style containment: strict `realpathSync` on registered root and resolved seed path, same `inside()` semantics as standalone intent `resolveSeed`, with no lexical fallback. Admission containment must match what the intent stage will enforce.

4. **`realpathSync` failure handling** — With strict realpath containment, state how canonicalization failures on the seed path are surfaced (same error family as existing pipeline seed-path failures, e.g. `pipeline: cannot resolve seed path: …`), so implementers do not silently fall back to lexical checks.

5. **Stale problem prose** — Problem statements reference `resolveIntentSeed`, which does not exist; the path-branch resolver is `resolveSeed` in `publication-workflow-steps.ts`. Fix in subspec and `intent.md` problem prose.

6. **Intent prerequisite wording** — The prerequisite says “project-relative `seedPath`”; the admitted contract is the operator-relative CLI argument verbatim (downstream joins with admission `cwd`). Align prerequisite wording with the subspec decision.

7. **AC1 shape contract** — Require explicit absence of inlined content on the `--seed` path (`context.seed` must not be set), not only a positive `seedPath` match via `toMatchObject`. State that the weak happy-path test (`reads --seed from a relative file path`) is replaced with assertions on `pipeline_start` context shape.

8. **AC2 preservation framing** — `--seed-text` behavior is already correct pre-fix; rewrite AC2 as preservation/regression (existing text-branch admission stays green) plus the mutation checkpoint for `seedPath` leakage. Drop the inaccurate “fails pre-fix if path shape leaks” claim.

9. **AC3 preservation vs new behavior** — Absolute path, missing file, directory, and unreadable rejection are already covered pre-fix. Scope “fails pre-fix” to new containment cases (plain outside-root and symlink escape), or split into a preservation AC (existing rejection tests stay green) and a new-behavior AC for containment. Keep the containment inversion mutation checkpoint.

10. **Test fixture constraint** — Task checklist must require happy-path and rejection fixtures place seeds under the registered `<project>` root (or use `cwd` + relative path that resolves inside it). Current tests use `cwd` in a temp dir outside `fx.repoRoot`; new containment will reject that layout without fixture rework.

11. **Serial dependency visibility** — Record that this slice is admission-only: after merge, `pipeline start --seed` persists `seedPath` only, but intent-stage dispatch still reads `context.seed` until the sibling `pipeline-intent-stage-seed-path-identity` work lands. File-seed pipelines are not end-to-end correct until then; state this in decisions or task checklist so operators and implementers do not treat merged admission as shippable E2E behavior.

**Rationale:** Items 1–4 close gaps between decisions and verifiable contracts (containment breadth, probe semantics, policy fork with intent stage). Items 5–6 fix misleading implementer-facing prose. Items 7–9 align with spec guidance on failing-test vs preservation ACs and guard inversion. Items 10–11 prevent implementer churn and hidden E2E regression during the serial intent chain.

**No split required** — One CLI admission seam; refinements tighten the existing subspec without exceeding atomic scope.