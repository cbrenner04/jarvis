# PR-sized planning chunks

repo: https://github.com/cbrenner04/jarvis

Make plan-mode produce subspecs that are PR-sized mergeable chunks. The sizing
rule's canonical home is `v1/docs/spec-guidance.md` (incl. the ~1000-line
warning); plan prompts reference that rule without hardcoding the number. Draft
applies it while decomposing; review surfaces flag/split oversize subspecs.

- [ ] [00 - Spec-guidance PR-sized merge-unit rule](./00-spec-guidance-sizing-rule.md)
- [ ] [01 - Draft prompt sizes subspecs](./01-draft-prompt-pr-sizing.md)
- [ ] [02 - Review surfaces flag oversize subspecs](./02-review-flags-oversize.md)

All three append to `v2/docs/v1-behaviors.md`; merge the PRs in index order
(00 → 01 → 02) to avoid a textual conflict on that file.
