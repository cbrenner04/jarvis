# Guard checkpoint finding modeling

## Problem

Guard verification exposes enough information to reject unlinked and hollow checkpoints, but not a stable, repairable finding for every inert mutation behind a criterion.

## Behavior

Each resolved guard miss projects a structured finding with the criterion text and the resolved criterion pin path. Unlinked findings identify their absent directive; hollow findings identify each inert linked directive/mutation. Findings are deterministic and deduplicated without replacing the resolved pin with directive metadata.

## Decision ledger

- Retain the resolved criterion pin as `pinPath` for unlinked and hollow findings — rules out deriving it from directive metadata.
- Give each hollow finding the directive path, line, and directive text or equivalent mutation identity — rules out an anonymous "hollow" reason when several directives link to one criterion.
- Project every inert linked directive for a criterion, sort by resolved pin and directive position, and deduplicate identical directive identities — rules out collapsing distinct repair work or nondeterministic prompts.
- Keep `target_absent` and `target_ambiguous` in the existing mutation-directive repair path; only malformed, non-repairable directive syntax joins the hard-block class — rules out narrowing existing repair eligibility.

## Tasks

- [ ] Project eligible guard report entries into structured reprompt findings with criterion, resolved pin path, reason, and hollow mutation identity.
- [ ] Classify malformed directive syntax separately from existing `target_absent` and `target_ambiguous` mutation-repair reasons.
- [ ] Cover resolved-path projection, multi-directive hollow findings, deterministic ordering/deduplication, and repairable-versus-hard directive reasons.

## Acceptance criteria

- [ ] `projects resolved guard pin paths and hollow mutation identities` in `v2/src/execution/write.test.ts` fails against the pre-fix report projection and passes when both unlinked and hollow findings retain the criterion's resolved repo-relative pin, with each hollow directive's identity.
- [ ] `projects every hollow directive deterministically` in `v2/src/execution/write.test.ts` covers multiple inert directives linked to one criterion and verifies stable directive-position order with duplicate identities emitted once.
- [ ] `target-absent and target-ambiguous retain mutation-directive reprompt eligibility` in `v2/src/execution/write-loop.test.ts` stays green; malformed directive syntax still reaches the existing hard-block result.
- [ ] `v2/src/execution/write.test.ts` — `projects resolved guard pin paths and hollow mutation identities`; Mutation checkpoint: inverting resolved-criterion-pin projection turns this pin red.
- [ ] `v2/src/execution/write.test.ts` — `projects every hollow directive deterministically`; Mutation checkpoint: inverting per-directive projection or deterministic deduplication turns this pin red.
- [ ] `v2/src/execution/write-loop.test.ts` — `target-absent and target-ambiguous retain mutation-directive reprompt eligibility`; Mutation checkpoint: inverting the repairable-reason classification turns this pin red.
- [ ] Every added or modified finding, identity, ordering, deduplication, and reason-classification guard has an in-test `// @mutate` directive on the real source branch whose inversion turns its named regression red.

## Documentation updates

- None; write-loop behavior and operator-facing reason instructions are documented in subspec 01.
