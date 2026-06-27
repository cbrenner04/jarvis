import type { Config, Project } from "./config.ts";
import { inferStackFromRoot } from "./stack-inference.ts";

export type RunbookContext = {
  projectKey: string;
  projectRoot: string;
  projectOrigin: string | undefined;
  config: Config;
  project: Project;
};

export const VALID_RUNBOOK_SECTIONS = ["Known gotchas", "Gate blind spots", "Cross-repo coordination"];

function formatAgentOrder(config: Config): string {
  const agents = config.modes.patch.agentOrder ?? [];
  if (agents.length === 0) {
    return "(not configured)";
  }
  return agents.map((e) => `${e.agent} (${e.model})`).join(", ");
}

function formatCommitMode(config: Config): string {
  const commit = config.modes.plan.commit;
  if (commit === undefined) {
    return "not configured";
  }
  return commit ? "true" : "false (external specs)";
}

function formatPrNarrative(config: Config): string {
  return config.modes.patch.prNarrative ?? "not configured";
}

/**
 * Renders the OPERATOR_RUNBOOK.md content for a project.
 *
 * Combines init-time facts (repo path, origin, stack) with config-resolved values
 * (readyCommand, modes) and stubbed sections for operator fill-in.
 *
 * Fixed section headings, in order:
 * - Project facts
 * - Spec layout
 * - Repos and gates
 * - Sandbox and network
 * - Known gotchas
 * - Manual finalize and recovery
 * - Resume-first guidance
 * - Gate blind spots
 * - Cross-repo coordination
 *
 * @param ctx Context with project metadata and resolved config.
 * @returns Rendered markdown string. Ready to write to disk.
 */
