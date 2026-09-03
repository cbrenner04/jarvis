/**
 * Effectful resume entrypoints read deps from `wireWorkflowRunnerResumeDeps`, invoked at
 * `workflow-runner.ts` module init. Admission resolvers do not use injected deps.
 */
import { executeWorkflow } from "../execution/workflow-runner.ts";

const workflowRunnerModuleInitAnchor = executeWorkflow;

/** Value-import `workflow-runner.ts` so `wireWorkflowRunnerResumeDeps` ran before effectful resume calls. */
export function ensureWorkflowRunnerResumeDepsWired(): void {
  void workflowRunnerModuleInitAnchor;
}
