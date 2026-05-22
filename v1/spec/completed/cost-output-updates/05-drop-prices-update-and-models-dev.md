# 05 - Drop `jarvis prices update` and the models.dev integration

## Problem

`jarvis prices update` pulls rates from <https://models.dev>. That source has two issues for us:

- It is one step removed from the vendor. We want rates that match what the vendor publishes today, not what a third-party aggregator has mirrored.
- It does not cover cursor at all (no models.dev entries for cursor models), so the cursor rows we are adding in subspec 04 have no automation path through this command anyway.

We checked: none of the vendors we use (Anthropic, OpenAI, Cursor) expose pricing via API. Anthropic's `GET /v1/models` returns capabilities and context window but no pricing fields. OpenAI's models API similarly omits pricing. Cursor publishes only an HTML pricing page.

The reasonable response is to stop pretending we can automate this. The agent set is small and stable. `as_of` on each row tells us when a human last verified it. `jarvis prices edit` already exists for manual updates.

## Decisions

- Remove the `update` subcommand from `jarvis prices`. Keep `show` and `edit` (and any other current subcommands) intact.
- Delete `src/prices/update.ts`, `src/prices/fetch.ts`, `src/prices/models-dev-map.ts`, and `src/commands/prices-update.ts`.
- Delete `test/prices-update.test.ts` along with any fixtures it owns. Update `test/prices.test.ts` if it references the `update` subcommand.
- Update `src/commands/prices.ts` help output: drop the `update` line, drop the mention of models.dev, leave the rest unchanged.
- Update `README.md` and any other docs that mention `jarvis prices update` or models.dev. Replace with a sentence: rates are maintained manually via `jarvis prices edit`; each row records `as_of` for when it was last verified.
- Leave `data/prices.json` alone for this subspec. Existing rates stay as-is. New rows from subspec 04 ship with null rates that the operator fills via `jarvis prices edit`.
- No `package.json` dependency cleanup is in scope here; if models.dev required any HTTP/parsing deps not used elsewhere, leave them — they may be useful for cursor estimation (subspec 04) or future work. Avoid drive-by removal.
- This subspec does not introduce a replacement automation. The intent of dropping models.dev is to make manual curation explicit, not to swap in a different scraper.

## Tasks

- [ ] Remove `update` from the `jarvis prices` subcommand dispatch and help text in `src/commands/prices.ts`.
- [ ] Delete `src/commands/prices-update.ts`.
- [ ] Delete `src/prices/update.ts`, `src/prices/fetch.ts`, and `src/prices/models-dev-map.ts`.
- [ ] Delete `test/prices-update.test.ts`.
- [ ] Audit and update any other test files that import from the removed modules.
- [ ] Update `README.md` to remove references to `jarvis prices update` and models.dev; replace with a one-line description of manual maintenance via `jarvis prices edit`.
- [ ] Update `docs/run-loop.md` (and any other doc that mentions price refresh) similarly.
- [ ] Run `bun run typecheck` and `bun test`; fix any broken imports or references.

## Acceptance criteria

- [ ] `jarvis prices --help` no longer lists `update`.
- [ ] `jarvis prices update` exits with a clear "unknown subcommand" message (or whatever the existing dispatcher does for unknown subcommands; do not add special-case handling).
- [ ] `rg models\.dev` returns no matches in `src/`, `test/`, `docs/`, or `README.md`.
- [ ] `src/prices/update.ts`, `src/prices/fetch.ts`, `src/prices/models-dev-map.ts`, `src/commands/prices-update.ts`, and `test/prices-update.test.ts` do not exist.
- [ ] `jarvis prices show` and `jarvis prices edit` continue to work as today.
- [ ] `data/prices.json` is unchanged by this subspec (subspec 04 owns the cursor row changes).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- README: remove the `prices update` paragraph; mention `prices edit` as the maintenance path; remove the models.dev link.
- `docs/run-loop.md`: drop any "rates auto-refreshed from models.dev" wording; replace with one line on manual curation and `as_of`.
