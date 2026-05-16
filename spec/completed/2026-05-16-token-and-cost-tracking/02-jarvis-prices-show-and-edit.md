# 02 — `jarvis prices show` and `edit`

## Problem

The price table from subspec 01 is just a JSON file. Users need a
discoverable way to see what's in it (without `cat`-ing a path they may not
know) and a sanctioned way to manually edit it (for cursor-style models with
no upstream price, or for pinning a row that `jarvis prices update` should
not touch).

This subspec adds the read-only inspection and the manual-edit escape hatch.
The automatic fetch lives in subspec 03.

## Decisions

- **Subcommand surface**: `jarvis prices show` and `jarvis prices edit`.
  The bare `jarvis prices` (no subcommand) prints usage to stderr and exits
  non-zero, matching how other top-level subcommands (`jarvis config`)
  behave for unknown invocations.
- **`show` output format**: human-readable table sorted by model ID. One
  row per model, columns: model ID, input ($/Mtok), output ($/Mtok), cache
  read, cache write, `as_of`, manual flag (`*` if `manual: true`),
  `source_url`. Rates that are `null` render as `—`. No JSON output flag in
  v1; users who want JSON can read `data/prices.json` directly.
- **`edit` editor selection**: `$EDITOR`, falling back to `$VISUAL`,
  falling back to `vi`. Same priority as `git`. If none of those launches
  successfully, exit with a clear error pointing at `data/prices.json`.
- **`edit` validates on save**: after the editor exits 0, re-load the file
  through `loadPrices` from subspec 01. If validation fails, leave the
  user's edits in place (do not revert) and print the validation error
  with the path so they can fix it manually. Exit non-zero.
- **`edit` no-op detection**: if the file is unchanged after the editor
  exits, print `no changes` and exit 0 without re-validating (the
  pre-existing file is already known good).
- **Editor non-zero exit**: treat as cancellation. Leave the file alone,
  print `aborted` to stderr, exit 1. Do not validate.
- **Locking**: no file locking. Concurrent `jarvis prices edit` invocations
  are a user error and not worth defending against; the worst case is one
  edit overwrites another, same as editing any source file by hand.
- **Path resolution**: same mechanism subspec 01 uses for `loadPrices`.
  Both commands operate on the in-repo `data/prices.json` of the running
  jarvis checkout, not on any user-config copy. (There is no user-config
  copy.)

## Behavior

```
$ jarvis prices show
MODEL                INPUT     OUTPUT    CACHE_R   CACHE_W   AS_OF        MANUAL  SOURCE
claude-opus-4-7      $15.00    $75.00    $1.50     $18.75    2026-05-15           https://www.anthropic.com/pricing
claude-sonnet-4-6    $3.00     $15.00    $0.30     $3.75     2026-05-15           https://www.anthropic.com/pricing
cursor-default       —         —         —         —         2026-05-15   *       https://docs.cursor.com/pricing
gpt-5-codex          $1.25     $10.00    —         —         2026-05-15           https://openai.com/api/pricing/
```

Column widths are computed from the data; do not hardcode. Rates print with
two decimals. The header row is uppercase. The `MANUAL` column shows `*`
when `manual: true`, blank otherwise.

```
$ jarvis prices edit
opening data/prices.json in $EDITOR ...
$ # editor exits 0, file changed
validated; saved.

$ jarvis prices edit
opening data/prices.json in $EDITOR ...
$ # editor exits 0, file unchanged
no changes

$ jarvis prices edit
opening data/prices.json in $EDITOR ...
$ # editor exits 1
aborted

$ jarvis prices edit
opening data/prices.json in $EDITOR ...
$ # editor exits 0, file invalid
validation failed: data/prices.json: row "claude-opus-4-7": input_per_mtok must be a non-negative number or null
```

The "opening ..." line goes to stderr so it does not pollute pipelines that
might one day consume `show` output.

## Tasks

- [ ] Add a `jarvis prices` dispatcher in `src/cli.ts` (mirror how
      `jarvis config` dispatches subcommands).
- [ ] Implement `jarvis prices show` in `src/commands/prices-show.ts`.
      Compute column widths from the loaded data; format rates with two
      decimals; render `null` as `—`; print to stdout.
- [ ] Implement `jarvis prices edit` in `src/commands/prices-edit.ts`.
      - Resolve the editor: `$EDITOR` → `$VISUAL` → `vi`.
      - Hash the file contents before launching the editor (SHA-256 over
        bytes is fine; or compare the raw bytes — pick whichever the repo
        already has a helper for, otherwise inline `crypto.createHash`).
      - Launch the editor synchronously with stdio inherited so the user
        sees a normal interactive editor.
      - On editor exit 0:
        - Re-hash; if unchanged, print `no changes` and exit 0.
        - Otherwise re-load via `loadPrices`; on success print
          `validated; saved.`; on failure print the validation error and
          exit 1.
      - On editor exit non-zero: print `aborted` to stderr, exit 1.
      - If the editor binary itself cannot be spawned, print a clear error
        naming the binary and the path to the file, exit 1.
- [ ] Update `jarvis help` output (the help text in `src/cli.ts`) to list
      `jarvis prices show` and `jarvis prices edit` under the existing
      command table.
- [ ] Add `test/prices-show.test.ts` covering:
      - Renders rows in alphabetical order by model ID.
      - Renders `null` rates as `—`.
      - Renders `manual: true` rows with `*` in the MANUAL column.
- [ ] Add `test/prices-edit.test.ts` covering:
      - "no changes" path (editor exits 0 without modifying file).
      - "saved" path (editor exits 0 with valid edits).
      - "validation failed" path (editor exits 0 with invalid edits;
        file is left as the user wrote it; exit code 1).
      - "aborted" path (editor exits 1).
      - Editor selection precedence: `$EDITOR` over `$VISUAL` over `vi`.
      Use a stub editor (a script that takes the file path arg and
      mutates it) to drive these.

## Acceptance criteria

- [x] `jarvis prices show` prints the table described above against the
      repo's `data/prices.json`.
- [x] `jarvis prices edit` opens `$EDITOR` and behaves per the four cases
      above (no-changes, saved, validation-failed, aborted).
- [x] `jarvis help` lists both subcommands.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new test files).
- [x] `bun run check` passes.

## Documentation updates

- [x] Add a `Prices` subsection under the `## Commands` table in
      `README.md`, documenting `jarvis prices show` and `jarvis prices
      edit`. Reference subspec 03's `update` only as "see also" — full
      docs for `update` land with that subspec.
- [x] Cross-link from the `docs/cost.md` (or `docs/run-loop.md`) section
      added in subspec 01 to the new `jarvis prices` commands.
