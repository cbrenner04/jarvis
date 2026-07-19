---
name: cleanup-abandon-rejects-dry-run-with-abandon
---

# `jarvis cleanup --abandon <name> --dry-run` always fails

## Problem

`runCleanupCliCommand` (`v2/src/commands/cleanup-cli.ts`) parses `--dry-run` and
`--abandon <name>` with `if (argv[0] === "--dry-run") ... else if (argv[0] ===
"--abandon" && argv[1])` — an `if`/`else if`, so only one flag at position 0 is
ever consumed. Whichever flag comes second lands in the leftover `args` slice,
which then fails the `args.length > 0` check and prints usage, exit 1.

This breaks the documented usage exactly: both the v2 runbook
(`v2/docs/operator-runbook.md` § Recovery) and `CLEANUP_USAGE` show
`jarvis cleanup --abandon <name> --dry-run` as the preview form. It has never
worked in either flag order. Reproduced live, 2026-07-19: every
`--abandon <name> --dry-run` / `--dry-run --abandon <name>` / `--abandon=<name>
--dry-run` variant printed the generic usage error with no indication which
combination failed.

## Decisions

- Parse `--dry-run` and `--abandon <name>` independently (each may appear, in
  either order); rules out the current positional `if`/`else if` on `argv[0]`
  only.
- Preserve existing single-flag and no-flag behavior; rules out changing
  `runCleanupCommand`/`runAbandonCommand` themselves.
- Any other/unrecognized argument still prints `CLEANUP_USAGE` and exits 1;
  rules out silently accepting unknown flags.

## Acceptance criteria

- [ ] `jarvis cleanup --abandon <name> --dry-run` previews without prompting or
      mutating (matches documented usage).
- [ ] `jarvis cleanup --dry-run --abandon <name>` behaves identically
      (flag-order independence).
- [ ] `jarvis cleanup --abandon <name>` (no `--dry-run`) and
      `jarvis cleanup --dry-run` (no `--abandon`) keep their current behavior.
- [ ] A regression test in `v2/src/commands/cleanup-cli.test.ts` (or equivalent)
      drives both flag orders through `runCleanupCliCommand` and fails against
      the pre-fix `if`/`else if` parser.

## Documentation updates

None — this restores already-documented behavior; no doc claims change.
