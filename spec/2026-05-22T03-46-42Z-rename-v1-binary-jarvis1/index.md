# Rename v1 binary from `jarvis` to `jarvis1`

The implementation order matters here: move the executable entrypoint first, then rename runtime strings, then repair and verify tests, and finally update docs.

- [x] [00 - Binary shim and package metadata](./00-binary-shim-and-package-metadata.md)
- [x] [01 - v1 source string updates](./01-v1-source-string-updates.md)
- [x] [02 - Test updates and command-boundary verification](./02-test-updates.md)
- [ ] [03 - Documentation updates](./03-documentation-updates.md)
