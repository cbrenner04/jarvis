# Sweep dead `@mutate` directives

No code parses `// @mutate` any more (the checkpoint verifier was retired; only the `@mutate-equivalent` escape hatch is read), yet 729 standalone directive lines sit across 84 test files and six more in `shared/structural-test-locator.ts`, and agents keep copying them forward. Delete them in one coverage-neutral sweep.

- [x] [00 - Delete every dead directive line](./00-delete-every-dead-directive-line.md)
