import type { LanguagePreference } from "../shared/settings";
import type { McpServerState } from "../shared/mcp";

export type Language = "en" | "fr";

export function resolveLanguage(locale?: string): Language {
  return locale?.toLowerCase().split(/[-_]/)[0] === "fr" ? "fr" : "en";
}

export function getLanguage(preference: LanguagePreference = "auto"): Language {
  if (preference !== "auto") return preference;
  try {
    const navigator = (globalThis as { navigator?: { language?: string } }).navigator;
    return resolveLanguage(navigator?.language || Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "en";
  }
}

interface Messages {
  language: string;
  automatic: string;
  languageHelp: string;
  title: string;
  servers: string;
  states: Record<McpServerState, string>;
  callbackHelp: string;
  callbackUrl: string;
  callbackSubmit: string;
  login: string;
  busy: string;
  approve: string;
  retry: string;
  checking: string;
  neverChecked: string;
  refresh: string;
  empty: string;
  loginTo: (server: string) => string;
  approveServer: (server: string) => string;
  retryServer: (server: string) => string;
  loginStarted: (server: string) => string;
  loginSucceeded: (server: string) => string;
  loginFailed: (server: string) => string;
  checkedAt: (time: string) => string;
  authAlert: (server: string, resolved: boolean) => string;
}

export const translations: Record<Language, Messages> = {
  en: {
    language: "Language",
    automatic: "Automatic",
    languageHelp: "Automatic follows this device or browser. This preference applies to all clients connected to this host.",
    title: "MCP server status",
    servers: "MCP servers",
    states: { connected: "Connected", "needs-auth": "Authentication required", "pending-approval": "Pending approval", failed: "Failed", disabled: "Disabled" },
    callbackHelp: "If the browser ends on an unreachable localhost page, copy its full URL and paste it here to finish signing in.",
    callbackUrl: "Callback URL",
    callbackSubmit: "Complete sign-in",
    login: "Sign in",
    busy: "In progress…",
    approve: "Approve",
    retry: "Retry",
    checking: "Checking…",
    neverChecked: "Never checked",
    refresh: "Refresh MCP status",
    empty: "No MCP servers configured.",
    loginTo: (server) => `Sign in to ${server}`,
    approveServer: (server) => `Approve ${server}`,
    retryServer: (server) => `Retry ${server}`,
    loginStarted: (server) => `Signing in to ${server}: complete authentication in the browser`,
    loginSucceeded: (server) => `${server} connected`,
    loginFailed: (server) => `Failed to sign in to ${server}`,
    checkedAt: (time) => `Checked at ${time}`,
    authAlert: (server, resolved) => resolved ? `MCP ${server}: authenticated.` : `MCP ${server}: authentication required.`,
  },
  fr: {
    language: "Langue",
    automatic: "Automatique",
    languageHelp: "Automatique suit la langue de cet appareil ou navigateur. Ce réglage s’applique à tous les clients connectés à cet hôte.",
    title: "Statut des serveurs MCP",
    servers: "Serveurs MCP",
    states: { connected: "Connecté", "needs-auth": "Auth requise", "pending-approval": "En attente d'approbation", failed: "Échec", disabled: "Désactivé" },
    callbackHelp: "Si le navigateur arrive sur une page localhost inaccessible, copiez son URL complète et collez-la ici pour terminer la connexion.",
    callbackUrl: "URL de retour",
    callbackSubmit: "Terminer la connexion",
    login: "Se connecter",
    busy: "En cours…",
    approve: "Approuver",
    retry: "Réessayer",
    checking: "Vérification…",
    neverChecked: "Jamais vérifié",
    refresh: "Rafraîchir le statut MCP",
    empty: "Aucun serveur MCP configuré.",
    loginTo: (server) => `Se connecter à ${server}`,
    approveServer: (server) => `Approuver ${server}`,
    retryServer: (server) => `Réessayer ${server}`,
    loginStarted: (server) => `Connexion à ${server} : terminez l'auth dans le navigateur`,
    loginSucceeded: (server) => `${server} connecté`,
    loginFailed: (server) => `Échec de la connexion à ${server}`,
    checkedAt: (time) => `Vérifié à ${time}`,
    authAlert: (server, resolved) => resolved ? `MCP ${server} : authentifié.` : `MCP ${server} : authentification requise.`,
  },
};

export function getMessages(preference: LanguagePreference = "auto") {
  return translations[getLanguage(preference)];
}
