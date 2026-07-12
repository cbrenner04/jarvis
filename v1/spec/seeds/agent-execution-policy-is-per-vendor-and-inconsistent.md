# Agent execution policy is delegated per-vendor, so it's inconsistent and implicit

Closes the verifiable core of intake #1453. Jarvis decides *which* agent runs, but
not *what it may do* — that is delegated to each vendor CLI, and only one of the four
actually constrains anything. The security posture of a run therefore depends on
which rung of `agentOrder` happened to answer.

## Problem

Verified on `main` 2026-07-12.

**Only codex is sandboxed.** `v1/src/agents/codex.ts:70`:

```ts
const argv = ["exec", "--color", "never", "--sandbox", "workspace-write", "-c", 'approval_policy="on-request"'];
```

`claude.ts`, `cursor.ts`, and `opencode.ts` pass **no** sandbox or approval flags at
all. So an identical spec, run through the same `jarvis1 run`, is workspace-confined
if codex takes it and unconstrained if the quota ladder falls through to claude. The
policy is invisible, unstated, and varies per invocation.

**Every agent inherits the operator's full environment.** `v1/src/agents/spawn.ts:27`:

```ts
const env = { ...process.env, PWD: config.cwd, GIT_TERMINAL_PROMPT: "0", ...config.env };
```

`GH_TOKEN`, provider API keys, and anything else in the operator's shell are handed
to every agent process. Nothing is scoped or withheld.

**The chokepoint already exists.** All four agents route through `spawn.ts`
(`spawn(config.binary, argv, { cwd, env, detached: true, stdio })`). There is exactly
one place a policy would need to be applied. It applies none.

## Scope

- Make execution policy **explicit and uniform** at the existing `spawn.ts`
  chokepoint, rather than delegated to whichever vendor CLI answered.
- Bring the three unconstrained agents up to the posture codex already has
  (workspace-write confinement), or state deliberately why an agent is exempt.
- Stop handing the operator's whole environment to every agent. Pass an allowlisted
  env; inject credentials only where the delegated command needs them.
- Record what policy a run executed under, so an operator can tell after the fact.

## Decisions

- **Apply policy at `spawn.ts`, do not add a `jarvis-agent-run` binary.** #1453
  proposes "a single execution abstraction"; it already exists. The gap is that no
  policy is applied at it. Per the north star, fold into the existing surface — a new
  wrapper command is a new manual step, not fewer.
- **Do not invent a role taxonomy.** #1453 proposes
  `observer/planner/worker/tester/reviewer/publisher`. Jarvis's actual concepts are
  modes (`patch`/`plan`/`review`/`prompt`) and `subRoleAgentOrder`
  (`reviewPanel`/`reviewActuator`). Any policy mapping keys off those, not off
  invented names.
- **No external sandbox dependency (e.g. Nono) in this slice.** This is a
  single-operator, personal-use harness (AGENTS.md). Start by making the *existing*
  posture consistent and the env non-leaky — that is most of the real risk, costs no
  new dependency, and is verifiable. Revisit an external policy runner only if a
  concrete need survives that.
- Uniformity is the goal, not maximal restriction. An agent that silently gets more
  privilege than its peers is the bug.

## Out of scope

- Per-command argument-prefix allowlists for `git`/`gh`/package managers (#1453's
  delegated-tool policies). Defer until the base posture is uniform.
- Network egress allowlisting.
- Audit envelope for denied operations.

## Documentation updates

- `v1/docs/agents.md` — state each agent's execution posture and where it is set.
- `v1/docs/operator-runbook.md` — note that policy no longer varies by which
  `agentOrder` rung answered.

## Provenance

Intake issue #1453 (harness-suggestion), which the owner flagged as written without
harness familiarity. Its command shapes (`jarvis "we need to fix foo"`,
`printf '%s' "$prompt" | claude --print`) do not exist in the CLI; its proposed
abstraction already exists as `spawn.ts`. The two claims that *did* verify — vendor-
delegated policy is inconsistent, and credentials leak wholesale — are what this seed
carries.
