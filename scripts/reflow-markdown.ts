/// <reference path="./markdown-it.d.ts" />
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import markdownlintConfig from "../.markdownlint-cli2.jsonc";
import { collectSoftBreakLineNumbers } from "./markdownlint-no-hard-wrap-rule.ts";

export type MarkdownReflowScope = {
  globs: string[];
  ignores: string[];
};

export function readMarkdownReflowScope(): MarkdownReflowScope {
  return {
    globs: [...markdownlintConfig.globs],
    ignores: [...markdownlintConfig.ignores],
  };
}

function matchesIgnore(path: string, ignores: string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  for (const pattern of ignores) {
    const glob = new Bun.Glob(pattern);
    if (glob.match(normalized)) {
      return true;
    }
  }
  return false;
}

export async function collectMarkdownReflowPaths(scope: MarkdownReflowScope, rootDir: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const pattern of scope.globs) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: rootDir, onlyFiles: true })) {
      const normalized = path.replaceAll("\\", "/");
      if (!matchesIgnore(normalized, scope.ignores)) {
        paths.add(join(rootDir, path));
      }
    }
  }
  return [...paths].sort();
}

function annotateLineNumbers(tokens: ReturnType<MarkdownIt["parse"]>): void {
  for (const token of tokens) {
    if (token.map) {
      token.lineNumber = token.map[0] + 1;
    }
    if (token.children) {
      let lineNumber = token.lineNumber ?? 1;
      for (const child of token.children) {
        child.lineNumber = lineNumber;
        if (child.type === "softbreak" || child.type === "hardbreak") {
          lineNumber++;
        }
      }
    }
  }
}

function splitMarkdownLines(content: string): { lines: string[]; endsWithNewline: boolean } {
  const endsWithNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (endsWithNewline && lines.at(-1) === "") {
    lines.pop();
  }
  return { lines, endsWithNewline };
}

function joinMarkdownLines(lines: string[], endsWithNewline: boolean): string {
  const body = lines.join("\n");
  return endsWithNewline ? `${body}\n` : body;
}

function reflowMarkdownContentOnce(content: string): string {
  const { lines, endsWithNewline } = splitMarkdownLines(content);
  const md = new MarkdownIt({ html: true });
  const tokens = md.parse(content, {});
  annotateLineNumbers(tokens);
  const violationLines = [
    ...new Set(
      collectSoftBreakLineNumbers(lines, tokens as unknown as Parameters<typeof collectSoftBreakLineNumbers>[1]),
    ),
  ].sort((a, b) => b - a);
  if (violationLines.length === 0) {
    return content;
  }
  const mutableLines = [...lines];
  for (const lineNumber of violationLines) {
    const index = lineNumber - 1;
    const current = mutableLines[index];
    const next = mutableLines[index + 1];
    if (current === undefined || next === undefined) {
      continue;
    }
    const joined = `${current.trimEnd()} ${next.trimStart()}`;
    mutableLines.splice(index, 2, joined);
  }
  return joinMarkdownLines(mutableLines, endsWithNewline);
}

export function reflowMarkdownContent(content: string): string {
  let current = content;
  while (true) {
    const next = reflowMarkdownContentOnce(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
}

export function reflowMarkdownFile(path: string): boolean {
  const original = readFileSync(path, "utf8");
  const reflowed = reflowMarkdownContent(original);
  if (reflowed !== original) {
    writeFileSync(path, reflowed, "utf8");
    return true;
  }
  return false;
}

export async function reflowMarkdownCorpus(rootDir: string): Promise<number> {
  const scope = readMarkdownReflowScope();
  const paths = await collectMarkdownReflowPaths(scope, rootDir);
  let changed = 0;
  for (const path of paths) {
    if (reflowMarkdownFile(path)) {
      changed++;
    }
  }
  return changed;
}

if (import.meta.main) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const changed = await reflowMarkdownCorpus(rootDir);
  process.stderr.write(`reflow:md updated ${changed} file(s)\n`);
}
