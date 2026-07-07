Verdict: required refinements

1. **Doc-scope gap (upheld).** `v2/docs/agent-model-config.md` and `v2/docs/v2-architecture.md` both currently document `--agents` and its precedence over machine config as shipped CLI behavior; these statements become false once the flag is dropped. Add both files to the task checklist and the Documentation updates section, alongside `write-behavior.md`, so all three are corrected in the same change.

2. **Broken-config recourse (upheld, scope it precisely).** Today `--agents` lets an invocation bypass a broken `~/.jarvis/config.json` (load errors surface as a clean `{ok:false, message}`, not a crash). Dropping the flag removes that escape hatch — every write/run-start invocation now depends on `loadMachineConfig` succeeding. Add one Decisions-line acknowledging this traded-away bypass; no redesign or new error-handling path is required.

3. **Dead branch after option removal (upheld, minor).** Once `agents` leaves the CLI option map, the `agents !== undefined && parseAgents(agents, []) === null` check in `buildWriteLoopInputFromCliValues` becomes unreachable. Fold explicit removal of this branch into the existing task item about `parseAgents`'s raw-CSV branch, so it doesn't survive as dead code.

4. **v1-behaviors.md exemption (upheld, needs an explicit line).** Per spec guidance, changes to existing functionality default to updating `v2/docs/v1-behaviors.md`. Add one Decisions line stating why this doesn't apply here: `--agents` is a v2-only interim CLI surface with no v1 analogue (v1's `--agent` is a distinct, repeatable per-invocation flag), so no v1-parity catalog entry is needed.

5. **TUI-caller speculation — declined.** No refinement needed; the spec's claim that the CLI flag is the sole caller is accurate for present code, and pre-committing future TUI semantics is out of scope for this subspec.