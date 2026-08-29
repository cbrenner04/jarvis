## Verdict — changes required (3)

All four acceptance criteria are satisfied and the shipped behavior is correct. Three issues remain, all cheap and local.

**1. `v1/docs/quota-signals.md` — the new entry sits in an audit of an array that doesn't contain it.**
That section audits v1's own `src/agents/quota.ts` patterns, but the trusted-directory pattern was added only to the shared v2 classifier in `shared/invocation/agents.ts`. As written, the bullet reads as a v1 pattern that a reader will fail to find in v1's source. Additionally, every other entry marked `Matched` carries a `Sample link:` continuation line; this one asserts "Matched, 2026-08-29" with no link.
*Required outcome:* a reader of that doc can tell, without cross-checking source, which array actually holds this pattern — either by relocating the entry out of the v1 array audit into a clearly-scoped v2/shared section, or by re-framing the surrounding structure so the v2-only scoping is unambiguous at the section level rather than only in the bullet's trailing caveat. The entry must also follow the file's `Matched` evidence convention.

**2. `v2/docs/shared-invocation.md` — the inserted sentence orphaned the following sentence's subject.**
Rewriting `It settles into ...` to `Settles into ...` left the implied subject as "Trusted-directory refusals," so the paragraph now reads as if only refusals settle into `ok | quota | model_config | error`. The refusal sentence also lands mid-usage-finalization prose, far from the argv line it qualifies.
*Required outcome:* the settle-into sentence unambiguously describes the codex binding, and the refusal/classification note reads adjacent to the argv it relates to.

**3. `shared/invocation/agents.test.ts` — the fallback test does not prove *why* it advanced.**
Asserting only `attempts.length === 2` and `final.result.kind === "ok"` passes under any advance path; it would not distinguish the intended trusted-directory→`quota` classification from an unrelated advance, which is precisely the mechanism this spec introduces.
*Required outcome:* the test pins that the first attempt settled as an advancing quota/auth-failure result carrying the refusal stderr, and that the successful result came from the second binding. Behavior and public API are unchanged — test assertions only.

## Not upheld

- **Flag-rejection on older/newer codex binaries** (binary emits an unexpected-argument error): the ledger names and declines this case; it fails loudly and uniformly on the first invocation, unlike the silent single-stage kill this spec fixes. Follow-up intent, not a defect here.
- **`authFailure: true` is a semantic overstatement** (the refusal is not an auth failure): correct observation, but AC #2 pins that exact shape and two doc bullets state it. Changing the classification array now would break a satisfied criterion. Raise as a follow-up.
- **Combined stdout+stderr matching can false-positive on self-referential text**: pre-existing matching behavior, explicitly weighed and accepted in the ledger (false advance costs one rung; false terminal kills the stage), and gated on non-zero exit.
- **Unconditional flag in `danger-full-access`**, **`v1-behaviors.md:444` v1 paragraph**, **splitting the codex classification mega-test**: deliberate ledger decisions or pre-existing structure; no action.