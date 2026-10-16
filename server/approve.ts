import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Claude Code reads approved project (.mcp.json) servers from enabledMcpjsonServers.
export async function approveClaudeServer(cwd: string, server: string): Promise<void> {
  const dir = join(cwd, ".claude");
  const file = join(dir, "settings.local.json");
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const enabled = Array.isArray(settings.enabledMcpjsonServers) ? (settings.enabledMcpjsonServers as string[]) : [];
  const disabled = Array.isArray(settings.disabledMcpjsonServers) ? (settings.disabledMcpjsonServers as string[]) : [];
  if (enabled.includes(server) && !disabled.includes(server)) return;
  settings.enabledMcpjsonServers = [...new Set([...enabled, server])];
  if (disabled.includes(server)) settings.disabledMcpjsonServers = disabled.filter((name) => name !== server);
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(settings, null, 2) + "\n");
}
