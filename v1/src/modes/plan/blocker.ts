const headingPattern = /^(#{1,6})\s+(.+)$/;

/** Marker text from the removed Phase-0 review-gate blocker (historical plans only). */
const LEGACY_REVIEW_GATE_MARKER = "Review and approve";
const LEGACY_REVIEW_GATE_TAIL = "before drafting subspecs";

/**
 * True when `body` is the historical jarvis-generated intent-review gate blocker.
 * Genuine agent blockers are never treated as legacy.
 */
export function isLegacyReviewGateBlocker(body: string | undefined): boolean {
  if (body === undefined) {
    return false;
  }
  return body.includes(LEGACY_REVIEW_GATE_MARKER) && body.includes(LEGACY_REVIEW_GATE_TAIL);
}

/**
 * True when `content` has a genuine `## Blocker` (not the legacy review gate).
 */
export function hasGenuineBlocker(content: string): boolean {
  const detection = detectBlocker(content);
  return detection.hasBlocker && !isLegacyReviewGateBlocker(detection.body);
}

/**
 * Detect if a file contains a ## Blocker section (case-sensitive, level-2).
 * Returns both whether a blocker exists and its body text (if any).
 */
export function detectBlocker(content: string): {
  hasBlocker: boolean;
  body?: string | undefined;
} {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  let exactBlockerHeaderIndex: number | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (line === "## Blocker") {
      exactBlockerHeaderIndex = i;
      break;
    }
  }

  if (exactBlockerHeaderIndex === undefined) {
    return { hasBlocker: false };
  }

  // Extract the blocker body
  const bodyLines: string[] = [];
  for (let i = exactBlockerHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const headingMatch = line.match(headingPattern);
    if (headingMatch?.[1] === "##") {
      // Stop at the next level-2 heading
      break;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();
  if (body.length > 0) {
    return {
      hasBlocker: true,
      body,
    };
  }

  return {
    hasBlocker: true,
  };
}
