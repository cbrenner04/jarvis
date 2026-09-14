import { join, resolve, sep } from "node:path";
import { findProjectMatch, type ProjectMatch, type ProjectRegistryEntry } from "../../../shared/project-registry.ts";
import { projectSafeId } from "../../../shared/project-safe-id.ts";
import { readMachineConfigDocument } from "../config/machine-config-loader.ts";
import { type ResolveSpecsHomeResult, resolveSpecsHome } from "../config/specs-home.ts";
import type { BuildImplementWorkflowStepsDeps } from "../execution/implement-workflow-steps.ts";
import type { PlanWorkflowDeps } from "../execution/publication-workflow-steps.ts";
import { loadWorkflowSteps as realLoadWorkflowSteps } from "../execution/workflow-loader.ts";
import { jarvisHome, worktreesRoot } from "../paths.ts";
import type { PipelineContext } from "../persistence/state-store.ts";

function isUnderPath(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  const prefix = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;
  return resolvedChild === resolvedParent || resolvedChild.startsWith(prefix);
}

function projectRegistryFromContext(context: PipelineContext): Record<string, ProjectRegistryEntry> {
  if (context.projectRegistry !== undefined) return context.projectRegistry;
  const projects = readMachineConfigDocument(context.configPath)?.projects;
  return projects && typeof projects === "object" && !Array.isArray(projects)
    ? (projects as Record<string, ProjectRegistryEntry>)
    : {};
}

function machineModePlan(configPath: string | undefined): Record<string, unknown> {
  const document = readMachineConfigDocument(configPath) ?? {};
  const modes = document.modes && typeof document.modes === "object" ? (document.modes as Record<string, unknown>) : {};
  return modes.plan && typeof modes.plan === "object" ? (modes.plan as Record<string, unknown>) : {};
}

function projectConfigRecord(context: PipelineContext, project: ProjectMatch): Record<string, unknown> {
  const raw = projectRegistryFromContext(context)[project.key];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Chained-stage spec home through the shared `specs` resolver (same as intent/plan publication). */
export function chainedStageSpecsHome(context: PipelineContext, project: ProjectMatch): ResolveSpecsHomeResult {
  return resolveSpecsHome(projectConfigRecord(context, project), machineModePlan(context.configPath));
}

export function resolveChainedStageOwnerProject(context: PipelineContext): ProjectMatch | undefined {
  return findProjectMatch(context.cwd, projectRegistryFromContext(context));
}

/** Pipeline chained stages match cwd under the admission root or jarvis managed workspaces. */
export function createChainedStageProjectMatch(context: PipelineContext): (path: string) => ProjectMatch | undefined {
  const registry = projectRegistryFromContext(context);
  const admissionRoot = context.cwd;
  return (path: string) => {
    const direct = findProjectMatch(path, registry);
    if (direct !== undefined && isUnderPath(path, admissionRoot)) return direct;
    const resolved = resolve(path);
    const jarvisRoot = jarvisHome();
    for (const key of Object.keys(registry)) {
      const safeId = projectSafeId(key);
      if (
        isUnderPath(resolved, join(worktreesRoot(jarvisRoot), key)) ||
        isUnderPath(resolved, join(jarvisRoot, "intent-work", safeId)) ||
        isUnderPath(resolved, join(jarvisRoot, "specs", safeId))
      ) {
        return { key, root: admissionRoot };
      }
    }
    return direct;
  };
}

export function chainedPlanWorkflowDeps(context: PipelineContext): PlanWorkflowDeps {
  return { resolveProjectMatch: createChainedStageProjectMatch(context) };
}

export function chainedImplementWorkflowDeps(context: PipelineContext): BuildImplementWorkflowStepsDeps {
  const configPath = context.configPath;
  return {
    ...chainedPlanWorkflowDeps(context),
    ...(configPath !== undefined
      ? {
          configPath,
          loadWorkflowSteps: (steps) => realLoadWorkflowSteps(steps, { machineConfigPath: configPath }),
        }
      : {}),
  };
}
