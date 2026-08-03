- Ensure production Ctrl-C reliably closes the monitor and resolves `runTuiEntry`; Ink must not bypass the configured quit control and leave timers or promises alive.

- Keep `commandCursor` a valid grapheme index after every insertion, including text that merges with adjacent graphemes such as combining marks. Add cross-boundary regression coverage.

- Distinguish keyboard Enter from pasted CR/LF. Enter must submit once while focused; pasted line breaks must be removed without submission or newline insertion.

- Complete mutation coverage for all new routing guards, including Ctrl/Meta suppression, sanitized nonempty insertion, and `:`/`/` activation. Each unique directive must target production logic and make its named regression fail.

These outcomes are required by the editor-state invariant, input-routing contract, documented paste behavior, and checked mutation acceptance criteria.
