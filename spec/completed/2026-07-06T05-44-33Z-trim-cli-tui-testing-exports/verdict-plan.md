## Verdict: required refinements

### 1. Remove false prerequisite gate
Drop `## Prerequisites` from the intent and do not add one to the subspec. Seed 01 is docs-only; in-process daemon-test defaults are seed 03. This trim is a static import audit plus `export` removal and has no dependency on either.

### 2. Resolve seed-02 overlap (blocking)
Seed 02 (`v2-dead-weight-purge`) lists the same eight symbols plus ~30 more in overlapping files. Record an explicit ordering outcome in the spec (or index-level note if that is where cross-spec coordination lives):
- **Land this spec first** and seed 02 excludes this symbol subset, or
- **Close this spec** and let seed 02 own the slice, or
- **Merge** into a single run.

Without one of these, parallel implementation will conflict or duplicate work.

### 3. Disambiguate preservation-test AC paths
Prefix cited tests with `v2/src/` (e.g. `v2/src/cli.test.ts`, not bare `cli.test.ts`). `v1/test/cli.test.ts` exists; ambiguous paths allow false satisfaction.

### 4. Anchor the structural deliverable (AC #1)
AC #1 (symbols not exported) is the primary contract; cited tests do not import those symbols and cannot prove export removal. Require one of:
- A lightweight automated guard in acceptance criteria (compile-time import failure or scoped export audit), or
- An explicit decision that AC #1 is honor-system structural verification, with patch-agent tick discipline as the only enforcement.

Leaving AC #1 unanchored lets an implementer pass all tests without shipping the deliverable.

### 5. Reword decision on TUI types
Replace “module-internal” / “stay internal unless referenced outside `tui/`” with: remove nominal `export` on listed symbols; structural exposure via exported function/class return types is unchanged. De-exporting `TuiDaemonHealthResult` et al. does not hide shapes already on `TuiDaemonClient` signatures; decision #4 already preserves `createTuiDaemonRpcTransport`.

### 6. Name files in negative AC (#2)
Replace “scoped modules” with the five task files: `v2/src/cli.ts`, `v2/src/config/agent-model-config.ts`, `v2/src/testing/bindings.ts`, `v2/src/tui/tui-daemon-client.ts`, `v2/src/tui/tui-daemon-rpc-transport.ts`. Intro’s `v2/src/tui/` grouping must not be read as permission to edit all of `tui/`.

### 7. Optional (non-blocking)
- Task bullet to re-audit imports before editing (mitigates drift between spec merge and run).
- Decision waiving doc-comment edits unless compile/lint requires them.

### No refinement required
- Docs waiver (internal visibility trim; no operator-facing change).
- `test:integration:v2` in verification (consistent with intent and v2 touch scope).
- Single subspec shape (right-sized for one atomic change).
- De-export-not-delete decision for in-file-referenced symbols.
- `createTuiDaemonRpcTransport` exemption (prevents drive-by trimming).
