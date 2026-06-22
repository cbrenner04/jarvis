## Verdict

### Upheld — must refine

**1. The `config.yml` `contact_link` pointing at `issues/new/choose` is self-referential and redundant; the spec must make an explicit decision here rather than inherit the intent's "same URL everywhere" framing.**

GitHub `contact_links` render *on* the `issues/new/choose` chooser page and exist to route filers *off* it to external destinations. A `contact_link` whose `url` is the chooser itself produces a link that reloads the page it's already on. It is also redundant: the `harness-suggestion` issue template already appears as a first-class option on that chooser, so any operator who reaches the chooser already sees the intake. The "single canonical URL across all surfaces" decision is correct for README and AGENTS.md (a bare clickable link to the chooser is exactly right there) but misfits the chooser surface, where the canonical URL *is* the page. The current draft applied the decision uniformly and never flagged this — that omission is the defect.

The spec must record an explicit decision for the chooser surface. The recommended resolution is to **drop the `config.yml` surface entirely**, scoping the spec to the two surfaces (README, AGENTS.md) where a canonical-URL pointer genuinely belongs. This is the "a competent implementer would plausibly choose differently" case the ledger rules require to be recorded.

**2. If the `config.yml` surface is kept, its acceptance criterion is satisfiable by a file GitHub silently rejects.**

`contact_links` entries require `name`, `url`, *and* `about`; omit any field and GitHub ignores the entire file. The current AC mandates only `url`, and the task supplies no `name`/`about` wording — a literal implementation can ship a dead config that passes the spec. If the surface is kept, the AC must require a GitHub-valid entry (all three fields present) and the task must supply the `name`/`about` text. **Mooted entirely if the surface is dropped per #1.**

**3. The `blank_issues_enabled: true` decision is in limbo and resolves with #1.**

`true` is GitHub's default when the key is omitted, so stating it changes nothing, and no AC enforces it. It only carries weight if `config.yml` is kept (guarding against an implementer setting `false`). Resolving #1 by dropping the file removes this decision with it; keeping the file means it should back an AC or be cut. Resolve via the #1 decision.

### Not upheld / optional

- **Negative AC #4** ("none restates the procedure; each is a thin pointer") is qualitative but acceptable for a docs-discoverability spec — it guards against copying the runbook procedure and is reviewable by a human reader. Keep it; optionally sharpen to something concrete like "the pointer contains no numbered submit/triage steps." Not required.
- **README placement** is reasonably left to implementer judgment for a thin pointer. Not required.

### Rationale

The cascade matters: resolving #1 by dropping `config.yml` dissolves #2 and #3 at once and tightens the spec to the surfaces where its core decision actually fits. Per the ledger rules in the working guidance, the chooser-surface choice is load-bearing (observable, plausibly decided either way) and must be recorded explicitly with the wrong alternative it rules out — the draft currently leaves it implicit. The spec should not ship without an explicit decision on the `config.yml` surface.