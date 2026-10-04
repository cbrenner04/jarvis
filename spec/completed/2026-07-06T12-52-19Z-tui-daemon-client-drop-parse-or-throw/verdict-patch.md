## Verdict

**Required outcome:** Update the "Documentation updates" section of `00-drop-parse-or-throw.md` to accurately describe the tradeoff instead of claiming no validation is lost.

**Rationale:** The `list()`/`wait()` casts (`as DaemonListResult`/`as WaitRunCompletionResult`) erase the `T | undefined` branch that `parseListRuns`/`parseWaitCompletion` can return. This is correct per the spec's scope decision — dropping the wrapper at confirmed envelope-thin sites is the intended behavior, consistent with the branch's envelope-trust precedent (#1128, #1129). But it does change the failure mode: a malformed envelope at these two call sites previously surfaced as a typed `TuiDaemonConnectionError`; it now silently flows downstream as `undefined` typed as valid data, degrading to an unrelated `TypeError` at first dereference. The current doc line ("no validation is lost") is factually wrong about this and must be corrected to state the tradeoff explicitly, so the spec accurately documents what changed rather than asserting nothing did.

**No code changes required** — the implementation matches the spec's scope decisions correctly.