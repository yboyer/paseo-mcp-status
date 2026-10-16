import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import {
  approveRpc,
  getStatusRpc,
  loginRpc,
  refreshStatusRpc,
  toMcpProvider,
  type McpProvider,
  type McpServer,
  type McpServerState,
  type McpStatus,
} from "../shared/mcp";

export const STATE_LABELS: Record<McpServerState, string> = {
  connected: "Connecté",
  "needs-auth": "Auth requise",
  "pending-approval": "En attente d'approbation",
  failed: "Échec",
  disabled: "Désactivé",
};

export function stateColor(theme: PluginTheme, state: McpServerState) {
  if (state === "connected") return theme.colors.statusSuccess;
  if (state === "failed") return theme.colors.statusDanger;
  if (state === "disabled") return theme.colors.foregroundMuted;
  return theme.colors.statusWarning;
}

export interface Target {
  agentId: string;
  provider: McpProvider;
  cwd: string;
}

export function statusQueryKey(target: Target) {
  return ["mcp-status", target.provider, target.cwd];
}

export function useLogin(target: Target) {
  const login = useRpc(loginRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (server: string) => {
      toast.show(`Connexion à ${server} : terminez l'auth dans le navigateur`, { variant: "info", durationMs: 4000 });
      return login({ ...target, server });
    },
    onSuccess: ({ ok }, server) => {
      if (ok) toast.show(`${server} connecté`, { variant: "success" });
      else toast.error(`Échec de la connexion à ${server}`);
      void queryClient.invalidateQueries({ queryKey: statusQueryKey(target) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function StatusPopover(props: PluginButtonContentProps) {
  const { theme, layout } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const agent = useAgent(agentId, (snapshot) => ({ provider: snapshot.provider, cwd: snapshot.cwd }));
  const provider = agent ? toMcpProvider(agent.provider) : null;
  if (!agentId || !agent || !provider) return null;
  return <StatusList theme={theme} compact={layout.compact} target={{ agentId, provider, cwd: agent.cwd }} />;
}

function StatusList({ theme, compact, target }: { theme: PluginTheme; compact: boolean; target: Target }) {
  const getStatus = useRpc(getStatusRpc);
  const refreshStatus = useRpc(refreshStatusRpc);
  const approve = useRpc(approveRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = statusQueryKey(target);
  const status = useQuery({ queryKey: key, queryFn: () => getStatus(target), refetchInterval: 3000 });
  const setStatus = (next: McpStatus) => queryClient.setQueryData(key, next);
  const refresh = useMutation({ mutationFn: () => refreshStatus(target), onSuccess: setStatus });
  const approval = useMutation({
    mutationFn: (server: string) => approve({ ...target, server }),
    onSuccess: setStatus,
    onError: (error: Error) => toast.error(error.message),
  });
  const login = useLogin(target);

  const styles = useMemo(
    () => ({
      root: { gap: compact ? 8 : 10, minWidth: compact ? undefined : 360 },
      header: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
      title: { color: theme.colors.foreground, fontWeight: "600" as const },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 6,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
      },
      name: { color: theme.colors.foreground, flexShrink: 1 },
      grow: { flex: 1, gap: 2 },
      button: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, fontSize: 12 },
      ghost: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.colors.surface2 },
      ghostText: { color: theme.colors.foreground, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
    }),
    [theme, compact],
  );

  const data = status.data;
  const checking = data?.checking || refresh.isPending;

  function action(server: McpServer) {
    if (server.state === "needs-auth") {
      const busy = login.isPending && login.variables === server.name;
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Se connecter à ${server.name}`}
          disabled={login.isPending}
          style={styles.button}
          onPress={() => login.mutate(server.name)}
        >
          <Text style={styles.buttonText}>{busy ? "En cours…" : "Se connecter"}</Text>
        </Pressable>
      );
    }
    if (server.state === "pending-approval" && target.provider === "claude") {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Approuver ${server.name}`}
          disabled={approval.isPending}
          style={styles.button}
          onPress={() => approval.mutate(server.name)}
        >
          <Text style={styles.buttonText}>Approuver</Text>
        </Pressable>
      );
    }
    if (server.state === "failed") {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Réessayer ${server.name}`}
          disabled={checking}
          style={styles.ghost}
          onPress={() => refresh.mutate()}
        >
          <Text style={styles.ghostText}>Réessayer</Text>
        </Pressable>
      );
    }
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <Text style={styles.title}>Serveurs MCP · {target.provider === "claude" ? "Claude Code" : "Codex"}</Text>
          <Text style={styles.muted}>
            {checking
              ? "Vérification…"
              : data?.checkedAt
                ? `Vérifié à ${new Date(data.checkedAt).toLocaleTimeString()}`
                : "Jamais vérifié"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rafraîchir le statut MCP"
          disabled={checking}
          style={styles.ghost}
          onPress={() => refresh.mutate()}
        >
          <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
        </Pressable>
      </View>
      {data?.error ? <Text style={styles.error}>{data.error}</Text> : null}
      {data && data.servers.length === 0 && !checking ? <Text style={styles.muted}>Aucun serveur MCP configuré.</Text> : null}
      {data?.servers.map((server) => (
        <View key={server.name} style={styles.row}>
          <Icon name="Circle" size={10} color={stateColor(theme, server.state)} />
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={1}>
              {server.name}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {server.state === "connected" ? STATE_LABELS.connected : server.detail || STATE_LABELS[server.state]}
            </Text>
          </View>
          {action(server)}
        </View>
      ))}
    </View>
  );
}
