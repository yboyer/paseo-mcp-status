import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { alertSchema } from "../shared/mcp";
import { useLogin } from "./status-popover";

export function AuthAlert({ agentId, item, theme, layout }: PluginTimelineItemProps<z.output<typeof alertSchema>>) {
  const { provider, cwd, server, resolved } = item.data;
  const login = useLogin({ agentId, provider, cwd });
  const styles = useMemo(
    () => ({
      card: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        padding: layout.compact ? 10 : 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: resolved ? theme.colors.border : theme.colors.statusWarning,
        backgroundColor: theme.colors.surface1,
      },
      text: { flex: 1, color: theme.colors.foreground },
      button: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, fontSize: 12 },
    }),
    [theme, layout.compact, resolved],
  );
  return (
    <View style={styles.card}>
      <Icon
        name={resolved ? "CircleCheck" : "KeyRound"}
        size={16}
        color={resolved ? theme.colors.statusSuccess : theme.colors.statusWarning}
      />
      <Text style={styles.text}>
        {resolved ? `MCP ${server} : authentifié.` : `MCP ${server} : authentification requise.`}
      </Text>
      {resolved ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Se connecter à ${server}`}
          disabled={login.isPending}
          style={styles.button}
          onPress={() => login.mutate(server)}
        >
          <Text style={styles.buttonText}>{login.isPending ? "En cours…" : "Se connecter"}</Text>
        </Pressable>
      )}
    </View>
  );
}
