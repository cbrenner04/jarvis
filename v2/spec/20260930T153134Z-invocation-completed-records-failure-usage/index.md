# invocation_completed rows carry usage for non-ok exits

Owns the non-ok `InvocationResult` settlement fields and the `createInvocationCompletedRecord` mapper, proven with injected bindings. Binding-side recovery (claude/cursor/opencode/codex) is owned by sibling intent `agent-bindings-recover-usage-on-failed-settlement`, which depends on this one.

- [ ] [00 - Non-ok invocation results carry settlement on invocation_completed rows](./00-non-ok-settlement-on-invocation-completed-rows.md)
