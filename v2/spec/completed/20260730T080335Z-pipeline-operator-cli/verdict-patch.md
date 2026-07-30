Reviewing implementation and repo conventions to issue an outcome-focused verdict.
## Verdict: required outcomes

1. **Register `pipeline start` in help-flag parser parity**  
   `PIPELINE_START_PARSE_ARG_OPTIONS` and `PIPELINE_START_HELP_FLAGS` exist, but `pipeline start` is not in the guarded parity paths. Every other flag-bearing CLI surface in this family is parity-guarded so parser-accepted flags cannot drift from help metadata without a failing test. `pipeline start` must be included so future flag changes are mechanically blocked the same way.

2. **Reject whitespace-only pipeline IDs before daemon connect**  
   The list/wait subspec treats missing/empty pipeline ID as a usage error before connect. Only `length === 0` is rejected today; whitespace-only operands reach the daemon. Whitespace-only IDs must be refused as usage errors (same stderr/exit pattern as missing ID) so “empty” ID misuse is caught client-side.

3. **Cover documented seed-path pre-admission failures in tests**  
   `write-behavior.md` lists seed path errors among pre-admission failures; `resolvePipelineSeed` handles absolute path, non-file, and read failures. No tests exercise those paths. Tests must prove each documented seed-path failure exits non-zero with stderr detail and no pipeline ID on stdout, with no daemon contact.

4. **Clarify list timing in operator docs**  
   `write-behavior.md` and `operator-runbook.md` state that `pipeline list` returns within **500ms** as if the CLI enforces that bound. The CLI issues one non-blocking `pipeline_list` RPC; the timing guarantee depends on daemon/store snapshot behavior (same bound as `daemon-pipeline-observation.test.ts`). Docs must distinguish CLI behavior (single snapshot RPC, no client polling) from the daemon timing contract so operators are not told the CLI alone enforces a 500ms ceiling.

**Rationale:** Core subspec acceptance criteria are met—pre-admission ordering, detach/attach wait semantics, list/wait projection, guard inversions, help, dispatch coverage, and abort contracts are implemented and tested. The four outcomes above are parity convention, a spec edge case, coverage for documented operator behavior, and doc accuracy for operator-facing semantics. They are polish, not core contract gaps; no other adversary findings require actuator action (cwd-based seed, empty `--seed-text`, post-admission wait failure stdout, invert-flag test seams, mock-IPC test strategy, and `pipeline: null` stderr shape are acceptable or out of scope for this patch).