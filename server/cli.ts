import { execFile, spawn } from "node:child_process";
import type { McpProvider, McpServer } from "../shared/mcp";

const binaries = new Map<McpProvider, Promise<string>>();

// The daemon may not inherit the login shell PATH; resolve binaries through it once.
function resolveBinary(provider: McpProvider): Promise<string> {
  let found = binaries.get(provider);
  if (!found) {
    found = new Promise((resolve) => {
      const shell = process.env.SHELL || "/bin/zsh";
      execFile(shell, ["-lc", `command -v ${provider}`], { timeout: 10_000 }, (error, stdout) => {
        const path = stdout.trim().split("\n").pop();
        resolve(!error && path ? path : provider);
      });
    });
    binaries.set(provider, found);
  }
  return found;
}

function run(provider: McpProvider, args: string[], cwd: string, timeout = 90_000): Promise<string> {
  return resolveBinary(provider).then(
    (bin) =>
      new Promise((resolve, reject) => {
        execFile(bin, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) reject(new Error((stderr || error.message).trim()));
          else resolve(stdout);
        });
      }),
  );
}

const CLAUDE_LINE = /^(.+?): (.+) - (✔|✗|!|⏸|⚠)\s*(.*)$/;

export function parseClaudeList(output: string): McpServer[] {
  const servers: McpServer[] = [];
  for (const line of output.split("\n")) {
    const match = CLAUDE_LINE.exec(line.trim());
    if (!match) continue;
    const [, name, target, symbol, detail] = match;
    const text = detail.toLowerCase();
    const state =
      symbol === "✔"
        ? "connected"
        : text.includes("auth")
          ? "needs-auth"
          : symbol === "⏸" || text.includes("pending")
            ? "pending-approval"
            : text.includes("disabled")
              ? "disabled"
              : "failed";
    servers.push({ name, target, state, detail });
  }
  return servers;
}

interface CodexEntry {
  name: string;
  enabled: boolean;
  disabled_reason: string | null;
  transport: { type: string; url?: string; command?: string; args?: string[] };
  auth_status: string;
}

export function parseCodexList(output: string): McpServer[] {
  const entries = JSON.parse(output) as CodexEntry[];
  return entries.map((entry) => {
    const target =
      entry.transport.url ?? [entry.transport.command, ...(entry.transport.args ?? [])].filter(Boolean).join(" ");
    if (!entry.enabled) {
      return { name: entry.name, target, state: "disabled", detail: entry.disabled_reason ?? "Disabled" };
    }
    if (entry.auth_status === "not_logged_in") {
      return { name: entry.name, target, state: "needs-auth", detail: "Not logged in" };
    }
    return { name: entry.name, target, state: "connected", detail: entry.auth_status.replaceAll("_", " ") };
  });
}

const HIDDEN_SERVERS = new Set([
  "claude.ai Miro",
  "claude.ai Slack",
  "claude.ai Kahoot!",
  "claude.ai Mobbin",
  "claude.ai Google Calendar",
  "claude.ai Claude Docs",
  "claude.ai Qonto",
]);

export async function listServers(provider: McpProvider, cwd: string): Promise<McpServer[]> {
  const servers =
    provider === "claude"
      ? parseClaudeList(await run("claude", ["mcp", "list"], cwd))
      : parseCodexList(await run("codex", ["mcp", "list", "--json"], cwd, 30_000));
  return servers.filter((server) => !HIDDEN_SERVERS.has(server.name));
}

// Opens the browser for OAuth; resolves when the CLI exits (success or not).
export async function login(provider: McpProvider, cwd: string, server: string): Promise<boolean> {
  const bin = await resolveBinary(provider);
  return new Promise((resolve) => {
    const child = spawn(bin, ["mcp", "login", server], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.stdout.on("data", (chunk) => console.log(`[login ${server}] ${chunk}`));
    child.stderr.on("data", (chunk) => console.error(`[login ${server}] ${chunk}`));
    child.on("error", () => resolve(false));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
