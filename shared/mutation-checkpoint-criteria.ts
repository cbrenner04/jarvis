import { basename } from "node:path";

const CHECKLIST_ITEM_PATTERN = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const LEVEL_TWO_HEADING_PATTERN = /^##\s/;

/** Assembled `## Acceptance criteria` checklist blocks (first line text only, continuations included). */
export function acceptanceCriterionBlocks(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("## Acceptance criteria");
  if (start === -1) return [];

  const blocks: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (LEVEL_TWO_HEADING_PATTERN.test(line)) break;
    const item = line.match(CHECKLIST_ITEM_PATTERN);
    if (item?.[2] === undefined) continue;

    let block = item[2].trim();
    for (i += 1; i < lines.length; i += 1) {
      const continuation = lines[i] ?? "";
      if (LEVEL_TWO_HEADING_PATTERN.test(continuation) || CHECKLIST_ITEM_PATTERN.test(continuation)) {
        i -= 1;
        break;
      }
      block += `\n${continuation.trim()}`;
    }
    blocks.push(block);
  }
  return blocks;
}

const LANGUAGE_NEUTRAL_CHECKPOINT_TEST_FILE_PATTERN =
  /^(?:.*Tests?\.(?:swift|m|kt|java)|.*_test\.(?:go|py|rb)|test_.*\.py|.*_spec\.rb|.*_test\.exs)$/;

/** Fixed basename classifier shared by checkpoint admission, review, and completion. */
export function isCheckpointTestFileReference(reference: string): boolean {
  const name = basename(reference);
  if (/\.test\.[cm]?[jt]sx?$/i.test(name) || name.includes(".test.")) return true;
  return LANGUAGE_NEUTRAL_CHECKPOINT_TEST_FILE_PATTERN.test(name);
}
