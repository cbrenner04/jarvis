# Specless one-shot run

End-to-end execution of `jarvis1 --prompt`: worktree, single agent pass through the quota-fallback workflow, telemetry, and the post-pass branch on diff vs. no-diff (harness-owned commit/push/PR or response-only exit 0).

## Decisions

- Worktree path is `.worktree/prompt-<UTC-timestamp>-<short-nonce>/` on branch `jarvis/prompt-<UTC-timestamp>-<short-nonce>` — rules out building ref names from prompt text (long, unstable, possibly sensitive) and rules out reusing patch's spec-name slug since no spec exists.
- Exactly one agent invocation per `jarvis1 --prompt` run — rules out the patch-style loop; max-iterations is not honored.
- The agent prompt is the operator's inline text rendered through an inline-prompt template owned in `prompts/prompt/` (analogous to `prompts/patch/`); the rules fragment forbids the agent from running `git commit`, `git push`, or `gh pr create` — rules out delegating side effects to the agent and rules out an ad-hoc prompt string without a snapshot test.
- Agent selection uses `modes.prompt.agentOrder` and reuses the existing per-attempt quota classification and fallback (`v1/src/quota-harness-messages.ts` + the shared invocation path) — rules out a parallel error or fallback pipeline.
- Telemetry rows are emitted with `mode: "prompt"` so the existing JSONL/end-of-run summary aggregation can filter on the shared file — rules out reusing `mode: "patch"` which would conflate one-shot runs with loop iterations.
- The log server is required just like `jarvis1 run` (startup connectivity check) — rules out a silent best-effort path that diverges from the existing operator expectation.
- Completion check after the agent pass: clean `git status --porcelain` in the worktree means no diff → print the agent's final stdout transcript (bounded to the existing run-terminal tail policy) and exit 0 without commit/push/PR — rules out empty commits or "no-changes" PRs for question-style prompts and rules out treating no-diff as failure.
- Diff present → harness creates exactly one commit. Subject is the prompt's first non-empty line trimmed to 72 chars (longer lines get an ellipsis); body is the full prompt text followed by a blank line and the `Jarvis-Agent: <label>` trailer for the agent that produced the work — rules out agent-authored commit messages and rules out timestamp-only opaque subjects.
- After commit, `git push -u origin <branch>` then `gh pr create --draft` with title = the same first-line excerpt and body = the full prompt text + standard attribution footer (rendered from the `Jarvis-Agent` trailer the same way patch mode does) — rules out marking the PR ready (humans merge) and rules out reusing patch's deterministic `index.md`-derived body since no index exists.
- Push or `gh pr create` failure is a non-zero exit with the network/permissions message surfaced; the commit stays on the local branch and the worktree is left in place for inspection — rules out auto-revert that would lose the agent's work.
- Exit codes reuse the patch exit-code vocabulary where it applies: 0 success (with or without PR), 2 all agents quota-exhausted, 3 non-quota agent failure, 7 if the agent appended a `## Blocker` to its own output (recorded in the commit as WIP) — rules out inventing a new code table.
- Watchdog/iteration timeout (`iterationTimeoutMs`) applies to the single pass — rules out an unbounded agent run.

## Acceptance criteria

- [ ] A new module under `v1/src/modes/prompt/` implements the one-shot run, with `v1/src/commands/prompt.ts` wiring it to the CLI handler stub added in subspec 00.
- [ ] Worktree creation uses `prompt-<UTC-timestamp>-<short-nonce>` as the branch and `.worktree/<same-name>/` as the path; the timestamp uses the same `:`→`-` ISO format as `spec-guidance.md`.
- [ ] A new `prompts/prompt/` directory contains the inline-prompt template and rules fragment; both are covered by a rendered-prompt snapshot test analogous to the patch fixtures.
- [ ] Agent invocation reuses the shared quota-classification and fallback path used by patch mode; on all-agents-quota the run exits 2 with the existing operator-visible stderr phrasing.
- [ ] Telemetry rows for the run are written to `~/.jarvis/runs.jsonl` (or configured path) with `mode: "prompt"`; the end-of-run summary aggregates them with the existing per-agent table.
- [ ] A no-diff run prints the agent's response to stdout, opens no PR, and exits 0; the worktree is removable by `jarvis1 cleanup` (no leftover branch on origin).
- [ ] A diff-producing run creates exactly one harness commit whose subject is the prompt's first-line excerpt (≤72 chars, ellipsized if longer), body contains the verbatim prompt text and a `Jarvis-Agent: <label>` trailer.
- [ ] A diff-producing run pushes the branch and opens a draft PR via `gh pr create --draft` whose title equals the commit subject and whose body contains the verbatim prompt text plus the standard attribution footer rendered from the `Jarvis-Agent` trailer.
- [ ] PR creation or push failure surfaces a clear error and exits non-zero; the commit and worktree are preserved for re-push.
- [ ] Watchdog timeout from `iterationTimeoutMs` aborts the single pass with exit 8, matching patch-mode watchdog behavior.
- [ ] New tests cover: default-config one-shot success with diff (mock agent), no-diff response-only path, all-agents-quota → exit 2, non-quota agent failure → exit 3, push failure → non-zero exit, commit subject ellipsization for long first lines.
- [ ] `bun run typecheck` and `bun test` pass.
