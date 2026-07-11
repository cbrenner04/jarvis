#!/usr/bin/env python3

# Read the test file
with open('v2/src/execution/workflow-runner.test.ts', 'r') as f:
    content = f.read()

# Replace the test that was checking for error on 2 steps
old_test = '''  test("throws on wrong implement preset step count", () => {
    expect(() =>
      resolveWorkflowPreset("implement", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "implement" requires 1 steps, received 2');
  });
});'''

new_tests = '''  test("resolves implement to two steps with pinned role and promptId", () => {
    const steps = resolveWorkflowPreset("implement", [
      createStep({ stepId: "step-1", role: "placeholder", promptId: "placeholder.prompt" }),
      createStep({ stepId: "step-2", role: "placeholder", promptId: "placeholder.prompt" }),
    ]);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.behavior).toBe("write");
    expect((steps[0] as WriteWorkflowStep).role).toBe("implement");
    expect((steps[0] as WriteWorkflowStep).promptId).toBe("patch.prompt.body");
    expect(steps[1]?.behavior).toBe("write");
    expect((steps[1] as WriteWorkflowStep).role).toBe("implement");
    expect((steps[1] as WriteWorkflowStep).promptId).toBe("patch.prompt.body");
  });

  test("throws on zero implement preset steps", () => {
    expect(() => resolveWorkflowPreset("implement", [])).toThrow(
      'Workflow preset "implement" requires 1 or 2 steps, received 0',
    );
  });

  test("throws on three implement preset steps", () => {
    expect(() =>
      resolveWorkflowPreset("implement", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
        createStep({ stepId: "step-3", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "implement" requires 1 or 2 steps, received 3');
  });

  test("retains exact cardinality for write-write preset", () => {
    expect(() => resolveWorkflowPreset("write-write", [createStep({ stepId: "step-1", role: "implement" })])).toThrow(
      'Workflow preset "write-write" requires 2 steps, received 1',
    );
    
    expect(() =>
      resolveWorkflowPreset("write-write", [
        createStep({ stepId: "step-1", role: "implement" }),
        createStep({ stepId: "step-2", role: "implement" }),
        createStep({ stepId: "step-3", role: "implement" }),
      ]),
    ).toThrow('Workflow preset "write-write" requires 2 steps, received 3');
  });

  test("retains exact cardinality for intent preset", () => {
    expect(() => resolveWorkflowPreset("intent", [])).toThrow(
      'Workflow preset "intent" requires 1 steps, received 0',
    );

    expect(() =>
      resolveWorkflowPreset("intent", [
        createStep({ stepId: "step-1", role: "plan" }),
        createStep({ stepId: "step-2", role: "plan" }),
      ]),
    ).toThrow('Workflow preset "intent" requires 1 steps, received 2');
  });

  test("retains exact cardinality for plan preset", () => {
    expect(() => resolveWorkflowPreset("plan", [])).toThrow(
      'Workflow preset "plan" requires 1 steps, received 0',
    );

    expect(() =>
      resolveWorkflowPreset("plan", [
        createStep({ stepId: "step-1", role: "plan" }),
        createStep({ stepId: "step-2", role: "plan" }),
      ]),
    ).toThrow('Workflow preset "plan" requires 1 steps, received 2');
  });
});'''

content = content.replace(old_test, new_tests)

# Write the file back
with open('v2/src/execution/workflow-runner.test.ts', 'w') as f:
    f.write(content)

print("Test file updated successfully")
