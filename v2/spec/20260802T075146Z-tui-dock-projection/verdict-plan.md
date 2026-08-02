- Define RPC feedback end to end: which recoverable monitor failures populate the last-error state, whether stale data remains visible, and when later success clears or replaces the error. Clarify that command-result production is deferred, and define result/error display precedence if both remain in scope.

- Guarantee four physical terminal rows, not merely four projected strings or Ink children. Every row must be control/newline-safe and bounded to display width so status, input, continuation, and hints cannot wrap in split or stacked layouts. Require rendered-output evidence.

- Specify deterministic command-state semantics: cursor units and clamping, visible-cursor behavior, prompt-width accounting, and normalization of tabs, newlines, tiny widths, and over-wide graphemes. Cover exact fit, one-column overflow, longer-than-two-row input, and cursor positions at start, middle, and end while proving state is unchanged.

- Fully define the hints row. Pin global controls plus expansion/kill eligibility for absent, terminal, non-live, and otherwise non-actionable selections. Command focus must have defined copy and must not create a state where tree hints disappear while tree actions still execute.

- Clarify invocation identity as distinct from selected/discovered daemon identity. Pin the displayed digest format, its source, machine-profile resolution behavior, and failure handling so identity cannot silently change through discovery.

- Pin active-pipeline semantics for duplicate and contradictory terminal/non-terminal observations, plus retained stale snapshots after refresh failure. Document these semantics because they directly affect the required status count.

- Split subspec 01 into independently testable module-boundary slices for command identity, monitor state/error lifecycle, and Ink projection/layout integration. Preserve every original task and acceptance outcome exactly once across replacements, link every replacement from `index.md`, and keep operator documentation with the final visible behavior.

- Require `bun run test:integration:v2` for every executable-code subspec touching `v2/**`, alongside typecheck and `test:v2`, per repository verification rules.

- Strengthen mutation criteria to cover every added or modified executable guard in each slice, including guards suppressing effects. Each must have a valid `// @mutate` directive against the real source condition and a test that turns red when inverted; production mutation hooks remain prohibited.
