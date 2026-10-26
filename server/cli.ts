import { randomUUID } from "node:crypto";
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

export async function listServers(provider: McpProvider, cwd: string): Promise<McpServer[]> {
  return provider === "claude"
    ? parseClaudeList(await run("claude", ["mcp", "list"], cwd))
    : parseCodexList(await run("codex", ["mcp", "list", "--json"], cwd, 30_000));
}

// Each session is addressed by an unguessable token, including callback submission.
interface LoginSession {
  provider: McpProvider;
  cwd: string;
  server: string;
  url: string | null;
  ok: boolean | null;
  callback: URL | null;
  state: string | null;
}
const sessions = new Map<string, LoginSession>();

export async function login(provider: McpProvider, cwd: string, server: string): Promise<string> {
  const bin = await resolveBinary(provider);
  // Re-check after resolving the binary so simultaneous calls reuse one CLI.
  const pending = activeLogin(provider, cwd);
  if (pending) {
    if (pending.server !== server) throw new Error("Another MCP sign-in is already in progress");
    return pending.sessionId;
  }
  const id = randomUUID();
  const child = spawn(bin, ["mcp", "login", server], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const session: LoginSession = { provider, cwd, server, url: null, ok: null, callback: null, state: null };
  sessions.set(id, session);
  const timer = setTimeout(() => { child.kill(); finish(false); }, 5 * 60_000);
  function finish(ok: boolean) {
    if (session.ok !== null) return;
    session.ok = ok;
    clearTimeout(timer);
    setTimeout(() => sessions.delete(id), 60_000).unref();
  }
  // Keep stdout and stderr separate: either may carry the authorization URL.
  function capture() {
    let output = "";
    return (chunk: Buffer) => {
      if (session.url) return;
      output = (output + chunk.toString()).slice(-64 * 1024);
      const lines = output.split(/\r?\n/);
      output = lines.pop() ?? "";
      for (const line of lines) {
        for (const match of line.matchAll(/https?:\/\/[^\s\u001b]+/g)) {
          try {
            const url = new URL(match[0]);
            const redirect = url.searchParams.get("redirect_uri");
            if (!redirect) continue;
            session.callback = new URL(redirect);
            session.state = url.searchParams.get("state");
            session.url = url.href;
            return;
          } catch { /* Ignore non-URL CLI output. */ }
        }
      }
    };
  }
  child.stdout!.on("data", capture());
  child.stderr!.on("data", capture());
  child.on("error", () => finish(false));
  child.on("close", (code) => finish(code === 0));
  return id;
}

export function activeLogin(provider: McpProvider, cwd: string) {
  for (const [sessionId, session] of sessions) {
    if (session.provider === provider && session.cwd === cwd && session.ok === null) {
      return { sessionId, server: session.server };
    }
  }
  return null;
}

export function loginStatus(id: string) {
  const session = sessions.get(id);
  if (!session) throw new Error("Authentication session expired");
  return { url: session.url, ok: session.ok };
}

export async function completeLogin(id: string, value: string): Promise<void> {
  const session = sessions.get(id);
  if (!session || session.ok !== null || !session.callback || !session.state) {
    throw new Error("No pending authentication callback");
  }
  const url = new URL(value.trim());
  const expected = session.callback;
  // Never let a client turn this endpoint into an arbitrary HTTP proxy.
  if (expected.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)
      || url.origin !== expected.origin || url.pathname !== expected.pathname
      || url.hash || url.username || url.password
      || url.searchParams.get("state") !== session.state) {
    throw new Error("Invalid authentication callback URL");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Authentication callback failed");
  } finally {
    clearTimeout(timer);
  }
}
