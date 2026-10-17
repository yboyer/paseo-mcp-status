import { useSettings } from "@getpaseo/plugin/client";
import { pluginSettings } from "../shared/settings";
import { getLanguage, translations } from "./i18n";

export function useTranslations() {
  const settings = useSettings(pluginSettings);
  const language = getLanguage(settings.status === "ready" ? settings.values.language : "auto");
  return { language, t: translations[language], settings };
}
