# Blocker contract credits an existing `## Blocker`

The blocker-text contract accepts only a `## Blocker` appended during the settling invocation (`hasGenuineBlocker(specBefore, specAfter)`), so a `blocked` token over a section authored in an earlier iteration reprompts for a duplicate and then settles `missing_blocker` (#3029, seed `blocker-contract-credits-existing-section`).

- [x] [00 - Accept a non-empty `## Blocker` present at settle time](./00-accept-blocker-present-at-settle-time.md)
