- Split the oversized subspec into independently testable builder-resolution, review-workspace execution/isolation, and deferred-landing/publication/error slices; link all replacements from `index.md` and retain every existing task and acceptance outcome exactly once.

- Require one external-worktree resolution result to supply review `cwd`, verdict path, staging path, and landing workspace; this prevents mixed operator/worktree paths.

- Define observable landing diagnostics: `invocation_failure` must expose and persist a named landing cause suitable for retry diagnosis, rather than only retaining a transient message.

- Preserve landing-only resume semantics after review succeeds: retry deferred landing without rerunning critic or actuator, including compatible handling of already-staged/verdict/checkpoint state where resumability exists.

- Require git-disabled runs to durably land reviewed output at their configured local destination while performing no Git/GitHub publication; “no publication” alone does not prove completion.

- Distinguish durable landing from Git commit/push/PR publication, and require every applicable review, enforcement, verdict, landing, and publication operation to use the resolved split workspace; clean operator-checkout assertions alone do not prove cwd isolation.

- Add `v2/docs/v1-behaviors.md` to the required documentation updates alongside the two named workflow docs; this changes existing behavior and the spec guidance requires parity-catalog alignment.
