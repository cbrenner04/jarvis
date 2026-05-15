import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeAgent } from "../../agents/claude.ts";
import { CodexAgent } from "../../agents/codex.ts";
import { CursorAgent } from "../../agents/cursor.ts";
import { OpencodeAgent } from "../../agents/opencode.ts";
import type { Agent, AgentResult } from "../../agents/types.ts";
import type { AgentName, Config } from "../../config.ts";

export type ReviewPhaseOptions = {
  worktreePath: string;
  name: string;
  config: Config;
};

/**
 * Build the review phase prompt by injecting intent.md, current spec files, and guidance.
 */
export function buildReviewPrompt(opts: {
  name: string;
  intent: string;
  specGuidance: string;
  currentSpec: string;
}): string {
  const promptFile = join(import.meta.dir, "prompts", "review.md");
  let template = readFileSync(promptFile, "utf8");

  template = template.replace("<WORKDIR>", opts.name);
  template = template.replace("<NAME>", opts.name);
  template = template.replace("<INTENT>", opts.intent);
  template = template.replace("<SPEC_GUIDANCE>", opts.specGuidance);
  template = template.replace("<CURRENT_SPEC>", opts.currentSpec);

  return template;
}

/**
 * Instantiate an agent from a config entry.
 */
function createAgent(agentName: AgentName, model: string | undefined): Agent {
  switch (agentName) {
    case "claude":
      return new ClaudeAgent(model ? { model } : {});
    case "codex":
      return new CodexAgent(model ? { model } : {});
    case "cursor":
      return new CursorAgent(model ? { model } : {});
    case "opencode":
      // OpenCode requires model to be set
      if (!model) {
        throw new Error("opencode agent requires model to be configured");
      }
      return new OpencodeAgent({ model });
  }
}

/**
 * Snapshot all current spec files into a string for prompt injection.
 */
function snapshotSpecFiles(worktreePath: string, name: string): string {
  const specDir = join(worktreePath, "spec", name);
  if (!existsSync(specDir)) {
    return "(spec directory does not exist)";
  }

  const files = readdirSync(specDir);
  // Exclude intent.md and non-markdown files
  const specFiles = files
    .filter((f) => f.endsWith(".md") && f !== "intent.md")
    .sort();

  const lines: string[] = [];
  for (const file of specFiles) {
    const filePath = join(specDir, file);
    const content = readFileSync(filePath, "utf8");
    lines.push(`## File: ${file}\n\`\`\`\n${content}\n\`\`\``);
  }

  return lines.length > 0 ? lines.join("\n\n") : "(no spec files found)";
}

/**
 * Run a single review pass: invoke an agent to critique and refine the spec.
 * Returns the agent result.
 */
export async function runReviewPass(
  opts: ReviewPhaseOptions,
): Promise<{ result: AgentResult; agentLabel: string | null }> {
  // Read intent.md
  const intentPath = join(opts.worktreePath, "spec", opts.name, "intent.md");
  const intent = readFileSync(intentPath, "utf8");

  // Read spec guidance from the main checkout
  const docsPath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "docs",
    "spec-guidance.md",
  );
  const specGuidance = readFileSync(docsPath, "utf8");

  // Snapshot all current spec files
  const currentSpec = snapshotSpecFiles(opts.worktreePath, opts.name);

  // Build the prompt
  const prompt = buildReviewPrompt({
    name: opts.name,
    intent,
    specGuidance,
    currentSpec,
  });

  // Try each agent in order until one succeeds
  const agentOrder = opts.config.modes.plan.agentOrder;
  let result: AgentResult | null = null;
  let agentLabel: string | null = null;

  for (const entry of agentOrder) {
    const agent = createAgent(entry.agent, entry.model);
    agentLabel =
      agent.attributionLabel?.() ??
      `${entry.agent} (${entry.model ?? "default"})`;

    result = await agent.run(prompt, {
      cwd: opts.worktreePath,
    });

    if (result.kind === "ok") {
      return { result, agentLabel };
    }

    if (result.kind === "quota") {
      continue;
    }

    if (result.kind === "model_config") {
      // Model config error is fatal
      return { result, agentLabel };
    }
  }

  // All agents exhausted
  if (result === null) {
    return {
      result: {
        kind: "error",
        exitCode: 2,
        stderr: "all agents exhausted (no result produced)",
      },
      agentLabel: null,
    };
  }

  // Last result (could be quota, error, or model_config)
  return { result, agentLabel };
}

/**
 * Check if the worktree has uncommitted changes using git status --porcelain.
 */
export function hasWorkingTreeChanges(worktreePath: string): boolean {
  try {
    const porcelain = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    });
    return porcelain.trim().length > 0;
  } catch (err) {
    throw new Error(`could not check git status: ${(err as Error).message}`);
  }
}

/**
 * Validate the review output: check that intent.md was not modified and index.md still exists.
 */
export function validateReviewOutput(
  worktreePath: string,
  name: string,
  intentBefore: string,
): { valid: boolean; error: string | null } {
  const specDir = join(worktreePath, "spec", name);
  const indexPath = join(specDir, "index.md");
  const intentPath = join(specDir, "intent.md");

  // Check index.md still exists
  if (!existsSync(indexPath)) {
    return { valid: false, error: "index.md was deleted" };
  }

  // Check intent.md was not modified
  const intentAfter = readFileSync(intentPath, "utf8");
  if (intentAfter !== intentBefore) {
    return {
      valid: false,
      error: "intent.md was modified (not allowed)",
    };
  }

  return { valid: true, error: null };
}
