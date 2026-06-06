import { createServer } from "node:http";

type LogMessage = {
  namespace: string;
  text: string;
  tag: "harness" | "outbound" | "inbound_stdout" | "inbound_stderr";
  annotations?: Record<string, string | number | boolean | null>;
};

export type LogClient = {
  assertReachable: () => Promise<void>;
  send: (message: LogMessage) => Promise<void>;
};

export function createLogClient(url: string): LogClient {
  return {
    async assertReachable(): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          namespace: "jarvis",
          text: "healthcheck",
          tag: "harness",
        }),
      });
      if (!response.ok) {
        throw new Error(`log server returned HTTP ${response.status}`);
      }
    },
    async send(message: LogMessage): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        throw new Error(`log server returned HTTP ${response.status}`);
      }
    },
  };
}

export type LogServerOptions = {
  bind: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export function runLogServer(opts: LogServerOptions): Promise<number> {
  return new Promise((resolve) => {
    const [host, portText] = opts.bind.split(":");
    const port = Number(portText);
    if (host === undefined || !Number.isInteger(port) || port <= 0) {
      opts.stderr(`jarvis1: invalid logServerBind ${JSON.stringify(opts.bind)} (expected host:port)\n`);
      resolve(1);
      return;
    }

    const server = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/logs") {
        res.statusCode = 404;
        res.end("not found\n");
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as LogMessage | undefined;
          if (
            parsed === undefined ||
            parsed === null ||
            typeof parsed.namespace !== "string" ||
            typeof parsed.text !== "string" ||
            typeof parsed.tag !== "string"
          ) {
            res.statusCode = 400;
            res.end("invalid payload\n");
            return;
          }
          const line = `${new Date().toISOString()} [${parsed.namespace}] [${parsed.tag}] ${parsed.text}`;
          opts.stdout(line.endsWith("\n") ? line : `${line}\n`);
          res.statusCode = 202;
          res.end("ok\n");
        } catch {
          res.statusCode = 400;
          res.end("invalid json\n");
        }
      });
    });

    server.on("error", (err) => {
      opts.stderr(`jarvis1: log server failed: ${(err as Error).message}\n`);
      resolve(1);
    });

    server.listen(port, host, () => {
      opts.stdout(`jarvis1 log-server listening on http://${host}:${port}/logs\n`);
    });

    const shutdown = () => {
      server.close(() => resolve(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
