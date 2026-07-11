#!/usr/bin/env python3
import re

# Read the file
with open('v2/src/execution/workflow-runner.ts', 'r') as f:
    content = f.read()

# First change: update WORKFLOW_PRESET_LENGTHS
old_lengths = '''const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
  implement: 1,
  intent: 1,
  plan: 1,
} as const;'''

new_lengths = '''const WORKFLOW_PRESET_LENGTHS = {
  "write-write": 2,
  implement: [1, 2] as const,
  intent: 1,
  plan: 1,
} as const;'''

content = content.replace(old_lengths, new_lengths)

# Second change: update resolveWorkflowPreset function
old_function = '''export function resolveWorkflowPreset(
  name: WorkflowPresetName,
  steps: Omit<WriteWorkflowStep, "behavior">[],
): WorkflowStep[] {
  const expected = WORKFLOW_PRESET_LENGTHS[name];
  if (expected === undefined) {
    throw new Error(`Unknown workflow preset: "${name}"`);
  }

  if (steps.length !== expected) {
    throw new Error(`Workflow preset "${name}" requires ${expected} steps, received ${steps.length}`);
  }

  const pinned = WORKFLOW_PRESET_PINNED_FIELDS[name];
  return steps.map((step) => ({ ...step, behavior: "write", ...(pinned ?? {}) }) satisfies WorkflowStepInput);
}'''

new_function = '''export function resolveWorkflowPreset(
  name: WorkflowPresetName,
  steps: Omit<WriteWorkflowStep, "behavior">[],
): WorkflowStep[] {
  const expected = WORKFLOW_PRESET_LENGTHS[name];
  if (expected === undefined) {
    throw new Error(`Unknown workflow preset: "${name}"`);
  }

  const isValid = Array.isArray(expected)
    ? expected.includes(steps.length)
    : steps.length === expected;

  if (!isValid) {
    const msg = Array.isArray(expected)
      ? `Workflow preset "${name}" requires ${expected.join(" or ")} steps, received ${steps.length}`
      : `Workflow preset "${name}" requires ${expected} steps, received ${steps.length}`;
    throw new Error(msg);
  }

  const pinned = WORKFLOW_PRESET_PINNED_FIELDS[name];
  return steps.map((step) => ({ ...step, behavior: "write", ...(pinned ?? {}) }) satisfies WorkflowStepInput);
}'''

content = content.replace(old_function, new_function)

# Write the file back
with open('v2/src/execution/workflow-runner.ts', 'w') as f:
    f.write(content)

print("File updated successfully")