export function generateOperatorRunbook(ctx: RunbookContext): string {
  const stack = inferStackFromRoot(ctx.projectRoot);
  const readyCommand = ctx.project.readyCommand ?? "not configured";
  const originLine = ctx.projectOrigin ? `- **Origin:** ${ctx.projectOrigin}` : "- **Origin:** no origin configured";

  const agentOrder = formatAgentOrder(ctx.config);
  const commitMode = formatCommitMode(ctx.config);
  const prNarrative = formatPrNarrative(ctx.config);

  return `# Operator Runbook

## Project facts

- **Project key:** \`${ctx.projectKey}\`
- **Root:** ${ctx.projectRoot}
${originLine}
- **Inferred stack:** ${stack}
- **Ready command:** ${readyCommand}
- **Plan commit mode:** ${commitMode}
- **Patch agent order:** ${agentOrder}
- **Patch PR narrative mode:** ${prNarrative}

## Spec layout

Jarvis organizes specifications and implementation runs in the following structure at the configured \`plan.targetDir\` (default: \`spec\`):

- **Seeds:** \`<targetDir>/seeds/\` — reusable problem statements and design sketches, checked into the repo.
- **Ready-intents:** \`<targetDir>/ready-intents/\` — finalized specs ready for a \`jarvis run\`.
- **Active/completed specs:** \`<targetDir>/<UTC-timestamp>-<name>/\` during work; moved to \`<targetDir>/completed/\` when merged.

### External specs for \`commit:false\` mode

When \`modes.plan.commit\` is \`false\`, plan-mode specs are **not** committed to the repo. Instead:

1. The spec lives at \`~/.jarvis/specs/<project-key>/\` on the operator's machine.
2. A **symlink** at \`<targetDir>/<UTC-timestamp>-<name>\` → \`~/.jarvis/specs/<project-key>/<...>\` appears in the working tree during \`jarvis plan\` and after \`jarvis run\`.
3. When the spec is finalized and merged, the symlink is committed (the symbolic reference, not the external spec content).
4. After merge, the external spec file persists at \`~/.jarvis/specs/<project-key>/\` for reference; it is not deleted.

This arrangement keeps large or sensitive spec-authoring work out of the repo history while preserving a traceable link for operators.

## Repos and gates

| Repo | Path/URL | Gate |
|------|----------|------|
| Target | ${ctx.projectRoot} | ${readyCommand} |

## Sandbox and network

### Sandbox blindness

The agent runs in a sandbox with restricted filesystem access and cannot directly observe rendered output, UI interactions, or live service behavior. When an agent builds a feature, you must **verify in the real app**—do not trust the agent's claim that "it works." Before merging:

- Start the dev server locally.
- Interact with the feature manually.
- Inspect the rendered output, CSS, animations, network calls.
- Test edge cases the spec describes.

The agent can run tests and type-check, but cannot see the actual UI. Any agent-unfalsifiable claim requires operator verification.

### Network-restricted runs

Jarvis runs with network access to GitHub (for git operations) and to any build/package-manager registries your stack requires. Other network access is not available and is not a target for hardening; if you need external services during a build, add them to the readyCommand dependencies or inject them as environment variables, not as new network policies.

## Known gotchas

- **External spec symlinks:** When \`modes.plan.commit: false\`, a plan-mode spec becomes a symlink in the working tree. **Do not delete the file at \`~/.jarvis/specs/<project-key>/\` by hand.** The symlink breaks if the external file disappears. If the runbook itself changes, verify the \`~/.jarvis/specs/\` arrangement hasn't been broken by a prior cleanup run. [GitHub issue: #529](https://github.com/cbrenner04/jarvis/issues/529)

- **Re-running init on the same project:** \`jarvis init\` is idempotent and re-runs safely. The config is always updated; the runbook is never overwritten. If you change the project's root or remote, update \`~/.jarvis/config.json\` by hand or delete the config entry and re-run \`jarvis init\`. [GitHub issue: #598](https://github.com/cbrenner04/jarvis/issues/598)

## Manual finalize and recovery

### Finalization checklist

When a spec run completes (all acceptance criteria checked), the implementation is ready for final review and merge. Before admin-merging:

- [ ] All acceptance criteria are ticked in the spec.
- [ ] Tests pass: \`${readyCommand === "not configured" ? "[readyCommand not configured]" : readyCommand}\`
- [ ] The PR passes all CI checks.
- [ ] The diff is code-correct, in-scope, and leaks no secrets.

If any check fails, do not merge; contact the operator or leave a note for the next session.

### Recovery by exit reason

Record the exit reason and recovery steps here if a run is blocked or fails unexpectedly. Examples:

- **Agent quota hit:** Note which agent; plan next-iteration fallback.
- **Syntax error after agent edit:** Record the error; mark the subspec with a \`## Blocker\` section and stop; Jarvis will detect it and exit with code 7.
- **Transient network failure:** Retry the run from the blocked subspec.
- **Conflicted merge after git pull:** Resolve conflicts manually and continue.

## Resume-first guidance

If a run is interrupted (agent killed, operator ^C, timeout):

1. **Check the last-run state:** Review the PR branch and the active subspec's acceptance criteria. Some work may already be complete.
2. **Resume from the blocked subspec:** Do not re-run from scratch unless starting a new task. \`jarvis run <spec>\` with the same \`index.md\` resumes from the last unchecked criterion.
3. **Verify the worktree:** If the branch is stale or diverged from main, \`jarvis run --reset-worktree\` (or delete the worktree by hand and re-run).
4. **Check for hanging git locks:** If you see "another git process is running," check for stale lock files under \`.git/\` and remove them before re-running.

## Gate blind spots

The \`readyCommand\` gate (\`${readyCommand}\`) is the harness-enforceable check. However, gates are often incomplete. Record known gaps here so operators don't rely on a passing gate as a complete readiness signal:

- *Example:* The lint gate only checks style; semantic code audits are manual.
- *Example:* Tests pass, but the feature requires visual verification (agent cannot see the UI).

**Add entries as you discover gaps during code review.**

## Cross-repo coordination

If this project depends on or is depended on by other tracked projects, record the dependency graph and any hand-offs here:

- *Example:* "API server (api/) and web client (web/) are separate specs; runs must complete in API→web order to avoid compilation breaks."
- *Example:* "Before merging a schema change in schema-repo, notify the downstream-consumer team and wait for their ready confirmation."

**Record inter-project constraints so the next operator does not introduce merge ordering bugs or missed hand-offs.**
`;
}
