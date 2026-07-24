Verifying implementation and docs against the spec before issuing the verdict.


## Verdict — required outcomes

1. **Correct the subspec decision on `jarvis --version --help`.**  
   In `00-help-flag-alias.md`, the line that says `--version --help` “stays a `--version` invocation” is wrong: with the first-`-` token rule, the alias does not run, and the lone-`--version` fast path does not apply either, so behavior is ordinary top-level dispatch (unknown `--version` at argv[0]), not version output and not help. The decision must describe that the alias simply does not apply when the first `-` token is not `--help`/`-h`, without implying version precedence or a dedicated branch.

2. **Fix `v2/docs/v1-behaviors.md` prose formatting on the updated bullet.**  
   Restore normal spacing (`Top-level`, `jarvis help` and, `Sources:`) so the behavior-catalog entry is readable and matches surrounding style. Content is fine; typography is not.

3. **Make the guard-inversion acceptance criterion true or stop claiming it.**  
   The subspec is ticked saying that inverting each *new* guard (exact `--help`/`-h` tokens, first-`-` token only, longest tree-prefix truncation) turns at least one test red. The suite has positive coverage only—no mutation or equivalent tests—so that criterion is not satisfied while checked. Either add automated tests that fail if any of those three behaviors is removed, or revise/uncheck that criterion so the spec does not assert automation that does not exist.

4. **Strengthen the seed-text integration test to match the criterion.**  
   The AC requires that `run workflow intent --seed-text "<prose containing --help>"` still runs the command and does not render help. The current integration test only asserts `stdout !==` help stdout, which a non-help failure could satisfy. The test must demonstrate that the help alias is not taken (e.g. alias resolution is absent for that argv, and/or exit/stderr/stdout are not those of a help render), consistent with the unit test on first-flag position.

### Rationale (summary)

Behavior and the main acceptance cases align with the refined subspec: intercept before dispatch, first-flag rule, truncation via the same unknown-segment walk as help, docs in `write-behavior.md`, and tree-walk plus off-tree cases. Remaining gaps are **contract honesty** (misleading `--version --help` wording, a ticked AC without tests) and **one weak test** against a explicit AC—not core alias logic.

### Not required for merge (actuator may skip)

- **`jarvis help <cmd> --help` vs `jarvis <cmd> --help`:** Odd but in scope of tree-shaped paths; not in AC. Optional doc sentence only if you want operator clarity.
- **`run nope --help`:** Follows the same truncation rule as `tui log <id> --help`; a small resolver unit test would be cheap regression coverage but is not a separate AC.
- **`intent.md` drift** (“anywhere in the path”): Hygiene; `00-help-flag-alias.md` is the implemented contract.
- **`--`, trailing args after `--help`, `--help=foo` via `main()`:** Out of spec; no required change.
- **JSDoc on `resolveHelpFlagAlias`:** Export contract is largely covered by tests and `write-behavior.md`; inline doc only if you want a one-liner per documentation-standard tiering—not blocking.