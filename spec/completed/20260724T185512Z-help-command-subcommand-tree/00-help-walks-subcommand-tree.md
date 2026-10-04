# 00 - Command registry carries a subcommand tree that `jarvis help` walks

## Problem

`jarvis help` lists seven top-level commands and stops. `jarvis help run` prints
`usage: jarvis help` and exits 1, so nothing documents `run`'s subcommands or
`run workflow`'s presets. `commandEntries` in `v2/src/cli.ts` stores one opaque
usage string per command and no subcommand structure.

## Decisions

- The subcommand tree lives in a new `v2/src/cli/command-tree.ts`; `cli.ts` composes each
  registry entry from a tree node plus its handler. Rules out putting the tree in `cli.ts`,
  which the dispatch-coverage test would then import alongside the dispatchers.
- A node is `{ name, summary, usage?, subcommands? }`. Usage strings stay in `cli/usage.ts`;
  no new usage constants are authored. Rules out inventing a second copy of usage text that
  drifts from the parsers.
- `usage` is optional. A node without one renders its nearest ancestor's usage line — so
  `jarvis help run pause` prints `RUN_USAGE`. Rules out synthesizing `usage: jarvis run pause`,
  which would fabricate an argument shape no parser backs.
- Tree contents: `run` → `start` (`WRITE_USAGE`, matching what `runRunCommand` already prints
  for a malformed `start`), `list` (`RUN_LIST_USAGE`), `log`, `pause`, `resume`, `kill`, `wait`
  (no usage), `workflow` (`WORKFLOW_USAGE`); `run workflow` → `intent`, `plan`, `implement`
  (their `WORKFLOW_*_USAGE` constants); `daemon` → `start`, `stop`, `status` (no usage),
  `log` (`DAEMON_LOG_USAGE`); `config` → `show`, `path`, `set-agents` (no usage);
  `tui` → `log` (`TUI_LOG_USAGE`). `write`, `cleanup`, `help` are leaves.
- The tree is help-and-coverage data only. Dispatchers keep their inline branch chains
  unchanged; no runtime name gate is added. Rules out a gate that would change no
  operator-reachable behavior (every dispatcher already rejects unlisted names with
  usage-and-exit-1) and would regress bare `jarvis tui`, which legitimately takes no operand.
- Coverage direction: a test drives every tree path through `main()` with stubbed `CliDeps`
  and asserts none lands on its parent's unknown-subcommand usage-and-exit-1 path — i.e.
  tree ⊆ dispatchable. The reverse (a future dispatchable name shipped absent from the tree)
  is not machine-detectable while the tree is not load-bearing; making dispatch derive its
  handler table from the tree is deferred, not silently assumed.
- `runWorkflowCommand` is the exception to "inline branch chain": it resolves presets through
  an injectable builder map plus `LEGACY_WORKFLOW_ALIASES`. The coverage test drives it with
  default preset builders so it exercises the shipped names; existing workflow tests that
  inject builders under arbitrary names are untouched.
- Legacy `intent-reviewed` / `plan-reviewed` / `plan-reviewed-light` stay out of the tree
  because they are deprecated and `WORKFLOW_USAGE` already advertises only the three canonical
  presets. Consequence, accepted: `jarvis help run workflow intent-reviewed` emits an
  unknown-segment error for a name that still dispatches.
- Rendering: `jarvis help <path...>` prints the resolved node's usage line, then one
  `name<TAB>summary` line per child; a leaf prints its usage line alone. Rules out a bespoke
  nested format divergent from top-level help. The walk is unbounded over the tree — depth is
  whatever the tree carries (three levels today) — and any segment past a leaf is an unknown
  segment.
- Unknown segment: stderr `unknown command: <input>`, then `did you mean <name>?` only when
  exactly one sibling is within Levenshtein distance 2, then the trailer. At depth 0 the trailer
  is today's exact ``run `jarvis help` for available commands``; deeper it is
  ``run `jarvis help <path so far>` for available commands``. Exit 1.
- Test seam: `resolveHelpPath(node, segments)` and `renderHelpNode(node, path)` are exported
  pure functions taking the root node as an argument, so tests can render a synthetic tree
  without mutating the shipped one.
