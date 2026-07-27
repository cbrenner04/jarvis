# Implement repairs a ticked run with a surviving mutation

repo: cbrenner04/jarvis

Ordered: `01` extends the `implement.recover` dispatch and finalization tail `00` adds, so `00`
must land first. `00`'s own re-verification-kills-the-mutation coverage uses a hand-fixed worktree
fixture as a stand-in for the agent repair `01` adds.

- [x] [00 - Admit a ticked spec whose lineage failed mutation verification](./00-admit-ticked-mutation-recovery.md)
- [x] [01 - Bounded mutation-coverage repair](./01-bounded-mutation-repair.md)
