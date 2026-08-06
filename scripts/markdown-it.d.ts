declare module "markdown-it" {
  type MarkdownItToken = {
    type: string;
    map?: [number, number] | null;
    children?: MarkdownItToken[];
    lineNumber?: number;
  };

  export default class MarkdownIt {
    constructor(options?: { html?: boolean });
    parse(content: string, env: unknown): MarkdownItToken[];
  }
}
