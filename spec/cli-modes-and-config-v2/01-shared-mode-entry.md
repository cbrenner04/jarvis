# 01 — Shared CLI mode entry (preflight only)

## Problem

Mode commands re-implement the same early pipeline: after command-specific
parsing, they resolve the target repo and run log-server preflight in a fixed
order. Helpers drift into per-mode filenames (`plan-args`, duplicated config
parsers) without a named concept of “mode entry.”

## Decisions

- **Scope is pre-loop only.** Shared code covers: ordering and invocation of
  **target-repo resolution** and **log-server reachability** (and any future
  preflight that applies to every mode before agents run). It does **not**
  implement or share patch vs plan **iteration** logic, prompts, or phase
  graphs.
- **Neutral module naming.** Shared logic lives under names that do not
  encode `plan` or `patch` in the file path unless unavoidable (e.g.
  `src/commands/run.ts` stays as the patch entry command).
- **Single ordering.** For all modes that require agents: **parse** (or
  command-specific setup) → **resolve target repo** → **log-server preflight**
  → then mode-specific work. This matches
  `spec/plan-mode-skeleton/03-target-repo-resolution.md` and
  `spec/plan-mode-skeleton/05-log-server-requirement.md`; do not change those
  semantics here.
- **`jarvis run` and `jarvis plan`** both call into the shared entry helper
  after their respective argument handling. Utilities do not use it unless a
  later spec says otherwise.

## Tasks

- [ ] Introduce a small shared API (exact shape up to implementer) that runs
  shared preflight steps given mode-agnostic inputs (e.g. resolved flags,
  candidate paths, `Config`, `Io`).
- [ ] Refactor `run` and `plan` to use it; delete or shrink duplicated
  preflight wiring.
- [ ] Tests: preserve existing behavior for `run` and plan skeleton (exit
  codes, stderr messages for resolution vs log-server vs stub).

## Acceptance criteria

- [ ] No duplicated “resolve then log-server then continue” sequence between
  `run` and `plan` entry paths.
- [ ] Target-repo and log-server failure messages and codes match pre-refactor
  behavior.
- [ ] `bun run typecheck`, `bun test`, `bun run check` pass.

## Documentation updates

- None. Subspec 02 updates narrative docs if a short “mode entry” note helps.
