1. Make wrapping Unicode-safe and lossless. Do not split combining or ZWJ grapheme clusters; preserve tones and content order. Reconcile the impossible one-column requirement for width-two graphemes by explicitly defining either a two-column minimum or atomic-grapheme overflow, then align code, tests, spec, and durable docs.

2. Make mutation coverage truthful and complete. Every production guard introduced by wrapping—including overflow, segment handling, and final flushing—must have a uniquely targeted mutation pin, or the implementation/criterion must be revised so the stated guard delta is accurate.

3. Add a mutation checkpoint that specifically reintroduces `waitState`-derived right-pane detail and makes the absence regression fail. The steering-feedback mutation covers retained feedback, not the required prohibition on wait-derived diagnostics.

4. Align durable documentation with selection-keyed behavior:

   - Pipeline: pipeline context and stage roll-up.
   - Stage: that context followed by the selected stage record.
   - Attributed run: that context followed by selected durable-run detail.
   - Unattributed run: selected durable-run detail only.

   Update the TUI brief, operator runbook, and v1-parity catalog so none imply invented pipeline ancestry or selectable queue rows.
