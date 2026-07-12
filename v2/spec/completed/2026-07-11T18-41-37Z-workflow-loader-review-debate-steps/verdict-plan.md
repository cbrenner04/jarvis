## Verdict — Required Refinements

**Upheld: the central load mechanic is undecided (findings 1, 2, 6 — one gap).**

The spec widens the loader input to a `write | review-debate` union and says to "build the four-role record," but never states *how the loader discriminates the two kinds*. Today the loader unconditionally resolves a single per-step `role` and attaches a flat `agents` array — both assumptions break for a debate step, which has no single `role` field and needs the `ReviewDebateStepAgents` four-role record, not a flat array. This is the load-bearing mechanic of the whole subspec, and a competent implementer could plausibly get it wrong (attempting to reuse the write path). It must be a decision, not a discovery.

- **Required:** Add a decision that the loader's source-step input becomes a `behavior`-discriminated shape, and that loading branches on `behavior`: the debate branch skips the single-`role` executability pre-check and constructs the four-role agents record, while the write branch keeps its flat attach. This is a harness subspec, so naming the discriminated input shape is appropriate (structure is the contract).

**Upheld (minor): the return-type change is unstated.**

Loading currently yields write steps only; after this it yields a `write | review-debate` union. This is an observable interface change and would leave the doc's signature stale.

- **Required:** Pin the widened return type in both a decision and the doc acceptance criterion.

**Upheld (minor): the absent-config fallback for debate roles is a real choice.**

When machine config yields no order, the loader falls back to a default order. Whether that default legitimately seeds all four debate roles (degrading cleanly into aggregated validation) or should instead fail is a choice a reasonable implementer could make either way.

- **Required:** Record one line resolving this — either an explicit decision that debate roles inherit the same default order, or a `Deferred to first consumer` note.

**Not upheld: mixed write + debate aggregation test.**

The intent's distinguishing behavior (aggregate every missing tuple rather than fail on the first) is already exercised by the planned debate-only multi-role miss test. Cross-step-kind aggregation is pre-existing, unchanged validator behavior. An additional mixed test is optional additive coverage, not a required gap — do not mandate it.

**Scope note:** The subspec is correctly atomic and single-path; no split is required. All upheld items are decision-record omissions to close, not scope changes.