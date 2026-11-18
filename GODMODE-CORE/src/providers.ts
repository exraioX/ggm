import OpenAI from 'openai';
import { PROVIDER_CONFIG_PATH, readJson, safeWriteJson } from './config.js';
import { isAllowedEndpoint } from './security.js';

export interface ProviderDefinition {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'openrouter';
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  enabled?: boolean;
}

const DEFAULT_PROVIDERS: ProviderDefinition[] = [
  { id: 'ollama', name: 'Ollama (local)', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: '', enabled: true },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKeyEnv: 'OPENROUTER_API_KEY', enabled: true },
];

export class ProviderRegistry {
  private providers: ProviderDefinition[];
  private readonly secrets = new Map<string, string>();

  constructor() {
    this.providers = readJson<ProviderDefinition[]>(PROVIDER_CONFIG_PATH, DEFAULT_PROVIDERS);
    if (!Array.isArray(this.providers) || !this.providers.length) this.providers = DEFAULT_PROVIDERS;
    for (const provider of this.providers) {
      const envKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
      if (envKey) this.secrets.set(provider.id, envKey);
    }
  }

  list() {
    return this.providers.map(provider => ({
      ...provider,
      hasSecret: Boolean(this.getSecret(provider.id)),
    }));
  }

  private persist() { safeWriteJson(PROVIDER_CONFIG_PATH, this.providers); }

  get(id: string): ProviderDefinition | undefined { return this.providers.find(provider => provider.id === id); }

  getSecret(id: string): string { return this.secrets.get(id) || ''; }

  setSecret(id: string, secret: string) {
    if (!this.get(id)) throw new Error('Provedor não encontrado.');
    if (secret.length > 4000) throw new Error('A chave informada excede o limite permitido.');
    if (secret.trim()) this.secrets.set(id, secret.trim());
    else this.secrets.delete(id);
  }

  save(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Dados do provedor inválidos.');
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) throw new Error('Identificador inválido (use letras, números, hífen ou sublinhado).');
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 80) : '';
    const kind = value.kind === 'openrouter' ? 'openrouter' : 'openai-compatible';
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim().replace(/\/$/, '') : '';
    const model = typeof value.model === 'string' ? value.model.trim().slice(0, 200) : '';
    if (!name || !isAllowedEndpoint(baseUrl)) throw new Error('Informe um nome e um endpoint HTTPS ou HTTP de loopback.');
    if (model.length > 200) throw new Error('O identificador do modelo é muito longo.');
    const apiKeyEnv = typeof value.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.apiKeyEnv) ? value.apiKeyEnv : undefined;
    const provider: ProviderDefinition = { id, name, kind, baseUrl, model, apiKeyEnv, enabled: value.enabled !== false };
    const existing = this.providers.findIndex(item => item.id === id);
    if (existing >= 0) this.providers[existing] = provider;
    else this.providers.push(provider);
    this.persist();
    return this.list();
  }

  remove(id: string) {
    this.providers = this.providers.filter(provider => provider.id !== id);
    this.secrets.delete(id);
    this.persist();
    return this.list();
  }

  client(id: string) {
    const provider = this.get(id);
    if (!provider || provider.enabled === false) throw new Error('Provedor não encontrado ou desativado.');
    const key = this.getSecret(id);
    if (provider.kind === 'openrouter' && !key) throw new Error('Configure a chave da API do OpenRouter no painel de provedores.');
    return new OpenAI({ baseURL: provider.baseUrl, apiKey: key || 'godmode-local-no-key', timeout: 120_000, maxRetries: 1 });
  }

  async models(id: string) {
    const provider = this.get(id);
    if (!provider) throw new Error('Provedor não encontrado.');
    const client = this.client(id);
    let modelIds: string[] = [];

    let openAiListError: unknown;
    try {
      const response = await client.models.list();
      modelIds = response.data.map(model => model.id).filter(Boolean);
    } catch (error) {
      openAiListError = error;
    }

    // O endpoint OpenAI-compatible do Ollama pode não expor /v1/models
    // (ou devolver uma lista vazia). Consultar /api/tags somente em loopback.
    if (!modelIds.length) {
      const endpoint = new URL(provider.baseUrl);
      const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
      if (!isLoopback) {
        if (openAiListError) throw openAiListError;
      } else {
        endpoint.pathname = '/api/tags';
        endpoint.search = '';
        endpoint.hash = '';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(endpoint, { signal: controller.signal });
          if (!response.ok) throw new Error(`Ollama respondeu HTTP ${response.status} ao listar modelos.`);
          const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
          modelIds = (payload.models || []).map(model => model.name || model.model || '').filter(Boolean);
        } finally {
          clearTimeout(timer);
        }
      }
    }

    return [...new Set(modelIds)].sort((a, b) => a.localeCompare(b));
  }
}

export const providerRegistry = new ProviderRegistry();
