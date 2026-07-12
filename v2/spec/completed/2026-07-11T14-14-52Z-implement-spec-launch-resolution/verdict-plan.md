- Add `v2/docs/v1-behaviors.md` to required documentation updates: this changes existing launch behavior, and the parity catalog is mandatory for such changes.

- Define index recognition as a resolved spec path named `index.md`, not parsed checklist content. This keeps CLI behavior stable and non-content-dependent.

- Specify path semantics: resolve relative `--spec` from invocation cwd before project lookup and branch derivation; use the resolved path’s parent basename for the default branch; translate spec and index-artifact paths for the implementation worktree. This prevents source-checkout execution and path-spelling variance.

- Specify failure behavior for a spec outside registered project roots: fail before daemon contact with a spec-path-specific error. Cwd-based resolution must not remain a fallback.

- Pin non-index behavior enough to keep the command valid: index specs may omit `--artifact` and ignore a supplied value; non-index omission must remain rejected or required until a caller defines compatibility.

- Add coverage for required `--spec` and `--base`, optional `--branch`, and index-only optional `--artifact`, including project identity/root and worktree-relative workflow inputs.

- State the workflow-specific monitoring limitation introduced by the new command in both operator docs and an acceptance criterion, since the intent explicitly requires it.
