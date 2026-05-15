# CLI modes and config v2

repo: git@github.com:cbrenner04/jarvis.git

**Patch** (`jarvis run`) and **plan** (`jarvis plan`) are the two **modes**:
long-lived harness paths that resolve a target repo, run shared preflight
(log server, etc.), and eventually drive agent work. Other subcommands are
**utilities** (`init`, `config`, `help`, `log-server`, …). **Triage** is not
a user-facing “mode” in this sense; it is tooling usable inside a mode’s
workflow to recover and proceed.

This spec lands two things, in order:

1. **Config v2** — Replace flat `agentOrder` / optional `planAgentOrder` with
   a single enforced shape: `modes.patch.agentOrder` and
   `modes.plan.agentOrder`. No legacy keys, no migration code, no “plan falls
   back to patch” semantics. Invalid or pre-v2 configs fail fast at load.
2. **CLI mode entry** — One shared front-door for what modes share before any
   loop turns: neutral module names, no `*-plan-*` / `*-patch-*` helper
   duplication where avoidable, and **no** abstraction of loop lifecycle
   (different prompts, different turn counts; that waits for real duplication
   in code).

Merge this spec to `main` **before** implementation. Relationship to
in-flight work: any branch that added `planAgentOrder`, duplicated parsers, or
per-mode preflight should be rebased onto the implementation of this spec or
re-cut; this spec does not prescribe git mechanics.

Target resolution and log-server ordering/semantics remain as already
specified in `spec/plan-mode-skeleton/03-target-repo-resolution.md` and
`spec/plan-mode-skeleton/05-log-server-requirement.md` — this spec **centralizes
call sites** only, it does not reopen those decisions.

## Subspecs

- [x] [00 — Config v2: enforced `modes` shape](./00-config-v2-modes.md)
- [x] [01 — Shared CLI mode entry (preflight only)](./01-shared-mode-entry.md)
- [ ] [02 — `jarvis config`, docs, cross-references](./02-config-cli-and-docs.md)

## Conventions

- Run with `jarvis run spec/cli-modes-and-config-v2/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If blocked, append `## Blocker` to the subspec and stop.

## Non-goals

- Unifying or abstracting patch vs plan **loop** / agent-phase orchestration.
- Changing triage’s CLI surface beyond what falls out from shared imports.
- Auto-migrating v1 config on disk (operator handles local file; see 00).
