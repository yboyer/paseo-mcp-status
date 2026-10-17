import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { LanguagePreference } from "../shared/settings";
import { useTranslations } from "./use-translations";

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const { t, settings } = useTranslations();
  const options: Array<[LanguagePreference, string]> = [["auto", t.automatic], ["fr", "Français"], ["en", "English"]];
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{t.language}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{t.languageHelp}</Text>
      {settings.status === "loading" ? <Text style={{ color: theme.colors.foregroundMuted }}>{t.checking}</Text> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={t.language} style={{ gap: 8 }}>
        {options.map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ checked: settings.status === "ready" && settings.values.language === value }}
            disabled={settings.status !== "ready" || settings.saving}
            onPress={() => {
              if (settings.status === "ready") void settings.save({ ...settings.values, language: value }, settings.revision);
            }}
            style={{ padding: 12, borderRadius: 6, backgroundColor: settings.status === "ready" && settings.values.language === value ? theme.colors.accent : theme.colors.surface2 }}
          >
            <Text style={{ color: settings.status === "ready" && settings.values.language === value ? theme.colors.accentForeground : theme.colors.foreground }}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {settings.status === "error" || settings.status === "invalid" ? (
        <>
          <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void settings.reload()}><Text style={{ color: theme.colors.foreground }}>{t.retry}</Text></Pressable>
        </>
      ) : null}
      {settings.saveError ? <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text> : null}
    </View>
  );
}
