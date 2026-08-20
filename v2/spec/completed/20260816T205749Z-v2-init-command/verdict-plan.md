## Required refinements

1. Define agent/profile compatibility. Bootstrap must either produce a roster supported by the selected committed profile or fail before mutation. Readiness must evaluate configured agents, executables on `PATH`, and profile bindings together, with an explicit rule for which configured agents must be runnable given quota-only fallback. Cover every committed profile, including `work` and its `opencode` binding.

2. Enforce the target-repository-root contract before setup writes. Clarify behavior outside a Git worktree and below its top level. Add failing-baseline coverage proving invalid locations cannot mutate config or the repository.

3. Define safe selector syntax. Project names must be safe wherever registry keys influence filesystem paths, and profiles must resolve only as exact enumerated committed-profile names. Invalid separators, traversal forms, and ambiguous names must fail without mutation.

4. Make scaffold containment truthful and testable. Lexical target-directory validation alone does not prevent symlink escape. Require physical containment for scaffold writes, including existing ancestors, or narrow the claimed safety boundary. Sentinels outside the target repository must be impossible.

5. Resolve duplicate project identity. Detect when cwd is already registered under another key and define whether init reuses that key or refuses a differing `--name`; diagnostics must identify both keys. This prevents downstream selection from resolving an older alias unexpectedly.

6. Specify malformed-config handling for every owned path and ancestor, including `agents`, `machineProfile`, `projects`, the selected project, `plan`, `root`, `origin`, and `targetDir`. Invalid existing shapes must fail before mutation rather than being silently replaced, while unrelated valid fields remain preserved.

7. Clarify that an explicit differing `--target-dir` either replaces the selected project’s stored value or is refused. Pin the chosen behavior with regression coverage; omission must continue preserving the existing value.

8. Use the actual workflow target-directory precedence consistently for setup, scaffolding, readiness, and `--check`. If existing routing includes global `modes.plan.targetDir`, it must remain a read-only fallback between the project value and `spec`; reading a preserved legacy key does not violate the prohibition on writing v1 keys.

9. Separate profile selection from configured-state readiness in `--check`. A supplied profile may identify the profile-resolution probe but cannot make a missing `machineProfile` configured. A selector conflicting with stored state must produce an explicit required failure or rejection, never a misleading ready result.

10. Define origin consistency. Readiness must distinguish current-repository origin availability from stored registry origin and report drift as an explicit non-`ok` condition without refreshing the stored value. Setup may still succeed without an origin, followed by the required readiness failure.

11. Define expected failure atomicity for config and scaffold destinations. Pre-existing sentinels must never be overwritten, and anticipated config/scaffold failures must not leave avoidable partial owned state. Preserve the separate decision that a post-setup readiness failure retains successfully written setup state.

12. Stabilize the readiness-report contract enough for operators and tests: fixed check identifiers and order, exactly one single-line result per check, bounded subprocess/daemon probes, and conversion of exceptions, timeouts, and multiline diagnostics into the corresponding result line. Exact explanatory prose need not be frozen.

13. Split the oversized setup subspec into independently implementable and testable replacements covering machine/profile bootstrap, project registration, and target-directory scaffolding. Split readiness evaluation/rendering from `--check` parsing and read-only selector behavior. Every original task, documentation obligation, acceptance outcome, failing-baseline test, and mutation checkpoint must appear exactly once across the replacements, and every replacement must be linked from `index.md`.

14. Preserve independent sequencing: pre-dispatch subspecs must be verifiable through handler-level injected tests, while public `jarvis init` invocation, top-level help, and routing remain owned by the final dispatch subspec.

15. Require the repository-mandated verification scope. The final subspec touches root tooling documentation through `README.md`, so it must require unscoped `bun run typecheck` and full `bun run test`; earlier replacements should retain the v2 and integration scopes appropriate to their changed files.
