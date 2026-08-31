# Shrink step: change rate and LOC impact

Measured 2026-08-31 from run logs and agent transcripts, deliberately without git commit archaeology. Question: how often does the post-implement shrink pass actually change code, and by how many lines.

## Method

- Population: every v2 `implement~shrink` run row in `~/.jarvis/state/v2.sqlite` — 459 runs, 2026-07-13 through 2026-08-31, across 459 distinct workflow invocations (exactly one shrink run per implement workflow that reached it). Auto-shrink landed in #1203 (merged 2026-07-08); the first run row is 2026-07-13.
- **Made changes** = a recorded shrink commit, from two harness sources: `iteration_commit` events in `~/.jarvis/state/logs.jsonl` (per-iteration commits and their event exist since 2026-07-26, #2104/#2176; `commitSha` vs `skipReason: no_file_changes`) unioned with `work_boundary_recorded` rows in `~/.jarvis/telemetry.jsonl` (whole window, #1287; emitted only when the completion boundary committed file changes, carries `files_changed` but no line counts). Pre-07-26 runs had no per-iteration commits, so boundary telemetry is complete for that era.
- **LOC** = per-edit line deltas from the agents' own transcripts, matched to shrink runs by worktree cwd + the rendered shrink prompt appearing as a user message + dispatch-time window: cursor `~/.cursor/chats/*/*/store.db` (`linesAdded`/`linesRemoved` on edit-tool results), codex `~/.codex/sessions/**.jsonl` (`apply_patch` body +/− counts), claude `~/.claude/projects/<worktree>/*.jsonl` (Edit/MultiEdit old/new line diffs; Write counted as adds), plus the tool-call stream some harness session logs in `~/.jarvis/sessions/` carry. Edits to `.scratch/shrink-narrative.md` and spec files are excluded.
- The harness's own logs cannot answer LOC directly: the shrink prompt embeds only the *pre*-shrink `git diff --stat` vs base, review roles write no session logs (so no post-shrink diff is captured anywhere), and boundary telemetry stops at files-changed.
- Matching gotcha: "Post-completion Shrink" anywhere in a transcript is not sufficient — jarvis worktrees contain `prompts/patch/shrink.md` itself, so implement transcripts that read it match too. Requiring the rendered prompt (has a rendered branch summary, lacks the literal `<BRANCH_DIFF>` placeholder) in a user-role message removes that contamination; without the fix, implement iterations inflate shrink "growth" by thousands of lines.

## Structural facts (from `v2/src/execution/workflow-runner.ts`)

- Shrink is a hidden write-loop run appended after the implement step completes: stepId `<implement stepId>~shrink`, role `shrink`, prompt `patch.prompt.shrink`; `suppressShrink` pins all but the last resolved implement position so it fires once per workflow.
- Prompt placeholders `BRANCH_DIFF` (diff --stat vs base) and `RUN_SCOPED_DIFF` (unified diff) are computed once at dispatch; write-loop iterations within one dispatch reuse the rendered prompt, so session logs never show a post-shrink diff.

## Change rate

| outcome | runs | share |
|---|---|---|
| committed changes | 330 | 72% |
| committed nothing | 124 | 27% |
| indeterminate (pre-07-26 runs dead before any commit record) | 5 | 1% |

Status mix: 408 completed / 41 failed / 7 killed / 3 blocked; among completed runs the change rate is 288/408 (71%). Separately, 69 runs show transcript edits but no recorded commit — churn from failed/killed/reverted work that never landed (median churn 90 lines).

## LOC impact

249 of the 330 changed runs have usable per-edit evidence (cursor 129, codex 90, claude 27, other 3):

| metric | sum | mean | median | p25 | p75 |
|---|---|---|---|---|---|
| lines added | 11,276 | 45.3 | 31 | 12 | 62 |
| lines removed | 18,473 | 74.2 | 50 | 22 | 100 |
| net (add − remove) | −7,197 | −28.9 | −19 | −39 | −5 |
| churn (add + remove) | 29,749 | 119.5 | 83 | 34 | 170 |

- 227/249 runs are net-negative, 9 net-zero, 13 net-positive; the largest growth is +30 lines, the largest deletion −236.
- Relative to the diff shrink receives (median 270 added lines vs base): median net −4.6% of the incoming diff, aggregate −7.3%.
- Stable across months: July mean −31.1/run (n=116), August −27.0/run (n=133).
- By agent: cursor median −36 (n=129), codex −6 (n=90), claude −3 (n=27). By project: jarvis mean −28.8 (n=235), chess-mvp-yolo −30.4 (n=14).
- The remaining 81 changed runs lack usable LOC evidence (3 had transcripts showing zero code edits; 78 had no matched transcript — mostly July claude runs, whose transcript store retains ~30 days). Extrapolating the −19 median over those 78 adds ≈ −1,480, putting the period total near −8,700 net lines.

## Caveats

- LOC is edit-tool churn: a line rewritten twice in one run counts twice in add/remove/churn; net is the honest impact read.
- File deletions under-count removals (codex `apply_patch` Delete File carries no line body), so true deletion is slightly understated.
- Claude transcript retention (~30 days at measurement time) is the main coverage hole; codex and cursor stores cover the whole window.
- "Made changes" for the pre-07-26 era rests on boundary telemetry alone, hence the 5 indeterminate runs.

## Reproduction

`python3 v2/docs/research/20260831T052355Z-implement-shrink-impact.py` — enumerates shrink runs from the state DB, classifies change-rate from `logs.jsonl` + telemetry, extracts per-edit LOC from the cursor/codex/claude transcript stores and harness session logs, and prints the tables above. Reads the live stores; rerunning later drifts from this snapshot (claude transcripts age out, the other stores grow).
