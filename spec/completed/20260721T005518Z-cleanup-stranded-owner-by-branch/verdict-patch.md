- **Fix durable spec identity resolution.** Stranded archival must recognize production run records whose `specPath` is project-relative, while safely supporting existing absolute forms. Add production-shaped coverage. Otherwise normal implementation runs incorrectly report “no durable implementation branch,” violating branch-keyed ownership criteria.

- **Prove project isolation independently.** Add a regression where the matching branch exists only in another registered project and the artifact remains eligible for archival. The current test is masked by a same-project owner.

- **Preserve retirement error semantics.** Detached `HEAD` must remain discoverable as unresolved so stranded archival fails closed, but genuine branch-resolution failures must not be silently converted into skipped retirement candidates. The spec explicitly excludes changes to retirement archival gates.
