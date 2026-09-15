# External plan draft runs in a materialized target-repo checkout

External-specs plan draft (`specs: external`, the default) currently invokes the draft agent in a `git: false` scratch stage that holds only the seeded intent, while `WORKDIR` advertises an unmaterialized `~/.jarvis/worktrees/...` path. The agent cannot read the target repo, so the prerequisite gate and repo-reading draft prompt correctly block. This spec makes the external plan-draft write step invoke the agent in a read-only target-repo checkout materialized at the stage path (the agent's cwd), read natively by opencode via `--dir`, with `WORKDIR` equal to that on-disk directory.

- [ ] [00-external-plan-draft-materialized-read-checkout.md](00-external-plan-draft-materialized-read-checkout.md)
