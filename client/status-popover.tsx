import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslations } from "./use-translations";
import {
  activeLoginRpc,
  approveRpc,
  getStatusRpc,
  loginRpc,
  loginStatusRpc,
  completeLoginRpc,
  refreshStatusRpc,
  toMcpProvider,
  type McpProvider,
  type McpServer,
  type McpServerState,
  type McpStatus,
} from "../shared/mcp";

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
  const { t } = useTranslations();
  const login = useRpc(loginRpc);
  const getActiveLogin = useRpc(activeLoginRpc);
  const openOnStart = useRef(false);
  const status = useRpc(loginStatusRpc);
  const complete = useRpc(completeLoginRpc);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [callback, setCallback] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();
  const activeKey = ["mcp-login-active", target.provider, target.cwd];
  const active = useQuery({
    queryKey: activeKey,
    queryFn: () => getActiveLogin(target),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const mutation = useMutation({
    mutationFn: async (server: string) => {
      const shouldOpen = openOnStart.current;
      openOnStart.current = false;
      const { sessionId } = await login({ ...target, server });
      queryClient.setQueryData(activeKey, { sessionId, server });
      setSessionId(sessionId);
      setCallback("");
      let opened = false;
      const deadline = Date.now() + 5 * 60_000 + 10_000;
      while (Date.now() < deadline) {
        const result = await status({ ...target, sessionId });
        if (result.ok !== null) return { ok: result.ok };
        if (result.url && !opened && shouldOpen) {
          await openExternalUrl(result.url);
          opened = true;
          toast.show(t.loginStarted(server), { variant: "info", durationMs: 4000 });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      return { ok: false };
    },
    onSuccess: ({ ok }, server) => {
      if (ok) toast.show(t.loginSucceeded(server), { variant: "success" });
      else toast.error(t.loginFailed(server));
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      setSessionId(null);
      void queryClient.invalidateQueries({ queryKey: activeKey });
      void queryClient.invalidateQueries({ queryKey: statusQueryKey(target) });
    },
  });
  // The popover can unmount while Android opens the browser. Recover the
  // daemon's pending session instead of requiring another sign-in attempt.
  useEffect(() => {
    if (active.isFetchedAfterMount && active.data && mutation.isIdle) {
      mutation.mutate(active.data.server);
    }
  }, [active.isFetchedAfterMount, active.data, mutation.isIdle, mutation.mutate]);
  const submit = useMutation({
    mutationFn: () => complete({ sessionId: sessionId!, url: callback }),
    onError: (error: Error) => toast.error(error.message),
  });
  return {
    ...mutation,
    isPending: mutation.isPending || active.isLoading || (mutation.isIdle && !!active.data),
    mutate: (server: string) => {
      openOnStart.current = true;
      mutation.mutate(server);
    },
    sessionId, callback, setCallback, submit,
  };
}

export function LoginCallback({ login, theme }: { login: ReturnType<typeof useLogin>; theme: PluginTheme }) {
  const { t } = useTranslations();
  if (!login.sessionId || !login.isPending) return null;
  const disabled = !login.callback.trim() || login.submit.isPending;
  const submit = () => {
    if (!disabled) login.submit.mutate();
  };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: theme.colors.foregroundMuted }}>{t.callbackHelp}</Text>
    <TextInput accessibilityLabel={t.callbackUrl} placeholder={t.callbackUrl}
      placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
      value={login.callback} onChangeText={login.setCallback}
      returnKeyType="done" onSubmitEditing={submit}
      style={{ color: theme.colors.foreground, borderColor: theme.colors.border, borderWidth: 1, padding: 8 }} />
    <Pressable accessibilityRole="button" disabled={disabled} onPress={submit}>
      <Text style={{ color: theme.colors.accent }}>{t.callbackSubmit}</Text>
    </Pressable>
  </View>;
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
  const { t, language } = useTranslations();
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
          accessibilityLabel={t.loginTo(server.name)}
          disabled={login.isPending}
          style={styles.button}
          onPress={() => login.mutate(server.name)}
        >
          <Text style={styles.buttonText}>{busy ? t.busy : t.login}</Text>
        </Pressable>
      );
    }
    if (server.state === "pending-approval" && target.provider === "claude") {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.approveServer(server.name)}
          disabled={approval.isPending}
          style={styles.button}
          onPress={() => approval.mutate(server.name)}
        >
          <Text style={styles.buttonText}>{t.approve}</Text>
        </Pressable>
      );
    }
    if (server.state === "failed") {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.retryServer(server.name)}
          disabled={checking}
          style={styles.ghost}
          onPress={() => refresh.mutate()}
        >
          <Text style={styles.ghostText}>{t.retry}</Text>
        </Pressable>
      );
    }
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <Text style={styles.title}>{t.servers} · {target.provider === "claude" ? "Claude Code" : "Codex"}</Text>
          <Text style={styles.muted}>
            {checking
              ? t.checking
              : data?.checkedAt
                ? t.checkedAt(new Date(data.checkedAt).toLocaleTimeString(language))
                : t.neverChecked}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.refresh}
          disabled={checking}
          style={styles.ghost}
          onPress={() => refresh.mutate()}
        >
          <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
        </Pressable>
      </View>
      <LoginCallback login={login} theme={theme} />
      {data?.error ? <Text style={styles.error}>{data.error}</Text> : null}
      {data && data.servers.length === 0 && !checking ? <Text style={styles.muted}>{t.empty}</Text> : null}
      {data?.servers.map((server) => (
        <View key={server.name} style={styles.row}>
          <Icon name="Circle" size={10} color={stateColor(theme, server.state)} />
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={1}>
              {server.name}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {server.state === "connected" ? t.states.connected : server.detail || t.states[server.state]}
            </Text>
          </View>
          {action(server)}
        </View>
      ))}
    </View>
  );
}
