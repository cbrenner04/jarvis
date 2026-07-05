- Separate command-boundary parsing from reused config validation. The spec must explicitly cover CSV-specific invalid forms, including empty segments and `agent:model` tokens, instead of implying they fall out of the existing machine-config loader. This is necessary because the intent requires bare agent names only, while the loader contract starts after parsing into an array.

- Define behavior when `~/.jarvis/v2.json` exists but is not a valid machine-config object. The spec must say whether `set-agents` refuses to proceed and preserves the broken file, or overwrites it. This is an observable operator-facing choice on a hand-editable file and should not be left implicit.

- Extend the no-write-on-invalid-input contract to the bootstrap case. The spec already protects existing file contents on invalid input; it also needs to state that invalid input does not create `~/.jarvis/` or `v2.json` when they were previously absent. This follows from the intent’s non-zero / clear-error requirement and keeps failure behavior reviewable.

- Pin the durable success/failure output shape enough for docs and tests. The spec need not over-design wording, but it must define what successful stdout reports and what failure stderr must make clear so operator-facing semantics are stable and testable.

- State the persisted-effect behavior directly. Beyond preserving `--agents` override precedence, the spec should explicitly cover that a later run without `--agents` uses the newly persisted machine order. That is the core observable outcome of the feature and should appear as behavior, not inference.

- Tighten the architecture-doc outcome to remove command-surface ambiguity. The spec should require `v2/docs/v2-architecture.md` to clearly point to the machine-agent show/edit surface, including the bare `jarvis config set-agents ...` command, while leaving detailed semantics in `v2/docs/agent-model-config.md`. This matches the intent’s doc-boundary requirement without expanding architecture prose.
