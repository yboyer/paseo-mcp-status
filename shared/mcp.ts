import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const providerSchema = z.enum(["claude", "codex"]);
export type McpProvider = z.output<typeof providerSchema>;

export const serverStateSchema = z.enum(["connected", "needs-auth", "pending-approval", "failed", "disabled"]);
export type McpServerState = z.output<typeof serverStateSchema>;

export const serverSchema = z.object({
  name: z.string(),
  target: z.string(),
  state: serverStateSchema,
  detail: z.string(),
});
export type McpServer = z.output<typeof serverSchema>;

export const statusSchema = z.object({
  servers: z.array(serverSchema),
  checkedAt: z.string().nullable(),
  checking: z.boolean(),
  error: z.string().nullable(),
});
export type McpStatus = z.output<typeof statusSchema>;

const target = z.object({ agentId: z.string(), provider: providerSchema, cwd: z.string() });

export const getStatusRpc = defineRpc({
  name: "mcp.status.get",
  input: target,
  output: statusSchema,
});

export const refreshStatusRpc = defineRpc({
  name: "mcp.status.refresh",
  input: target,
  output: statusSchema,
});

export const loginRpc = defineRpc({
  name: "mcp.login",
  input: target.extend({ server: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

export const approveRpc = defineRpc({
  name: "mcp.approve",
  input: target.extend({ server: z.string() }),
  output: statusSchema,
});

export const ALERT_KIND = "mcp-auth-alert";
export const alertSchema = z.object({
  provider: providerSchema,
  cwd: z.string(),
  server: z.string(),
  resolved: z.boolean(),
});

export function toMcpProvider(provider: string): McpProvider | null {
  const id = provider.split("/")[0]?.toLowerCase() ?? "";
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("codex")) return "codex";
  return null;
}
