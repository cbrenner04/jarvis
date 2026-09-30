# Mutation verifier ignores whitespace-only line changes

Formatter reflow of unchanged operator/guard expressions on changed `+` lines currently becomes fresh operator-flip/guard-flip candidates and forces killing-test work the edit never touched. Skip flip-family derivation when hunk-level removed-line token streams already subsume the occurrence; semantic token edits still derive.

- [x] [00 — Hunk-paired whitespace skip for operator-flip and guard-flip derivation](00-hunk-paired-whitespace-skip-for-flip-candidates.md)
