// Cloud providers that speak the OpenAI chat API. Each host must also be allowed in the CSP
// (`connect-src` in src-tauri/tauri.conf.json).
export const PROVIDERS = {
  openrouter: {
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    modelExample: "anthropic/claude-sonnet-4.5",
  },
  openai: {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    modelExample: "gpt-4o-mini",
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;
