import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parseSpec } from "../../../../shared/spec-parser.ts";

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

// Apply the reset: un-tick the recorded AC and strip the blocker
export function applyReset(specPath: string, delta: DeltaRecord): void {
  const content = readFileSync(specPath, "utf8");
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

    // End acceptance criteria section when we hit another heading
    if (inAcSection && line.startsWith("##")) {
      inAcSection = false;
    }

    // Skip blocker section if it matches the recorded blocker
    if (line === "## Blocker" && delta.blockerText !== null) {
      // Skip the heading line
      // Skip the next blank line if it exists
      if (i + 1 < lines.length && (lines[i + 1] ?? "") === "") {
        i++;
      }
      // Skip blocker content lines
      i++;
      while (i < lines.length) {
        const currentLine = lines[i] ?? "";
        if (!currentLine || currentLine === "" || currentLine.startsWith("##")) {
          break;
        }
        if (currentLine.trim() === delta.blockerText || currentLine.includes(delta.blockerText)) {
          // This is part of the blocker content
          i++;
        } else {
          break;
        }
      }
      // Back up one line since the loop will increment at the end
      i--;
      continue;
    }

    // Un-tick AC that were newly checked in this run
    if (inAcSection && line.startsWith("- [x] ")) {
      const acText = line.slice(6); // Remove "- [x] " prefix
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