- Flags remain out of scope; nodes describe subcommand discovery only.
- Node summaries are hand-authored prose and can drift from flag semantics; the tree only
  rules out *structural* drift (which subcommands exist). `RUN_USAGE` duplicating the child
  list is intentional — the usage line is the one-liner, the child lines carry the summaries.

## Acceptance criteria

- [x] `jarvis help run` prints `usage: jarvis run <start|list|log|pause|resume|kill|wait|workflow> [args]`
      followed by one `name<TAB>summary` line for each of `start`, `list`, `log`, `pause`,
      `resume`, `kill`, `wait`, `workflow`, and exits 0.
- [x] `jarvis help run workflow` lists `intent`, `plan`, and `implement` with summaries and exits 0.
- [x] `jarvis help daemon`, `jarvis help config`, and `jarvis help tui` each print their usage
      line plus one line per tree child (`start|stop|status|log`, `show|path|set-agents`, `log`)
      and exit 0.
- [x] `jarvis help run pause` prints `RUN_USAGE` alone (ancestor fallback, no child lines) and
      exits 0; `jarvis help run start` prints `WRITE_USAGE`; `jarvis help run workflow intent`
      prints `WORKFLOW_INTENT_USAGE`.
- [x] `jarvis help write` prints the `write` usage line with no subcommand lines and exits 0.
- [x] Top-level `jarvis help` keeps its current shape and command ordering — one
      `name<TAB>summary` line per registered command — with `help`'s summary updated to describe
      subcommand help.
- [x] `jarvis help nope`, `jarvis help run nope`, and `jarvis help write nope` (a segment past a
      leaf) write nothing to stdout, name the unknown input, and exit 1; `jarvis help nope` emits
      today's depth-0 trailer verbatim while `jarvis help run nope` emits
      ``run `jarvis help run` for available commands``.
- [x] `jarvis help ren` and `jarvis help run strt` each additionally emit the single
      `did you mean` line.
- [x] `jarvis help --version` no longer prints `usage: jarvis help`; it is an unknown segment —
      `unknown command: --version`, no suggestion, depth-0 trailer, exit 1.
- [x] The `cli.test.ts` cases `help %p prints help usage and exits non-zero` (`foo`, `--version`)
      are rewritten to the unknown-segment shape above, and its `unknownCommandError` helper
      takes a path argument for the depth-aware trailer.
- [x] New `v2/src/cli.test.ts` cases covering `help run`, `help run workflow`, `help run pause`,
      and `help run nope` fail against pre-change code (which exits 1 with `usage: jarvis help`)
      and pass after.
- [x] A dispatch-coverage test drives every tree path through `main()` with stubbed `CliDeps`
      and a minimally valid argument shape, asserting none produces its parent's
      unknown-subcommand usage-and-exit-1 output; it fails when a name is added to the tree
      that no dispatcher accepts.
- [x] `jarvis run workflow intent-reviewed|plan-reviewed|plan-reviewed-light` still dispatch —
      `workflow.test.ts` legacy-alias cases stay green — while
      `jarvis help run workflow intent-reviewed` exits 1 as an unknown segment.
- [x] Bare `jarvis tui` still launches the run monitor and bare `jarvis run`/`daemon`/`config`
      still exit 1 with usage: `tui.test.ts`, `run.test.ts`, `daemon.test.ts`, and
      `config.test.ts` stay green (no dispatcher behavior changed).
- [x] Inverting the did-you-mean guard (emit the suggestion when the close-match count is not
      exactly one) fails a test that asserts no suggestion line for an input with zero or
      multiple close siblings.
- [x] Inverting the leaf-vs-parent render guard (print child lines for a leaf, or omit them for a
      parent) fails the `help write` and `help run` cases above.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — rewrite "Top-level command help" to describe
  `jarvis help <command> [<subcommand>…]`, the rendered shape, the ancestor usage fallback,
  per-depth diagnostics, and that the tree is help/coverage data rather than a dispatch gate.
- `v2/docs/v1-behaviors.md` — one `[v2-only]` bullet: v2 help walks a subcommand tree and
  treats a stray `help` argument as an unknown segment; v1 `jarvis1 help` lists top-level
  commands only.
