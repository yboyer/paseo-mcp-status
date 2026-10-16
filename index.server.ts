import type { PluginHookAgent, PluginServerContext } from "@getpaseo/plugin/server";
import { approveRpc, getStatusRpc, loginRpc, refreshStatusRpc, toMcpProvider } from "./shared/mcp";
import { approveClaudeServer } from "./server/approve";
import { login } from "./server/cli";
import * as store from "./server/store";

const POLL_MS = 60_000;

export default function contribute(server: PluginServerContext) {
  const onActivity = (agent: PluginHookAgent) => {
    const provider = toMcpProvider(agent.provider);
    if (!provider) return;
    store.track(agent.id, provider, agent.cwd);
    void store.refresh(provider, agent.cwd);
  };

  server.on("agent.created", ({ agent }, { paseo }) => {
    store.setPaseo(paseo);
    onActivity(agent);
  });
  server.on("agent.turn_started", ({ agent }, { paseo }) => {
    store.setPaseo(paseo);
    onActivity(agent);
  });
  server.on("agent.turn_ended", ({ agent }) => onActivity(agent));
  server.on("agent.closed", ({ agent }) => store.untrack(agent.id));
  server.on("agent.archived", ({ agent }) => store.untrack(agent.id));

  server.handle(getStatusRpc, ({ agentId, provider, cwd }, { paseo }) => {
    store.setPaseo(paseo);
    store.track(agentId, provider, cwd);
    return store.get(provider, cwd);
  });

  server.handle(refreshStatusRpc, ({ agentId, provider, cwd }) => {
    store.track(agentId, provider, cwd);
    return store.refresh(provider, cwd);
  });

  server.handle(loginRpc, async ({ provider, cwd, server: name }) => {
    const ok = await login(provider, cwd, name);
    await store.refresh(provider, cwd);
    return { ok };
  });

  server.handle(approveRpc, async ({ provider, cwd, server: name }) => {
    if (provider !== "claude") throw new Error("Only Claude Code project servers need approval");
    await approveClaudeServer(cwd, name);
    return store.refresh(provider, cwd);
  });

  const timer = setInterval(store.refreshActive, POLL_MS);
  return () => clearInterval(timer);
}
