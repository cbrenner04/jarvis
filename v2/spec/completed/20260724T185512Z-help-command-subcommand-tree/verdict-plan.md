## Verdict — refinement required

### 1. Subspec 01 has no behavior delta as written (blocking)

Every dispatcher named in 01 (`runRunCommand`, `runDaemonCommand`, `runConfigCommand`, `runTuiCommand`) already rejects any name outside its hard-coded branch chain and falls to usage-and-exit-1. Since 00 seeds the tree with exactly those names, adding a "gate on the tree's child-name set" changes no operator-reachable behavior. 01's failing-test AC ("a new drift test fails against pre-change code") is therefore false, and its guard-inversion AC grades a guard that does nothing.

The spec must resolve this one of two ways:

- **Make the tree load-bearing** — dispatch derives its accepted-name set *from* the tree rather than checking against it, so removing a name from the tree actually removes dispatch. This is a real design decision the spec currently does not make; if chosen, 01 must state it explicitly and its ACs must describe the resulting behavior delta.
- **Collapse 01 into 00** — drop the runtime gate and satisfy the intent's coverage AC ("a test fails if a dispatchable command or subcommand is absent from the registry tree") with a registry-coverage test in 00.

Either resolution must preserve every acceptance outcome from both current subspecs exactly once, with every surviving file linked from `index.md`.

### 2. The test seam for tree-vs-dispatch coverage is undecided (blocking)

01 simultaneously requires dispatchers to `import` names from `command-tree.ts` and requires a test that runs "with the node's children list narrowed." Those are incompatible without a named seam. Whichever resolution 1 takes, the spec must state how a test exercises a tree different from the shipped one (injected dependency, exported pure function taking the node as an argument, or module mock) — this is the only route to a verifiable central AC.

### 3. `runWorkflowCommand` is described incorrectly

01's Problem says all five dispatchers "match subcommand strings inline." `runWorkflowCommand` resolves presets through an injectable builder map plus `LEGACY_WORKFLOW_ALIASES`; existing workflow tests inject builders under arbitrary names. The spec must correct this description and decide how the injection point interacts with any name gate, so existing tests are not silently invalidated.

### 4. ~12 subcommand usage strings are unspecified

`usage.ts` carries nothing for `run start|log|pause|resume|kill|wait`, `config show|path|set-agents`, or `daemon start|stop|status`, yet 00's node shape requires a `usage` field and its render rule prints "the resolved node's usage line." `jarvis help run pause` has no defined output. The spec must either authorize the new constants (and pin at least representative ones in an AC) or make `usage` optional on a node with a defined fallback rendering. Related: `run start` currently surfaces `WRITE_USAGE`; that needs a one-line decision rather than being discovered at implementation time.

### 5. Existing pinned tests that 00 breaks are not named

`cli.test.ts` currently pins `jarvis help foo` and `jarvis help --version` to `usage: jarvis help` / exit 1, and pins the depth-0 trailer string ``run `jarvis help` for available commands``. 00 changes all three. Spec guidance requires naming tests being rewritten. The spec must name that file's affected cases and state the intended new behavior for `--version` as a `help` argument.

### 6. Diagnostic and traversal edges undefined

- **Depth-0 trailer**: 00's message template renders an empty "path so far" for `jarvis help nope`. State the depth-0 form.
- **Depth**: 00 says `<path...>` while the intent scopes two levels. `jarvis help run workflow intent` is reachable and has an existing usage constant. State whether the walk is unbounded and what an extra segment past a leaf does.
- **Bare `jarvis tui`**: gating on the first operand before the existing branch chain regresses `tui` with no operand (bare `run`/`daemon`/`config` already exit 1; `tui` does not). Any gate must explicitly excuse the absent-operand case, with an AC.

### 7. Byte-identical top-level AC conflicts with the change

00 requires top-level `jarvis help` output be byte-identical to today's, but `help`'s own summary describes behavior this spec changes. Relax the AC to same shape and ordering, with `help`'s summary updated.

### 8. Legacy alias handling: rationale and consequence

The stated reason for excluding `intent-reviewed` / `plan-reviewed` / `plan-reviewed-light` from the tree is circular (they are excluded because the guard reads the tree). Restate it on deprecation grounds, and state the unstated consequence: `jarvis help run workflow intent-reviewed` will emit an unknown-segment error for a name that still dispatches.

### 9. Coverage and AC form

- Add ACs for `help daemon`, `help config`, and `help tui` — three of five parent nodes are currently unverified.
- 01's "unchanged output and exit code" is a preservation criterion; per spec guidance it must cite the pinning tests (`run.test.ts`, `daemon.test.ts`, `config.test.ts`, `tui.test.ts`, `workflow.test.ts`) rather than paraphrase.
- If 01 remains behavior-preserving, drop its `v1-behaviors.md` update; if it lands a real behavior change, keep and describe it.

### Not upheld

- **Summary-text drift.** Node summaries are hand-authored prose and can drift from flag semantics at any design point. The intent's "rules out hand-maintained help strings that drift" targets structural drift (which subcommands exist), which the tree does address. One sentence accepting summary drift is sufficient; no design change required.
- **`RUN_USAGE` duplicating the child list.** Real but cosmetic — one explicit "intentional" note suffices.