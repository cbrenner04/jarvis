1. Split the work into independently testable admission-API and CLI-adapter slices. Assign every original task, acceptance outcome, and documentation update exactly once across the replacements, and link every replacement from `index.md`. Remove duplicated tasks and ensure each subspec’s acceptance criteria verify its own executable work.

2. Rename the “Daemon” boundary to reflect client-side admission and explicitly exclude daemon-handler changes. The API is presentation/terminal-I/O-free, not “non-IO,” because it performs filesystem and IPC work.

3. Define the reusable typed contract: success discrimination and pipeline ID, named pre-admission failures with operator-detail semantics, and the handling of configuration exceptions, daemon refusal, malformed success responses, transport failures, and connection lifecycle failures. This contract is central to reuse without string parsing.

4. Clarify connection ownership so “failure before daemon contact” is enforceable. Acceptance coverage must prove pre-admission failures neither connect nor dispatch, while preserving existing daemon connection/auto-start behavior.

5. Strengthen direct API coverage to verify the resolved pipeline definition and full request context, including `cwd`, the exclusive seed value, configuration path, and registry snapshot—not only the returned ID and request count. Successful admission must issue exactly one `pipeline_start` and no `pipeline_wait`.

6. State whose `cwd` governs seed resolution and cite the exact existing seed-path preservation tests covering relative paths, file/readability checks, containment, symlink escape, and original seed value preservation.

7. Decide whether seed exclusivity is compile-time-only or also runtime-validated at the reusable boundary. Preserve CLI neither/both refusal behavior; if runtime guards are added, require direct negative tests and mutation checkpoints proving no daemon contact.

8. Add explicit preservation or regression coverage for daemon refusal, malformed `pipeline_start` success, attached abort, transport/lifecycle behavior, CLI rendering, pipeline-ID output, detach behavior, terminal JSON, and exit selection. The intent requires the entire operator-visible CLI contract to remain unchanged.

9. Require a narrow admission dependency surface independent of argv parsing, `Io`, formatting, detach state, and broad CLI dependencies. This is necessary for a future TUI caller without requiring TUI integration in this spec.

10. Keep mutation requirements attached to the actual extracted guards: every added or moved rejection condition needs a valid `// @mutate` directive in its pinning test, and negative cases must prove refused admission causes no connection or RPC.

11. Place both documentation updates with the slice whose behavior they describe. No subspec should have an empty documentation section or code tasks that can be completed through documentation-only acceptance criteria.
