# 03 - Legacy absolute-path back-compat

## Problem

Existing specs in the wild have `repo: /Users/<name>/Work/<repo>` lines.
Operators must be able to keep running them indefinitely without edits.

## Decisions

- An absolute-path `repo:` value is honored only when it equals a registered
  project's `root` (string equality after path normalization, e.g. trailing
  slash removal). When it matches, that project is used and resolution
  short-circuits before steps 1-5 in subspec 01.
- An absolute-path `repo:` that does **not** match any registered project's
  `root` is silently ignored. The resolution flow from subspec 01 then runs
  as if the line were absent. No deprecation warning is printed.
- This branch never persists anything to config and never auto-registers a
  project from the path.
- URL/slug `repo:` values are not affected by this subspec.

## Task Checklist

- [ ] Detect absolute-path `repo:` values and route them through the
  back-compat branch.
- [ ] Tests for: absolute path matching a registered root resolves; absolute
  path with no matching root falls through to URL/location/prompt resolution
  without error.

## Acceptance criteria

- [ ] A spec with `repo: <abs-path>` matching a registered project's `root`
  resolves to that project without consulting any other resolution step.
- [ ] A spec with `repo: <abs-path>` that does not match any registered
  project's `root` is treated as if `repo:` were absent and falls through to
  URL/slug, location, and prompt resolution.
- [ ] No deprecation warning is printed for either case.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` pass.

## Documentation updates

- `docs/spec-guidance.md`: brief note that absolute-path `repo:` remains
  supported when it matches a registered project, and is otherwise ignored.
- `docs/run-loop.md`: short bullet under the resolution order describing the
  legacy short-circuit.
