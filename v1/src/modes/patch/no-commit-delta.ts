import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripBlockerSection } from "../../../../shared/spec-parser.ts";

// Test seam for overriding the delta state directory
let testStateDir: string | null = null;

export function __testSetDeltaStateDir(dir: string): void {
  testStateDir = dir;
}

export function __testClearDeltaStateDir(): void {
  testStateDir = null;
}

// Jarvis-owned state directory for no-commit run deltas
function getDeltaStateDir(): string {
  if (testStateDir !== null) {
    return testStateDir;
  }
  return join(homedir(), ".jarvis", "no-commit-deltas");
}

// Compute a stable hash of the spec path for use as a state filename
function getSpecPathHash(specPath: string): string {
  // Use a simple hash based on the spec path
  // Format: base64(specPath) to make it filesystem-safe
  return Buffer.from(specPath).toString("base64").replace(/[/+=]/g, "_");
}

export type DeltaRecord = {
  activeSubspecPath: string;
  // Set of AC text keys that were newly ticked in this run
  newlyCheckedAcKeys: Set<string>;
  // The blocker text that was appended
  blockerText: string | null;
};

// Load prior attempt's delta, if any exists
export function loadDelta(activeSubspecPath: string): DeltaRecord | null {
  const stateDir = getDeltaStateDir();
  const deltaFile = join(stateDir, `${getSpecPathHash(activeSubspecPath)}.json`);

  if (!existsSync(deltaFile)) {
    return null;
  }

  try {
    const content = readFileSync(deltaFile, "utf8");
    const data = JSON.parse(content) as {
      activeSubspecPath: string;
      newlyCheckedAcKeys: string[];
      blockerText: string | null;
    };
    return {
      activeSubspecPath: data.activeSubspecPath,
      newlyCheckedAcKeys: new Set(data.newlyCheckedAcKeys),
      blockerText: data.blockerText,
    };
  } catch {
    // If the file is corrupted or unreadable, treat as no delta
    return null;
  }
}

// Save the current delta
export function saveDelta(delta: DeltaRecord): void {
  const stateDir = getDeltaStateDir();
  mkdirSync(stateDir, { recursive: true });

  const deltaFile = join(stateDir, `${getSpecPathHash(delta.activeSubspecPath)}.json`);
  const data = {
    activeSubspecPath: delta.activeSubspecPath,
    newlyCheckedAcKeys: Array.from(delta.newlyCheckedAcKeys),
    blockerText: delta.blockerText,
  };

  writeFileSync(deltaFile, JSON.stringify(data, null, 2), "utf8");
}

// Clear the delta after successful completion
export function clearDelta(activeSubspecPath: string): void {
  const stateDir = getDeltaStateDir();
  const deltaFile = join(stateDir, `${getSpecPathHash(activeSubspecPath)}.json`);

  if (existsSync(deltaFile)) {
    unlinkSync(deltaFile);
  }
}

// Remove only the recorded blocker text, preserving any pre-existing blocker content
function removeRecordedBlockerOnly(content: string, recordedBlockerText: string): string {
  const lines = content.split("\n");

  // Find the blocker section header
  let blockerHeaderIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "## Blocker") {
      blockerHeaderIdx = i;
      break;
    }
  }

  if (blockerHeaderIdx === -1) {
    // No blocker section found, nothing to remove
    return content;
  }

  // Find where the blocker section ends (next ## heading or EOF)
  let sectionEndIdx = lines.length;
  for (let i = blockerHeaderIdx + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.startsWith("##")) {
      sectionEndIdx = i;
      break;
    }
  }

  // Extract the blocker body (everything between header and section end)
  const blockerBodyStart = blockerHeaderIdx + 1;
  const blockerBody = lines.slice(blockerBodyStart, sectionEndIdx).join("\n").trim();

  // Check if the recorded blocker text matches the entire blocker body
  if (blockerBody === recordedBlockerText.trim()) {
    // The entire blocker section is what we recorded, remove it entirely
    return stripBlockerSection(content);
  }

  // Otherwise, try to remove only the recorded portion from the body
  // This handles cases where there was a pre-existing blocker and we appended to it
  if (blockerBody.endsWith(recordedBlockerText.trim())) {
    // The recorded text is at the end, remove it and any trailing blank lines
    const remainingBody = blockerBody.slice(0, blockerBody.length - recordedBlockerText.trim().length).trim();
    if (remainingBody.length === 0) {
      // Nothing left in the blocker, remove the entire section
      return stripBlockerSection(content);
    }
    // Reconstruct with the remaining blocker content
    const result = [
      ...lines.slice(0, blockerHeaderIdx + 1),
      remainingBody,
      ...lines.slice(sectionEndIdx),
    ];
    // Clean up trailing blank lines
    while (result.length > 0 && (result[result.length - 1] ?? "").trim() === "") {
      result.pop();
    }
    return result.join("\n");
  }

  // If recorded text doesn't match, fall back to removing the entire section
  return stripBlockerSection(content);
}

// Apply the reset: un-tick the recorded AC and strip the blocker
export function applyReset(specPath: string, delta: DeltaRecord): void {
  let content = readFileSync(specPath, "utf8");

  // Remove the recorded blocker (preserving any pre-existing blocker content)
  if (delta.blockerText !== null) {
    content = removeRecordedBlockerOnly(content, delta.blockerText);
  }

  // Un-tick recorded AC
  const lines = content.split("\n");
  const output: string[] = [];
  let inAcSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Detect acceptance criteria section
    if (line === "## Acceptance criteria") {
      inAcSection = true;
      output.push(line);
      continue;
    }

    // End acceptance criteria section when we hit another level-2 heading
    if (inAcSection && line.match(/^##\s+/)) {
      inAcSection = false;
    }

    // Un-tick AC that were newly checked in this run
    if (inAcSection && line.startsWith("- [x] ")) {
      const acText = line.slice(6).trim(); // Remove "- [x] " prefix and trim
      if (delta.newlyCheckedAcKeys.has(acText)) {
        output.push(`- [ ] ${acText}`);
        continue;
      }
    }

    output.push(line);
  }

  writeFileSync(specPath, output.join("\n"), "utf8");
}

// Update delta with newly checked AC (called as mutations occur)
export function recordNewlyCheckedAc(delta: DeltaRecord, acText: string): void {
  delta.newlyCheckedAcKeys.add(acText);
  saveDelta(delta);
}

// Update delta with newly appended blocker (called as mutations occur)
export function recordBlocker(delta: DeltaRecord, blockerText: string): void {
  delta.blockerText = blockerText;
  saveDelta(delta);
}

// Create a fresh delta for a new run
export function createFreshDelta(activeSubspecPath: string): DeltaRecord {
  return {
    activeSubspecPath,
    newlyCheckedAcKeys: new Set(),
    blockerText: null,
  };
}
