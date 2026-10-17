import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const languagePreferenceSchema = z.enum(["auto", "fr", "en"]);
export type LanguagePreference = z.output<typeof languagePreferenceSchema>;

export const pluginSettings = defineSettings({
  id: "mcp-status",
  scope: "host",
  version: 1,
  schema: z.object({ language: languagePreferenceSchema.default("auto") }),
});
