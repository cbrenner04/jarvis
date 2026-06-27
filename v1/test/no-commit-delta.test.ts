import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __testClearDeltaStateDir,
  __testSetDeltaStateDir,
  applyReset,
  clearDelta,
  createFreshDelta,
  loadDelta,
  recordBlocker,
  recordNewlyCheckedAc,
} from "../src/modes/patch/no-commit-delta.ts";

describe("no-commit-delta", () => {
  let tempDir: string;
  let specPath: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    stateDir = join(tempDir, "state");
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    specPath = join(tempDir, "spec.md");
    __testSetDeltaStateDir(stateDir);
  });

  afterEach(() => {
    __testClearDeltaStateDir();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("creates a fresh delta", () => {
    const delta = createFreshDelta(specPath);
    expect(delta.activeSubspecPath).toBe(specPath);
    expect(delta.newlyCheckedAcKeys.size).toBe(0);
    expect(delta.blockerText).toBeNull();
  });

  it("persists and loads delta", () => {
    const delta = createFreshDelta(specPath);
    recordNewlyCheckedAc(delta, "First criterion");
    recordNewlyCheckedAc(delta, "Second criterion");
    recordBlocker(delta, "This is a blocker");

    const loaded = loadDelta(specPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.newlyCheckedAcKeys.has("First criterion")).toBe(true);
    expect(loaded?.newlyCheckedAcKeys.has("Second criterion")).toBe(true);
    expect(loaded?.blockerText).toBe("This is a blocker");
  });

  it("returns null when no delta exists", () => {
    const loaded = loadDelta(specPath);
    expect(loaded).toBeNull();
  });

  it("clears delta after completion", () => {
    const delta = createFreshDelta(specPath);
    recordNewlyCheckedAc(delta, "First criterion");
    expect(loadDelta(specPath)).not.toBeNull();

    clearDelta(specPath);
    expect(loadDelta(specPath)).toBeNull();
  });

  it("resets un-ticked AC from delta", () => {
    const specContent = `# Spec

## Acceptance criteria

- [x] First criterion
- [x] Second criterion
- [ ] Third criterion
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.newlyCheckedAcKeys.add("First criterion");
    delta.newlyCheckedAcKeys.add("Second criterion");

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).toContain("- [ ] First criterion");
    expect(resetContent).toContain("- [ ] Second criterion");
    expect(resetContent).toContain("- [ ] Third criterion");
  });

  it("preserves pre-attempt ticked AC when resetting", () => {
    const specContent = `# Spec

## Acceptance criteria

- [x] Pre-ticked criterion
- [x] This run ticked
- [ ] Unticked criterion
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.newlyCheckedAcKeys.add("This run ticked");

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).toContain("- [x] Pre-ticked criterion");
    expect(resetContent).toContain("- [ ] This run ticked");
    expect(resetContent).toContain("- [ ] Unticked criterion");
  });

  it("strips blocker from spec on reset", () => {
    const specContent = `# Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

This is the blocker text
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.blockerText = "This is the blocker text";

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).not.toContain("## Blocker");
    expect(resetContent).not.toContain("This is the blocker text");
    expect(resetContent).toContain("## Acceptance criteria");
  });

  it("handles AC with special regex characters", () => {
    const specContent = `# Spec

## Acceptance criteria

- [x] Criterion with [brackets] and (parens)
- [ ] Another one
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.newlyCheckedAcKeys.add("Criterion with [brackets] and (parens)");

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).toContain("- [ ] Criterion with [brackets] and (parens)");
  });

  it("only resets newly-checked AC, not pre-ticked ones", () => {
    const specContent = `# Spec

## Acceptance criteria

- [x] Was already checked
- [x] Newly checked this run
- [x] Also newly checked
- [ ] Not checked
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.newlyCheckedAcKeys.add("Newly checked this run");
    delta.newlyCheckedAcKeys.add("Also newly checked");

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).toContain("- [x] Was already checked");
    expect(resetContent).toContain("- [ ] Newly checked this run");
    expect(resetContent).toContain("- [ ] Also newly checked");
    expect(resetContent).toContain("- [ ] Not checked");
  });

  it("strips multi-line blocker from spec on reset", () => {
    const specContent = `# Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

This is a multi-line blocker.
It has more than one line.
And even a third line.
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.blockerText = `This is a multi-line blocker.
It has more than one line.
And even a third line.`;

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).not.toContain("## Blocker");
    expect(resetContent).not.toContain("This is a multi-line blocker");
    expect(resetContent).not.toContain("It has more than one line");
    expect(resetContent).not.toContain("And even a third line");
    expect(resetContent).toContain("## Acceptance criteria");
  });

  it("resets delta for external spec paths", () => {
    const externalSpecDir = join(tempDir, "external-spec");
    mkdirSync(externalSpecDir, { recursive: true });
    const externalSpecPath = join(externalSpecDir, "spec.md");

    const specContent = `# External Spec

## Acceptance criteria

- [x] AC ticked in prior run
- [ ] Still unticked
`;
    writeFileSync(externalSpecPath, specContent, "utf8");

    // Simulate a prior run that ticked an AC and appended a blocker
    const delta = createFreshDelta(externalSpecPath);
    recordNewlyCheckedAc(delta, "AC ticked in prior run");
    recordBlocker(delta, "Error encountered");

    // Verify delta was recorded
    expect(loadDelta(externalSpecPath)).not.toBeNull();

    // Apply reset as would happen on re-run
    const priorDelta = loadDelta(externalSpecPath);
    if (priorDelta !== null) {
      applyReset(externalSpecPath, priorDelta);
    }

    const resetContent = readFileSync(externalSpecPath, "utf8");
    expect(resetContent).toContain("- [ ] AC ticked in prior run");
    expect(resetContent).not.toContain("## Blocker");
    expect(resetContent).not.toContain("Error encountered");
    expect(resetContent).toContain("- [ ] Still unticked");
  });

  it("resets delta for external spec when gitEnabled:true (Finding 3: end-to-end external spec reset)", () => {
    // This test exercises the external spec reset path with gitEnabled:true
    // Scenario: An external spec (outside agent working tree) is run with git:true
    // The hasUntrackedMutations condition should be true (!gitEnabled || specIsExternal)
    // causing delta to be created, recorded, and then cleared on completion

    const externalSpecDir = join(tempDir, "external-specs", "test-project");
    mkdirSync(externalSpecDir, { recursive: true });
    const externalSpecPath = join(externalSpecDir, "subspec.md");

    const specContent = `# Subspec

## Acceptance criteria

- [ ] First criterion
`;
    writeFileSync(externalSpecPath, specContent, "utf8");

    // Simulate a prior run that ticked an AC and appended a blocker
    // with gitEnabled:true (the default)
    const delta = createFreshDelta(externalSpecPath);
    recordNewlyCheckedAc(delta, "First criterion");
    recordBlocker(delta, "Something blocked the run");

    // Verify delta was persisted (would be cleared on next invocation)
    const priorDelta = loadDelta(externalSpecPath);
    expect(priorDelta).not.toBeNull();
    expect(priorDelta?.newlyCheckedAcKeys.has("First criterion")).toBe(true);

    // Simulate re-run: preflight resets deltas for external specs, then
    // iteration.ts clears them on completion (now that hasUntrackedMutations
    // is true for external specs even when gitEnabled:true)
    if (priorDelta !== null) {
      applyReset(externalSpecPath, priorDelta);
      clearDelta(externalSpecPath);
    }

    // Verify reset happened
    const resetContent = readFileSync(externalSpecPath, "utf8");
    expect(resetContent).toContain("- [ ] First criterion");
    expect(resetContent).not.toContain("## Blocker");
    expect(resetContent).not.toContain("Something blocked the run");

    // Verify delta was cleared
    expect(loadDelta(externalSpecPath)).toBeNull();
  });

  it("preserves pre-existing blocker when resetting newly appended one", () => {
    const specContent = `# Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Pre-existing blocker from earlier
New blocker appended by this run
`;
    writeFileSync(specPath, specContent, "utf8");

    // Simulate a run that appended a new blocker to the pre-existing one
    const delta = createFreshDelta(specPath);
    delta.blockerText = "New blocker appended by this run";

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    // Should still have the blocker section but only with pre-existing content
    expect(resetContent).toContain("## Blocker");
    expect(resetContent).toContain("Pre-existing blocker from earlier");
    expect(resetContent).not.toContain("New blocker appended by this run");
  });

  it("removes entire blocker section when no pre-existing blocker exists", () => {
    const specContent = `# Spec

## Acceptance criteria

- [ ] First criterion

## Blocker

Only blocker from this run
`;
    writeFileSync(specPath, specContent, "utf8");

    const delta = createFreshDelta(specPath);
    delta.blockerText = "Only blocker from this run";

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    expect(resetContent).not.toContain("## Blocker");
    expect(resetContent).not.toContain("Only blocker from this run");
    expect(resetContent).toContain("## Acceptance criteria");
  });

  it("handles pre-existing blocker with no new blocker appended", () => {
    const specContent = `# Spec

## Acceptance criteria

- [x] Criterion ticked

## Blocker

Pre-existing blocker
`;
    writeFileSync(specPath, specContent, "utf8");

    // No blocker was appended in this run
    const delta = createFreshDelta(specPath);
    delta.newlyCheckedAcKeys.add("Criterion ticked");
    delta.blockerText = null;

    applyReset(specPath, delta);

    const resetContent = readFileSync(specPath, "utf8");
    // AC should be un-ticked, blocker should remain
    expect(resetContent).toContain("- [ ] Criterion ticked");
    expect(resetContent).toContain("## Blocker");
    expect(resetContent).toContain("Pre-existing blocker");
  });
});
