# 00 - Document production-logic double convention

Add the v2 test-writing convention that tests must not reimplement production
logic as local doubles. Use the daemon run-control handler drift as the worked
example: `daemon-start-list.test.ts` should exercise
`createRunControlHandlers` over injected fakes, not local copies of
`start`/`list`/`pause`/`resume`/`kill`.

## Decisions

- Put the convention only in `v2/docs/test-writing.md` - rules out duplicating it across daemon or module docs.
- Use the daemon handler factory plus `daemon-start-list.test.ts` migration as the worked example - rules out abstract-only guidance.
- Deferred to first consumer: automated lint/review enforcement - pin when a follow-on enforcement spec needs it.

## Tasks

- Add a "do not reimplement production logic in test doubles" convention to `v2/docs/test-writing.md`.
- Explain the acceptable pattern: call the production entry point/factory with injected fakes for external seams.
- Add the daemon run-control handler drift worked example with before/after guidance.
- Keep the existing automated-enforcement deferral intact.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` tells v2 test authors not to reimplement production logic in local doubles when a production factory/entry point can be exercised with injected fakes.
- [ ] `v2/docs/test-writing.md` cites the daemon run-control handler case and names `createRunControlHandlers` plus `daemon-start-list.test.ts` as the expected pattern.
- [ ] `v2/docs/test-writing.md` keeps automated lint/review enforcement deferred; this slice adds documentation only.

## Documentation updates

- `v2/docs/test-writing.md` - add the convention and daemon worked example.
