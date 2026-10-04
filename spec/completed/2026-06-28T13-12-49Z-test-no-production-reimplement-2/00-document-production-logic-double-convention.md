# 00 - Document production-logic double convention

Add the v2 test-writing convention that tests must not reimplement production
logic as local doubles when an exported production seam already owns that
behavior. Ordinary fakes/spies remain valid for dependencies outside that
logic boundary.

Use daemon run-control handler drift as the anti-pattern example:
`daemon-start-list.test.ts` is the expected pattern because it exercises
`createRunControlHandlers` over injected fakes instead of local copies of
`start`/`list`/`pause`/`resume`/`kill`.

## Decisions

- Put the convention only in `v2/docs/test-writing.md` - rules out duplicating it across daemon or module docs.
- Define the unit under test as the exported production unit that owns the behavior - rules out replacing owned behavior with a test-local replica.
- Allow fakes/spies only for dependencies outside that logic boundary - rules out treating the convention as a general anti-mocking rule.
- Use the daemon handler factory plus `daemon-start-list.test.ts` as the drift example - rules out implying a required live migration.
- Deferred to first consumer: automated lint/review enforcement - pin when a follow-on enforcement spec needs it.

## Tasks

- Add a "do not reimplement production logic in test doubles" convention to `v2/docs/test-writing.md`.
- Explain the seam boundary: call the exported production unit that owns the behavior, with injected fakes/spies only for dependencies outside that unit.
- Add the daemon run-control handler drift example as the mistake `daemon-start-list.test.ts` avoids, not as a required live migration or reconstructed diff.
- Keep the existing automated-enforcement deferral intact.

## Acceptance criteria

- [x] `v2/docs/test-writing.md` tells v2 test authors not to reimplement owned production behavior in local doubles when an exported production seam can be exercised with injected fakes.
- [x] `v2/docs/test-writing.md` allows ordinary fakes/spies for dependencies outside the logic boundary and defines the unit under test as the exported production unit that owns the behavior.
- [x] `v2/docs/test-writing.md` cites daemon run-control handler drift as the anti-pattern avoided by the expected `createRunControlHandlers` plus `daemon-start-list.test.ts` pattern.
- [x] `v2/docs/test-writing.md` keeps automated lint/review enforcement deferred; this slice adds documentation only.

## Documentation updates

- `v2/docs/test-writing.md` - add the convention and daemon worked example.
