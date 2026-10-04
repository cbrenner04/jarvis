1. Define the supported `start` grammar as either full CLI parity or an explicit canonical TUI subset. Pin flag order, `--seed=value`, duplicate flags, `--`, unknown options, and flag-looking values. Seed exclusivity cannot be tested precisely while these inputs are unspecified.

2. Require `expand` and `collapse` to accept no operands or options, with a named failure for extras. The current arity restriction only clearly governs `start`.

3. Enumerate stable symbolic error discriminants for all required error families while leaving display text and incidental fields deferred. Exported named errors are part of the typed parser contract.

4. Establish deterministic error precedence: tokenizer errors before verb classification, validation ordering within `start`, and handling of unavailable verbs with operands. Precise errors require predictable outcomes for inputs violating multiple rules.

5. Pin remaining tokenizer behavior for trailing backslashes, unsupported escapes, empty quoted values, and adjacent quoted/unquoted segments. Clarify that delimiters and escape markers are removed while escaped literal whitespace, quotes, and backslashes are preserved.

6. State whether every successfully tokenized unavailable verb returns its CLI-equivalent error regardless of trailing operands, or whether arity/option validation takes precedence.

7. Align mutation acceptance with the harness contract: each added or modified conditional guard needs a unique valid directive, normal production behavior must reject invalid input, and applying each mutation must make the scoped suite fail. Do not require a particular individual test to fail or use ambiguous “suppressed commands” wording.

8. Keep this as one subspec. Tokenization, parsing, typed results, and focused tests constitute one atomic, independently testable language boundary.
