---
name: self-parsing-structural-tests-can-bind-to-their-own-fixtures
---

# A structural test that parses its own source can silently bind to a fixture in that same file

## Problem

The structural-invariant tests locate their inventories by regex over **their own source text**. Two properties of that pattern combine badly:

1. The inventory constant is never read as a value, so lint correctly classifies it as unused. `biome check --write --unsafe` — which the ready-gate autofix runs on changed paths — renames it with an `_` prefix.
2. The same file usually contains a **fixture** declaring a constant of the same name and shape, to test the parser itself.

After the rename, the parser's regex no longer matches the real declaration and its first match falls through to the fixture. The parser's two loud guards — "anchors not found" and "anchors array is empty" — **both stay silent**, because a fixture is a well-formed non-empty inventory. The test keeps passing against a smaller, wrong inventory.

This is not a hypothetical ordering concern: the fixture sits *later* in the file than the real constant, so the fallback only becomes reachable once the real declaration stops matching — which is exactly what the autofix causes.

## Evidence (2026-09-06, exact)

`v2/src/execution/workflow-runner-resume-inventory.test.ts`, during the execution-loop anchors lane. Autofix renamed `RESUME_PATH_INVENTORY_ANCHORS` to `_RESUME_PATH_INVENTORY_ANCHORS`. Measured against the resulting file:

| Regex | Matched at | Anchors parsed |
| --- | --- | --- |
| pre-fix (`const\s+(?:RESUME_PATH_INVENTORY_ANCHORS\|SOURCE_BUCKETS)`) | line 529 — **a test fixture** | **4** |
| accepting the prefix (`const\s+_?(?:…)`) | line 28 — the real inventory | **6** |

The parity test body is `for (const anchor of anchors) { expect(...) }`, so two real anchors would have gone unchecked indefinitely with a green suite and no diagnostic.

Repaired in-lane by accepting the optional prefix. The general hazard is unaddressed.

## Why this is systemic

"Structural test parses its own source" is the pattern the whole `*-anchors` initiative rests on — three specs, roughly 28 subspecs, across cli, daemon, and execution-loop surfaces. Every inventory constant in that pattern is lint-unused by construction and therefore an autofix rename target, and every such file that tests its own parser contains a same-shaped fixture. The failure is silent by default because the existing guards only catch *absent* and *empty*, not *wrong*.

Related but distinct: [[generalize-production-test-seam-guard]] covers production/test seam divergence; this is a locator binding to the wrong declaration inside one file.

## Decisions

- A source-parsing locator binds to a declaration it can prove is the module's own inventory, not merely the first regex match; rules out first-match-wins over a file that also contains fixtures of the same shape.
- Fixtures used to test a locator are placed where the locator cannot select them — a separate fixture module, or a form the locator's pattern cannot match; rules out a fixture and the real inventory being indistinguishable to the parser.
- The locator fails loudly when it resolves an inventory that is not the declaration it was pointed at, rather than only on absent/empty; rules out "wrong but well-formed" passing the existing guards.
- Inventory constants consumed only by source parsing carry an explicit marker naming that contract, so a reader and a lint autofix both know why the value appears unused; rules out an incidental `_` rename silently changing what the locator matches.
- Rules out solving this by forbidding the autofix: the rename was correct, and the locator is what must be robust.

## Acceptance criteria

- [ ] A test proves a locator resolves the module's real inventory when the file also contains a same-shaped fixture declaration; it fails against a first-match-wins regex.
- [ ] A test proves the locator resolves the real inventory whether or not the constant carries the lint `_` prefix; it fails against a pattern requiring the unprefixed spelling.
- [ ] A test proves the locator raises a named failure when it resolves a declaration other than the one it was pointed at, rather than returning the fixture's contents; it fails against the current absent/empty-only guards.
- [ ] Every existing self-parsing locator in the `*-anchors` corpus is audited against these cases, and each parses its real inventory (asserted by expected anchor count, not by non-emptiness).
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — the self-parsing locator contract: fixture placement, prefix tolerance, and why non-emptiness is not proof the right inventory was found.
- `v2/docs/operator-runbook.md` — § Gate trust: a green structural suite can be validating a fixture; check the parsed anchor count.
