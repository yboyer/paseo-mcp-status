import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { ALERT_KIND, type McpProvider, type McpServer, type McpStatus } from "../shared/mcp";
import { listServers } from "./cli";

const STALE_MS = 60_000;

interface Entry {
  provider: McpProvider;
  cwd: string;
  servers: McpServer[];
  checkedAt: number | null;
  error: string | null;
  inflight: Promise<void> | null;
  agents: Set<string>;
  // Servers that already have a needs-auth timeline row, per agent.
  alerted: Map<string, Set<string>>;
}

const entries = new Map<string, Entry>();
const activeAgents = new Map<string, string>();
let paseo: PluginHandlerContext["paseo"] | null = null;

function keyOf(provider: McpProvider, cwd: string) {
  return `${provider}\u0000${cwd}`;
}

function entryFor(provider: McpProvider, cwd: string): Entry {
  const key = keyOf(provider, cwd);
  let entry = entries.get(key);
  if (!entry) {
    entry = { provider, cwd, servers: [], checkedAt: null, error: null, inflight: null, agents: new Set(), alerted: new Map() };
    entries.set(key, entry);
  }
  return entry;
}

function snapshot(entry: Entry): McpStatus {
  return {
    servers: entry.servers,
    checkedAt: entry.checkedAt ? new Date(entry.checkedAt).toISOString() : null,
    checking: entry.inflight !== null,
    error: entry.error,
  };
}

export function setPaseo(api: PluginHandlerContext["paseo"]) {
  paseo = api;
}

export function track(agentId: string, provider: McpProvider, cwd: string) {
  const entry = entryFor(provider, cwd);
  entry.agents.add(agentId);
  activeAgents.set(agentId, keyOf(provider, cwd));
}

export function untrack(agentId: string) {
  const key = activeAgents.get(agentId);
  activeAgents.delete(agentId);
  const entry = key ? entries.get(key) : undefined;
  entry?.agents.delete(agentId);
  entry?.alerted.delete(agentId);
}

export function refresh(provider: McpProvider, cwd: string): Promise<McpStatus> {
  const entry = entryFor(provider, cwd);
  if (!entry.inflight) {
    entry.inflight = listServers(provider, cwd)
      .then((servers) => {
        entry.servers = servers;
        entry.error = null;
      })
      .catch((error: Error) => {
        entry.error = error.message;
        console.error(`[mcp-status] ${provider} ${cwd}: ${error.message}`);
      })
      .finally(() => {
        entry.checkedAt = Date.now();
        entry.inflight = null;
      })
      .then(() => publishAlerts(entry));
  }
  return entry.inflight.then(() => snapshot(entry));
}

// Returns cached status immediately; starts a background check when stale.
export function get(provider: McpProvider, cwd: string): McpStatus {
  const entry = entryFor(provider, cwd);
  if (!entry.inflight && (!entry.checkedAt || Date.now() - entry.checkedAt > STALE_MS)) void refresh(provider, cwd);
  return snapshot(entry);
}

export function refreshActive() {
  for (const entry of entries.values()) {
    if (entry.agents.size > 0) void refresh(entry.provider, entry.cwd);
  }
}

async function publishAlerts(entry: Entry) {
  if (!paseo) return;
  const needsAuth = new Set(entry.servers.filter((server) => server.state === "needs-auth").map((server) => server.name));
  for (const agentId of entry.agents) {
    let alerted = entry.alerted.get(agentId);
    if (!alerted) entry.alerted.set(agentId, (alerted = new Set()));
    const changes: Array<[string, boolean]> = [];
    for (const name of needsAuth) if (!alerted.has(name)) changes.push([name, false]);
    for (const name of alerted) if (!needsAuth.has(name)) changes.push([name, true]);
    for (const [server, resolved] of changes) {
      if (resolved) alerted.delete(server);
      else alerted.add(server);
      try {
        await paseo.agents.ref(agentId).timeline.append({
          type: "plugin",
          // Same id per server: a later "resolved" update replaces the alert row.
          id: `auth-${entry.provider}-${server}`,
          kind: ALERT_KIND,
          version: 1,
          data: { provider: entry.provider, cwd: entry.cwd, server, resolved },
        });
      } catch (error) {
        console.error(`[mcp-status] timeline append failed for ${agentId}: ${(error as Error).message}`);
      }
    }
  }
}
