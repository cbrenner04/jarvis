1. External recovery must use the canonical absolute spec path persisted by external write steps. Recovery must match the real daemon lineage; add coverage through the production recovery handler. This is required by subspecs `00` and `02`.

2. Enforce realpath containment for every linked external subspec before reading or routing it. In-tree symlinks escaping `specReadRoot` must be rejected; lexical containment alone violates the symlink-safety and external-read-root contracts.

3. Align durable docs with recovery behavior: a complete tree may contact the daemon solely to probe recoverable failed lineage, then must return `implement.already_complete` before workflow loading, materialization, agent invocation, or run-row creation when none is admitted. Remove unconditional “before daemon contact” claims.

4. Match `planSource` publication semantics exactly. External admission must require literal `git === false` or `plan.commit === false`; other falsey values must not qualify.

5. Limit stale-reset’s landed-criteria exemption specifically to admitted external plan specs. A blanket exemption for every absolute `specPath` is broader than the specified behavior and risks bypassing safety checks for future in-repo workflows.
