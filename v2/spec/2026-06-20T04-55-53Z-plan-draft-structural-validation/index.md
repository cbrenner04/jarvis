# Plan draft structural validation

repo: https://github.com/cbrenner04/jarvis

`validateDraftOutput` (the harness gate before `plan: draft` commit) only checks index/subspec existence, intent immutability, and blocker ordering. The structural rules that keep generated subspecs parseable — exact `## Acceptance criteria` heading, no duplicate canonical sections, behavioral (not pure-structural) ACs — live only in the draft prompt. This spec moves those into harness enforcement via the shared spec parser, then adds the [[refactor-acs-cite-tests]] grounding flag for behavioral/preservation ACs that cite no test or source anchor.

- [x] [00 - Structural validation in the draft gate](./00-structural-validation.md)
- [ ] [01 - Behavioral/preservation AC anchor grounding](./01-ac-anchor-grounding.md) — builds on 00's `warnings` channel; lands after 00.
