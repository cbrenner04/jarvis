- Reject `--yes`/`-y` combined with `--dry-run` until semantics are specified and tested. Accepting it silently pins behavior the spec explicitly deferred.

- Make the non-TTY fail-closed regression deterministic and independent of the test runner’s stdin. It must never prompt or block under an interactive test invocation.

- Treat `-y` as an option, not an `--abandon` name. `--abandon -y` must fail as a missing operand, consistently with `--abandon --yes`, with regression coverage.

- Correct the acceptance record’s baseline-failure claim. The fail-closed non-interactive behavior predates this patch and should pass on baseline; only the new `--yes` apply regressions are expected to fail there.
