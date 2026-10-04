# 00 — Behavior-catalog tag vocabulary

## Problem

`docs/v1-behaviors.md` uses `[v2 …]` tags and framing prose where `v2` only labels the live harness, not the frozen `v1/` tree.

## Decisions

- Replace every `[v2 …]` catalog tag by substituting the prefix `v2` with `harness` inside the brackets, leaving the remainder of each tag byte-identical — rules out per-entry editorial reclassification (e.g. merging `divergence` into `behavior change`).
- Map `[v2-only]` → `[harness-only]` via the same prefix rule — rules out renaming that distinction to `additive`.
- Retain `docs/v1-behaviors.md` filename — rules out folding the catalog into a generically named file.
- Retitle the catalog to `# v1 behavior parity catalog` and rewrite its intro/blockquote so live entries are `[harness …]` / harness prose while `v1` still names the frozen generation — rules out keeping a `v1+v2` title.
- Apply the same bracket-prefix substitution in `docs/test-writing.md` wherever it instructs authors to use `[v2 …]` tags — rules out leaving a second tag dialect in durable guidance.

### Mechanical tag mapping (complete)

| Source tag | Target tag |
| --- | --- |
| `[v2 additive]` | `[harness additive]` |
| `[v2 additive update]` | `[harness additive update]` |
| `[v2 additive, superseded by`specs`]` | `[harness additive, superseded by`specs`]` |
| `[v2 behavior change]` | `[harness behavior change]` |
| `[v2 behavior change, 2026-10-02]` | `[harness behavior change, 2026-10-02]` |
| `[v2 breaking change]` | `[harness breaking change]` |
| `[v2 by design]` | `[harness by design]` |
| `[v2 change]` | `[harness change]` |
| `[v2 difference]` | `[harness difference]` |
| `[v2 divergence]` | `[harness divergence]` |
| `[v2 implement publication]` | `[harness implement publication]` |
| `[v2 implement publication change]` | `[harness implement publication change]` |
| `[v2 parity added]` | `[harness parity added]` |
| `[v2 ported]` | `[harness ported]` |
| `[v2-only]` | `[harness-only]` |
| `[v2 …]` (blockquote/meta) | `[harness …]` |

## Tasks

- [ ] Apply the mapping table to every `[v2` tag in `docs/v1-behaviors.md` (longest/most-specific tags first where prefixes overlap).
- [ ] Update catalog title, blockquote, section headings, and body sentences that call the live engine `v2` when they mean the harness (preserve `v1` / `jarvis1` frozen-generation references).
- [ ] Update `docs/test-writing.md` tag examples to the harness vocabulary.

## Acceptance criteria

- [x] `rg '\[v2' docs/v1-behaviors.md docs/test-writing.md` prints no matches (reachable on main today via ~350 catalog tags).
- [x] `bun run lint:md` passes.

## Documentation updates

- `docs/v1-behaviors.md`
- `docs/test-writing.md`
