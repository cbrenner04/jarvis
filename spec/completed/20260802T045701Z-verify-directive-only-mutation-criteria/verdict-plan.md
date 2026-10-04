1. Add coverage for a ticked directive-selected criterion with no linked `// @mutate` directive, proving it is refused as hollow. This verifies that broadening selection cannot bypass the existing resolution contract.

2. Add directive-marker coverage for unticked and human-only criteria, proving both remain excluded. This protects the required “ticked non-human” condition, including against boolean-precedence regressions.

3. Align acceptance wording with observable test boundaries. If verifier tests only return `caught`/`hollow`, state those classifications; any claim about completion being accepted/refused must cite completion-boundary coverage.

4. Clarify the marker contract in tests and docs: selection occurs when criterion text contains the literal, case-sensitive `@mutate` marker, while successful verification still requires a valid linked directive. Avoid wording that implies selection performs stricter directive parsing.

No subspec split is required.
