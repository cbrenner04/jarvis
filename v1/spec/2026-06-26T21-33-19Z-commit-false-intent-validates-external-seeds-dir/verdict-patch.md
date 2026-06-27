## Verdict

One upheld issue requires action.

**Required outcome — positively pin the rejection message in the `commit:false` in-repo-seed reject test(s).**

An accepted criterion states that under `commit:false` the rejection message must *name the active external seeds home* (`~/.jarvis/specs/<projectSafeId>/seeds/`), not `${targetDir}/seeds/`. This AC exists specifically to prevent the original #529 failure in reverse: a stale message pointing operators at a location that can never satisfy the check.

The current reject test(s) assert the message only *negatively* — that it does **not** contain the wrong in-repo form. That proves the message isn't one specific wrong value, but it does not prove the message *is* the external `specs/<id>/seeds` path. A regression that pointed the message at some other unrelated `*/seeds/` location would still pass. The AC that pins message content is therefore only weakly covered.

Make at least one `commit:false` reject test assert positively that the rejection message names the external seeds home (e.g. contains the `specs/<projectSafeId>/seeds` segment). After the change, a message that fails to name the external home must fail the test.

**Not required:** path *form* (absolute vs `~`-relative) in the message — no spec or AC mandates a particular form, only that a satisfiable location be named. The unconditional `externalRoot`/`computeProjectSafeId` hoist (the literal spec decision to compute once and reuse), the redundant `--repo` in the accept test, and the simplified flow diagram (commit-mode behavior is stated correctly in the prose, satisfying the doc AC) are all acceptable as-is.