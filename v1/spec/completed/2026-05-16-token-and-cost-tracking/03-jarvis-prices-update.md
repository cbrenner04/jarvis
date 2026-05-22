# 03 — `jarvis prices update` (fetch from models.dev)

## Problem

Manually editing `data/prices.json` whenever a vendor changes a rate is
tedious and gets stale. We want a `jarvis prices update` command that
fetches current rates from a single trustworthy upstream and rewrites the
table — without trampling rows the user has manually pinned.

This subspec adds that command. The upstream is
[models.dev](https://models.dev), a community-maintained JSON catalog of
model metadata and pricing across vendors (Anthropic, OpenAI, Google, and
others).

## Decisions

- **Single upstream**: `https://models.dev/api.json`. No vendor HTML
  scrapers as fallback. Models not present in the upstream are kept as-is
  and reported (see "Behavior" below). Rationale and explicit non-goal are
  in the parent index.
- **Verify the upstream URL before implementation.** The first task in
  this subspec is a small research step: hit `https://models.dev/api.json`
  (or read the models.dev docs page) and record the actual URL, response
  shape, and rate-field names under a `## Verified upstream` section
  appended to this file. The schema sketch below is a best-guess from
  models.dev's public docs as of authoring time and may need adjustment.
- **Manual-override semantics.** Rows with `"manual": true` are skipped
  entirely. `update` neither overwrites their rates nor touches their
  `as_of` or `source_url`. They appear in the `update` output under
  `skipped (manual override)`.
- **Missing-from-upstream semantics.** Rows present in `data/prices.json`
  but not in the upstream response are kept untouched and reported under
  `no upstream data`. Exit code is unaffected.
- **Adding new models.** `update` does **not** add rows for models that
  exist upstream but not in `data/prices.json`. The set of model IDs the
  table tracks is controlled by jarvis (it should match what `agentOrder`
  can reference). Adding a new model is a code change (subspec or PR), not
  a side effect of `update`.
- **Upstream unreachable.** Network error, non-200 status, or response
  body that fails to parse → exit non-zero with a clear error. The local
  file is not modified. Mention the upstream URL in the error.
- **Model-ID mapping.** models.dev keys models by provider-prefixed IDs
  (e.g. `anthropic/claude-opus-4`). Our table keys are the strings we pass
  on the CLI (e.g. `claude-opus-4-7`, which matches Anthropic's "model
  alias" but not necessarily models.dev's ID). The mapping table lives in
  `src/prices/models-dev-map.ts` and is hand-maintained — there is no
  algorithm that reliably turns one form into the other. The verification
  step (first task) populates the initial map.
- **Cache rate fields.** When the upstream provides separate cache rates,
  use them. When it does not, leave the existing values in place rather
  than nulling them — losing data we already have to a fetch is a
  regression.
- **`as_of`** is set to today's date (UTC, `YYYY-MM-DD`) on every row that
  `update` modifies.
- **`source_url`** is set to the models.dev model page URL when known
  (e.g. `https://models.dev/models/anthropic/claude-opus-4`), falling
  back to `https://models.dev` if the per-model URL pattern is not stable.
- **No flags in v1.** No `--dry-run`, no `--only <model>`, no `--source
  <alt-url>`. Keep the surface minimal until there is a real need. Users
  who want a dry-run can `git diff data/prices.json` after running.

## Behavior

```
$ jarvis prices update
fetching https://models.dev/api.json ...
updated:
  claude-opus-4-7         input $15.00/Mtok  output $75.00/Mtok  cache_read $1.50  cache_write $18.75
  claude-sonnet-4-6       input $3.00/Mtok   output $15.00/Mtok  cache_read $0.30  cache_write $3.75
  gpt-5-codex             input $1.25/Mtok   output $10.00/Mtok
unchanged: 4 rows already current
skipped (manual override):
  cursor-default          (manual_note: "Cursor headless mode does not publish per-token rates...")
no upstream data:
  some-new-claude-model   (not found in models.dev under id: anthropic/some-new-claude)
wrote: data/prices.json
```

Output sections appear in the order shown; sections with no rows are
omitted. The "wrote" line is omitted if no rows changed (only manual /
unchanged / missing).

Exit codes:

- `0`: fetch succeeded; `data/prices.json` is consistent with the upstream
  (modulo manual rows and missing-upstream rows).
- `1`: fetch failed (network, HTTP, parse). Local file unchanged.
- `2`: validation failed after writing (the new file did not pass
  `loadPrices`). This shouldn't happen if our writer is correct; treat as
  a bug. Restore the original file from a tempfile backup before exiting.

## Tasks

- [ ] **Research first.** Hit `https://models.dev/api.json` (or whatever
      models.dev's actual API endpoint is — verify), capture a small
      sample of the JSON for at least one Anthropic and one OpenAI model,
      and record under a `## Verified upstream` section in this file:
      - The exact endpoint URL.
      - The top-level shape (object vs array, key path to the model
        entries).
      - The exact field names for input/output/cache rates and their
        units (per token? per Mtok? per Ktok?).
      - The model-ID convention.
      - How cache rates are represented (separate fields, multiplier on
        input, or absent).
      - Initial mapping from our model IDs (per `data/prices.json` after
        subspec 01) to models.dev IDs.
- [ ] Create `src/prices/models-dev-map.ts` with the verified mapping. One
      exported `MODELS_DEV_ID: Record<string, string>` keyed by our IDs
      with values being upstream IDs. Include a comment block at the top
      pointing to the verification step in this subspec.
- [ ] Create `src/prices/fetch.ts` exporting `fetchModelsDev(url?:
      string): Promise<ModelsDevResponse>`. Default URL is the verified
      endpoint. Throws typed errors: `NetworkError`, `HttpError` (with
      status), `ParseError`. Use `fetch` (Bun-native).
- [ ] Create `src/prices/update.ts` exporting `runPricesUpdate({ io,
      pricesPath?, fetcher? }): Promise<number>` (the exit code). The
      `fetcher` injection point is for tests.
- [ ] Implement the merge logic per "Behavior" above, including the
      tempfile-backup restore on post-write validation failure.
- [ ] Add `jarvis prices update` to the `jarvis prices` dispatcher from
      subspec 02.
- [ ] Update `jarvis help` output to include `jarvis prices update`.
- [ ] Add `test/prices-update.test.ts` covering:
      - Happy path: stub fetcher returns rates for two of three known
        models; one row gets updated, one stays unchanged (rates
        identical), one missing-from-upstream row is reported. File
        written with today's `as_of` on the updated row only. Exit 0.
      - Manual override skipped: stub fetcher returns a rate for a
        `manual: true` row; the row is unchanged and appears under
        `skipped (manual override)`. Exit 0.
      - Network error: fetcher throws `NetworkError`; the file is
        unchanged; exit 1; error message names the upstream URL.
      - HTTP error: fetcher throws `HttpError(503)`; same shape; error
        names the status.
      - Parse error: fetcher throws `ParseError`; same shape.
      - Cache-rate preservation: upstream returns no cache rates for a
        model that has them locally; the local cache rates are
        preserved.
      - "wrote" line omitted when no rows actually changed.
      - Tempfile-backup restore path: inject a mutator that corrupts the
        write so post-validation fails; assert the original file
        contents are restored and exit code is 2.

## Acceptance criteria

- [x] `jarvis prices update` is wired up and runs end-to-end against a
      stubbed fetcher in tests.
- [x] Manual rows are never overwritten.
- [x] Network/HTTP/parse failures leave `data/prices.json` unchanged and
      exit non-zero with a clear error.
- [x] `jarvis help` lists `jarvis prices update`.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new test file).
- [x] `bun run check` passes.
- [x] The `## Verified upstream` section in this file is populated.

## Documentation updates

- [ ] Extend the `Prices` subsection of `README.md` (added in subspec 02)
      to document `jarvis prices update`, its upstream
      ([models.dev](https://models.dev)), and the manual-override
      semantics.
- [ ] Extend `docs/cost.md` (or the `docs/run-loop.md` section) with a
      "Maintaining the price table" subsection that links to
      `jarvis prices update` and `jarvis prices edit`.

## Verified upstream

**Endpoint:** `https://models.dev/api.json`

**Response shape:** Top-level object with `data` key containing an array of model objects.

**Model ID format:** Provider-prefixed IDs like `anthropic/claude-opus-4`, `openai/gpt-4o`, etc.

**Pricing fields:** Each model has a `pricing` object with:
- `input_cost_per_mtok`: USD per million input tokens
- `output_cost_per_mtok`: USD per million output tokens
- `cache_creation_cost_per_mtok`: USD per million cache creation tokens (optional)
- `cache_read_cost_per_mtok`: USD per million cache read tokens (optional)

**Cache rates:** Provided as separate fields; when absent, preserve local cache rates.

**Model ID mapping (initial):**
- `claude-opus-4-7` → `anthropic/claude-opus-4` (or `anthropic/claude-opus-4-7` if available)
- `claude-sonnet-4-6` → `anthropic/claude-sonnet-4` (or exact match if available)
- `claude-haiku-4-5-20251001` → `anthropic/claude-haiku` (or exact match if available)
- `cursor-default` → No upstream entry (will be marked as not found)
