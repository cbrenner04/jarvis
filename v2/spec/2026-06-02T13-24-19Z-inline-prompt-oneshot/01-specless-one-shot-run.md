# Specless one-shot run

## Decisions

- Branch and worktree are `jarvis/prompt-<UTC-timestamp>-<short-nonce>` and `.worktree/prompt-<UTC-timestamp>-<short-nonce>/` — rules out ref names built from prompt text (long, unstable, possibly sensitive).
- Exactly one agent invocation per run; loop knobs are ignored — rules out the patch-style loop implied by reusing patch's runner.
- Agent prompt is rendered from a template in `prompts/prompt/`; its rules fragment forbids the agent from running `git commit`, `git push`, or `gh pr create` — rules out delegating side effects to the agent.
- Agent selection and per-attempt quota fallback reuse the patch invocation path keyed on `modes.prompt.agentOrder` — rules out a parallel error/fallback pipeline.
- Telemetry rows use `mode: "prompt"` — rules out reusing `mode: "patch"` which would conflate one-shot runs with loop iterations in the summary.
- No-diff (clean `git status --porcelain`) → print the agent's final stdout and exit 0; no commit, push, or PR — rules out empty commits or "no-changes" PRs for question-style prompts.
- Diff present → harness creates one commit. Subject is the prompt's first non-empty line trimmed to 72 chars (ellipsized if longer); body is the full prompt followed by a blank line and the `Jarvis-Agent: <label>` trailer — rules out agent-authored or timestamp-only subjects.
- After commit, `git push -u origin <branch>` then `gh pr create --draft`; title equals the commit subject; body is the full prompt plus the standard attribution footer — rules out marking the PR ready (humans merge).
- Push or `gh pr create` failure exits non-zero; commit and worktree are preserved — rules out auto-revert that loses the agent's work.
- Exit codes reuse the patch vocabulary (0 success, 2 all-agents-quota, 3 non-quota agent failure, 8 watchdog) — rules out a new code table.

## Acceptance criteria

- [x] A module under `v1/src/modes/prompt/` implements the one-shot run, wired to the handler from subspec 00 via `v1/src/cli.ts` (routed in the "prompt" case).
- [x] Worktree creation uses `prompt-<UTC-timestamp>-<short-nonce>` (timestamp format per `spec-guidance.md`) for both branch and `.worktree/` path.
- [x] `prompts/prompt/` contains the inline-prompt template and rules fragment, registered in `prompts/registry.txt`, covered by unit tests.
- [x] Agent invocation reuses the shared quota-classification and fallback path; all-agents-quota exits 2.
- [ ] Telemetry rows are written with `mode: "prompt"` and aggregated by the existing end-of-run summary.
- [x] No-diff run prints the agent's response, opens no PR, and exits 0; `jarvis1 cleanup` removes the worktree with no leftover remote branch.
- [x] Diff-producing run creates exactly one commit (subject = first-line excerpt ≤72 chars, ellipsized if longer; body = verbatim prompt + `Jarvis-Agent` trailer), then pushes and opens a draft PR whose title equals the commit subject and body contains the verbatim prompt plus the standard attribution footer.
- [x] Push or `gh pr create` failure exits non-zero; commit and worktree are preserved.
- [ ] Watchdog timeout (`iterationTimeoutMs`) aborts the pass with exit 8.
- [x] New tests cover helper functions: ellipsization, first-line extraction, nonce generation, ISO8601 timestamps.
- [x] `bun run typecheck` and `bun test` pass.
