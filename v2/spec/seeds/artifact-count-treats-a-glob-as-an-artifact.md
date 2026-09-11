---
name: artifact-count-treats-a-glob-as-an-artifact
---

# The one-artifact-per-bullet rule counts a glob as a named artifact

## Problem

The plan-contract gate blocked a sound daemon-identity plan draft on this Decisions bullet:

```text
- Real-socket coverage goes in a `*.sandbox-unrunnable.test.ts` file, matching
  `keyed-daemon-coexistence.sandbox-unrunnable.test.ts`; rules out sandboxed CI treating
  socket-bind denial as a product failure.
```

verdict: `has a ## Decisions bullet naming multiple artifact paths (*.sandbox-unrunnable.test.ts, keyed-daemon-coexistence.sandbox-unrunnable.test.ts) … (read as built or changed)`.

The bullet names **one** artifact. `*.sandbox-unrunnable.test.ts` is a naming convention, and the second token is the existing file that exemplifies it — the bullet's whole content is "follow this convention, like that file does". The gate counts the wildcard as a second concrete artifact because `BACKTICKED_PATH_PATTERN` (`shared/module-boundary-surfaces.ts:33-34`) admits `*` inside its filename class:

```text
([^`\s/]+\.(?:md|tsx?|jsx?|json|sh|ya?ml|toml|txt|swift))
```

The negated class excludes backtick, whitespace and `/` only, so `*` survives it and `*.sandbox-unrunnable.test.ts` parses as a filename.

The two exemptions added by [#3741](https://github.com/cbrenner04/jarvis/pull/3741) do not reach this, and should not have to: both key on *wording* (`isStaysUnchangedBullet` on preservation verbs, `isSharedDecisionBullet` on `identical`/`the same`), while this is *structural* — a pattern and an instance of it are not two artifacts under any phrasing. Adding a third wording marker would be the wrong fix.

This is the sixth instance of the "strict lexical patterns fail closed" class and the second in two days on a well-formed draft. The cost is the documented one: the lane stops, an operator rewords one bullet by hand, and a review cycle that already ran is either recovered or redrafted. Here it blocked the head lane of the daemon-identity chain, recovered via `jarvis pipeline recover` after a one-line reword.

## Decisions

- A backticked token containing a glob metacharacter (`*`, `?`, or a `[…]` class) is not a referenced artifact path; `referencedArtifactPaths` excludes it. It names a class of files, so it cannot be the single artifact a bullet builds.
- Scope is `referencedArtifactPaths`, so every consumer of the artifact count changes together rather than the single-artifact assertion growing a private exception.
- Rules out a third wording-marker exemption: the defect is that a pattern is parsed as a concrete path, not that the bullet's prose is unusual.
- Rules out dropping the extension requirement or otherwise widening what counts as a path; a bullet naming two genuinely concrete files must still refuse.

## Acceptance criteria

- [ ] A test proves a Decisions bullet naming one glob (`*.sandbox-unrunnable.test.ts`) alongside one concrete file is accepted; it fails against the current pattern, which reports two artifact paths.
- [ ] A test proves a bullet naming two concrete files still refuses with the existing message; it passes before and after.
- [ ] A test proves a bullet naming only a glob and no concrete file is accepted; it fails against the current pattern.
- [ ] A test proves `?` and `[…]` glob forms are excluded on the same rule as `*`; it fails against the current pattern.
- [ ] A test proves the `## Documentation updates` heading shares the behavior, since it uses the same counter.
- [ ] `v2/docs/spec-guidance.md` states that a glob names a convention rather than an artifact, so a bullet may cite one alongside the artifact it builds.
- [ ] `v2/docs/v1-behaviors.md` records the narrowed artifact-path parse.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/spec-guidance.md` — globs are conventions, not artifacts, for the one-artifact-per-bullet rule.
- `v2/docs/v1-behaviors.md` — the narrowed `referencedArtifactPaths` parse.
