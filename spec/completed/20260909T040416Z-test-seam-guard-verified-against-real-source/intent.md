# The generalized test-seam guard detects nothing, and its acceptance criteria cannot tell

## Problem

`scripts/guard-production-test-flags.ts` was generalized ([#3588](https://github.com/cbrenner04/jarvis/pull/3588)) from the historical `invert*ForTest` family to also forbid `set*ForTest`/`set*ForTests` exports, `*ForTest`/`*ForTests` module variables, function parameters, and type members. The change ships 74 passing tests, a green gate, and a `shared/prompts/step-rules.ts` instruction telling every implement agent not to add those shapes.

It detects **zero** of them in production. Running the branch's guard over `v2/src` + `shared` returns no violations, while the seams its own spec names as "reachable on main today" sit untouched:

- `v2/src/execution/write-loop.ts:347` — `bypassPersistedReadyGateRepairFenceForTest?: boolean;`
- `v2/src/execution/workflow-runner-resume.ts:1642,1644` — `bypassPersistedReadyGateRepairFenceForTest`, `mutationRepairBindingFactoryForTest`
- `v2/src/execution/diff-derived-mutation-verifier.ts:223,861` — exported `resetVerifierTestRunTrackingForTest()`, `isInsideTimerCallbackForTest(...)`

Verified directly: `bun run scripts/guard-production-test-flags.ts` exits `0` with `bypassPersistedReadyGateRepairFenceForTest` present in production source.

## Why it misses

Three independent faults in the brace-window matching (`guard-production-test-flags.ts:143-146`):

1. The type-alias character class ``[\w<>,\s=`]*`` omits `&` and `|`, so `type Deps = OtherDeps & { … }` never matches. Intersection-typed dependency bags are the dominant shape in this codebase.
2. `\{[^}]*\b(\w+ForTests?)\s*\??:` cannot cross a `}`, so **any** nested object member appearing before the seam hides it. `WriteLoopInput` has `bindingResolution?: { … }` before line 347.
3. The generic fallback `<[^>]*\b(\w+ForTests?)\b` cannot cross a `>`, so any earlier generic (`Pick<…>`) closes the window.

Separately, the export rule matches a literal `set` prefix (`set(?!Invert)\w+ForTests?`), so a plain exported `*ForTest` helper — the most common real seam — is covered by no rule at all.

## Why the gate could not tell

Every rejection fixture in `scripts/guard-production-test-flags.test.ts` is a single-line, zero-nesting, zero-intersection construct. Each does fail against the pre-fix patterns, so none is vacuous in isolation — but not one resembles the production shapes the guard exists to catch, so 74 green tests are fully consistent with an inert guard. The twelve `allows … in .test.ts` cases pin nothing: the pre-fix guard also returned empty for them.

This is the repo's standing failure mode — a green gate and ticked criteria over a no-op — and the acceptance criteria are the reason it was invisible.

## Decisions

- The guard's acceptance evidence is drawn from **real production source**: a fixture corpus lifted verbatim from current `v2/src` seams (intersection-typed dep bag, a type with a nested object member preceding the seam, a member following a generic, an exported `*ForTest` helper); rules out synthetic single-line fixtures as sufficient evidence for a scanner whose whole job is matching real code.
- Detection keys on declaration structure rather than brace-window regex scanning — a TypeScript AST pass over type members, parameters, and exports; rules out extending the character classes and window patterns one shape at a time, which is what produced three independent misses in one change.
- An exported `*ForTest`/`*ForTests` function is a forbidden shape in its own right, not only under a `set` prefix; rules out a rule set whose name-prefix assumption excludes the most common seam.
- The guard is verified by a meta-test that asserts it flags every seam currently present in `v2/src`, enumerated at run time rather than hand-listed; rules out a hand manifest that silently rots as seams are added or removed.
- Retiring the seams themselves is separate work; this seed makes the guard honest, and the guard's own run enumerates what must then be retired; rules out coupling a detection fix to an unbounded source cleanup.
- Until detection is real, `shared/prompts/step-rules.ts` must not instruct agents about shapes the guard does not enforce; rules out a prompt that overclaims relative to shipped behavior.

## Acceptance criteria

- [ ] A test proves the guard flags `bypassPersistedReadyGateRepairFenceForTest` at its real position inside `WriteLoopInput` (a type with a nested object member preceding it); it fails against the current `[^}]*` window.
- [ ] A test proves the guard flags a seam declared on an intersection type alias (`type A = B & { fooForTest?: boolean }`); it fails against the current type-alias character class.
- [ ] A test proves the guard flags an exported `*ForTest` function with no `set` prefix; it fails against the current export rule.
- [ ] A test proves the guard does **not** flag ordinary production code that merely mentions such an identifier — a generic instantiation (`new Map<string, RunnerForTests>()`) and a control-flow condition (`if (fooForTest) {`) — pinning the false positives the current patterns produce.
- [ ] A meta-test enumerates the seams present in `v2/src` at run time and proves the guard reports every one; it fails against the current inert scan.
- [ ] `bun run check`, `bun run typecheck`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — the forbidden test-seam shapes, matching shipped enforcement rather than the aspirational list.
- `v2/docs/test-writing.md` — same list, and that the guard is verified against real source.
- `v2/docs/v1-behaviors.md` — record the widened enforcement.
