## Verdict — refinements required

**1. Drop the `--version` precedence decision; replace with a preservation criterion.**
The spec asserts `--version` "keeps precedence" over the help alias, but the version branch only fires when it is the sole argument — `jarvis --version --help` exits 1 today. The decision describes non-existent behavior and frames a new branch as preservation, and it contradicts the spec's own rule that an empty leading segment run renders root help. Remove it. Add instead a preservation criterion that `jarvis --version` alone still prints the version after the intercept is inserted (that is the real regression risk), and let `jarvis --version --help` fall out of the general path rule.

**2. Fix the help-path rule so commands taking positionals don't regress.**
`run log|pause|resume|kill|wait <run-id>` and `tui log <run-id>` take bare positionals. Under the drafted rule, `jarvis tui log abc123 --help` computes the path `["tui","log","abc123"]`, hits the unknown-segment branch, and exits 1 — reproducing exactly the operator-hostile failure this intent exists to remove, in a shape the registry-walk test can never catch. The spec must specify a path rule that resolves to the nearest real registry node (e.g. truncating the leading non-flag run to its longest prefix that resolves in the command tree), and must narrow the unknown-segment error decision accordingly so it fires only when the first segment itself is unknown (`jarvis nope --help` keeps its behavior and its criterion). This same rule must also cover dispatchable-but-untreed aliases such as `run workflow intent-reviewed`, which should render the nearest ancestor's help rather than erroring.

**3. Resolve the `--help`-inside-a-flag-value collision explicitly.**
`run workflow intent --seed-text "<prose>"` takes arbitrary text, and this repo's own seeds routinely quote CLI flags — under "the flag may appear anywhere," a legitimate run gets hijacked into a help render. The spec must state a decision that closes this, either by requiring the alias to be the *first* `-`-prefixed token, or by honoring a `--` sentinel. Whichever is chosen, add a criterion pinning that a `--seed-text` value containing `--help` still runs the command. If the first-flag-token rule is chosen, drop the now-unreachable `--ready-intent foo --help` criterion; the two intent-level criteria (`jarvis --help`, `jarvis run workflow --help`) remain satisfied either way.

**4. Pin token-matching semantics.**
State that only exact whole tokens `--help` and `-h` trigger the alias — no `--help=<value>`, no short-flag bundling. One line in Decisions; prevents the implementer from inventing a looser match.

**5. Add `v2/docs/v1-behaviors.md` to Documentation updates.**
This changes existing documented behavior (unknown top-level command exits 1 no longer holds for `--help`/`-h`) and lands a v1-parity entry. Repo rule: any spec altering existing functionality must update that catalog, or the v2 parity baseline silently rots.

**6. Right-size the coverage criterion and add the off-tree shapes.**
The registry-walk criterion is good coverage of tree paths but cannot reach positional-bearing invocations, untreed aliases, or flag values, so "every registry node" reads as more exhaustive than it is. Keep the walk, drop the exhaustiveness framing, and add explicit criteria for the three off-tree shapes above (positional after a command, untreed alias, `--help` inside a flag value).

**7. Correct the guard-inversion criterion.**
It currently lists the unknown-segment exit-1 branch as an added guard, but that branch already exists in the help renderer — inverting it does not test this change. Restate it to name only the guards this change introduces (alias detection, the flag-position rule, and the path-resolution/truncation rule).

**Not upheld:** the absence of a usage line on the root help node. That is pre-existing `jarvis help` behavior, and matching `help` output exactly is the point of this change; adding one would alter `jarvis help` and pull in further behavior-catalog updates. At most, note it in the doc update.

**Scope:** no split needed — after these refinements the work remains one atomic seam in the CLI entrypoint.