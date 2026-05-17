---
name: plan-mode-updates
---

Plan mode updates

* I don't think interview works. examples:
    * https://github.com/cbrenner04/jarvis/pull/43
    * https://github.com/cbrenner04/jarvis/pull/44
    * https://github.com/cbrenner04/jarvis/pull/48
* We need to update directions for creating directories for specs. They should created with ISO8601 timestamps as a prefix. See spec/completed. At first I only had them with the date but you can see that quickly not be enough. 
* "PR flip to ready" instruction in "Next steps" output after completion should be removed.
* "plan: complete\nplan mode: commits created and pushed to plan/aider-agent" at the end of plan completion output is redundant.
* logs in the cli are too verbose. there are things that are more sanity check type things that shouldn't be there. The first 6 lines seem like things that could go to the log server but don't need to be printed from the cli. The rest seems ok.

Example of output for clarifying last 3 points

```text
plan mode: inline intent="I would like to add another agent (aider) for running local llms"
plan mode: target project=jarvis root=/Users/christopherbrenner/Work/jarvis
plan mode: temporary plan name=tmp-b78db18c
plan mode: worktree created at /Users/christopherbrenner/Work/jarvis/.worktree/plan-tmp-b78db18c
plan mode: spec name=aider-agent
plan mode: renamed worktree and branch to plan/aider-agent
plan mode: interview commit pushed
plan mode: draft phase completed
plan mode: draft commit pushed
https://github.com/cbrenner04/jarvis/pull/43
plan mode: draft PR #43 opened
plan mode: review pass 1/2 starting
plan mode: review pass 1 committed and pushed
plan mode: review pass 2/2 starting
plan mode: review pass 2 committed and pushed

Next steps:
  1. Review the draft PR: https://github.com/cbrenner04/jarvis/pull/43
  2. Edit spec/aider-agent/ on the plan branch as needed (locally or
     through GitHub), or run `jarvis plan --resume
     spec/aider-agent/index.md` for another self-review pass.
  3. Mark the PR ready for review and merge it to main.
  4. After the merge, implement the spec with:
       jarvis run spec/aider-agent/index.md
plan: complete
plan mode: commits created and pushed to plan/aider-agent
```
