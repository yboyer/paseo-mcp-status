import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { AuthAlert } from "./client/auth-alert";
import { StatusPopover } from "./client/status-popover";
import { ALERT_KIND, alertSchema, getStatusRpc, toMcpProvider, type McpStatus } from "./shared/mcp";

const POLL_MS = 5000;

interface TrackedAgent {
  id: string;
  workspaceId?: string | null;
  provider: string;
  cwd: string;
}

function pillLabel(status: McpStatus | null) {
  if (!status || (!status.checkedAt && status.checking)) return "MCP …";
  if (status.error && status.servers.length === 0) return "MCP ✗";
  const active = status.servers.filter((server) => server.state !== "disabled");
  const ok = active.filter((server) => server.state === "connected").length;
  return `MCP ${ok}/${active.length}${ok < active.length ? " ⚠" : ""}`;
}

export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, { pill: PluginButtonRegistration; timer: ReturnType<typeof setInterval> }>();
  const lifetime = new AbortController();

  const unregister = (agentId: string) => {
    const tracked = pills.get(agentId);
    if (!tracked) return;
    clearInterval(tracked.timer);
    tracked.pill.remove();
    pills.delete(agentId);
  };

  const register = (agent: TrackedAgent) => {
    const provider = toMcpProvider(agent.provider);
    if (lifetime.signal.aborted || !agent.workspaceId || !provider) return;
    unregister(agent.id);
    const pill = client.addComposerPill({
      id: "mcp-status",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "Statut des serveurs MCP",
        icon: "Plug",
        label: pillLabel(null),
        behavior: { kind: "popover", Content: StatusPopover },
      },
    });
    let label = pillLabel(null);
    const poll = () =>
      client
        .rpc(getStatusRpc, { agentId: agent.id, provider, cwd: agent.cwd })
        .then((status) => {
          const next = pillLabel(status);
          // Updating the descriptor closes an open popover; only publish real changes.
          if (next !== label) pill.update({ label: (label = next) });
        })
        .catch(() => undefined);
    void poll();
    pills.set(agent.id, { pill, timer: setInterval(poll, POLL_MS) });
  };

  const removeAll = () => {
    for (const agentId of [...pills.keys()]) unregister(agentId);
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            if (!pills.has(update.agent.id)) register(update.agent);
            return;
          }
          unregister(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("[mcp-status] agent observation failed", error);
    });

  client.addTimelineRenderer({ kind: ALERT_KIND, version: 1, schema: alertSchema, Component: AuthAlert });

  return () => {
    lifetime.abort();
    removeAll();
  };
}
