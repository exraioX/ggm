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
    const client = this.client(id);
    const response = await client.models.list();
    return response.data.map(model => model.id).sort((a, b) => a.localeCompare(b));
  }
}

export const providerRegistry = new ProviderRegistry();
