# Engine tree at repository top level

Relocate `v2/src`, `v2/spec`, and `v2/docs` to `src/`, `spec/`, and `docs/`; retire `v2/` path prefixes and `*:v2` package scripts; align CI scope, guards, lint globs, and operator docs.

Intent-level `bun run test` is satisfied only after subspecs 00 and 01 (00 keeps aggregate-test prose in `AGENTS.md` on the pre-01 baseline).

- [x] [00 — Relocate engine trees and retire `v2` path and script labels](./00-relocate-engine-trees-and-retire-v2-path-prefix.md)
- [x] [01 — Operator documentation and behavior catalog for the top-level layout](./01-operator-documentation-and-behavior-catalog.md)
