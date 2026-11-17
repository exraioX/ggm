import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import path from 'node:path';
import { MCP_CONFIG_PATH, WORKSPACE, readJson, safeWriteJson } from './config.js';
import { interpolateEnv, isAllowedEndpoint } from './security.js';

export type McpMode = 'stdio' | 'streamable-http' | 'sse' | 'auto';
export interface McpServerDefinition {
  name: string;
  description?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: McpMode;
}
interface LiveServer {
  client: Client;
  transport: Transport;
  tools: any[];
  resources: any[];
  prompts: any[];
  connectedAt: string;
  mode: McpMode;
}
interface ClaudeConfig { mcpServers?: Record<string, Record<string, unknown>> }

function validName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name);
}

function normalizeDefinition(name: string, raw: Record<string, unknown>): McpServerDefinition {
  if (!validName(name)) throw new Error(`Nome inválido para servidor MCP: ${name}`);
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const explicitMode = String(raw.transport || raw.type || '').toLowerCase();
  const mode: McpMode = explicitMode === 'stdio' ? 'stdio'
    : ['sse', 'http+sse'].includes(explicitMode) ? 'sse'
      : ['streamable-http', 'streamable_http', 'http'].includes(explicitMode) ? 'streamable-http'
        : command ? 'stdio' : 'auto';

  if (command && url) throw new Error(`O servidor ${name} não pode ter command e url ao mesmo tempo.`);
  if (command) {
    if (command.length > 512) throw new Error(`O comando de ${name} excede 512 caracteres.`);
    if (Array.isArray(raw.args) && raw.args.length > 128) throw new Error(`O servidor ${name} excede o limite de 128 argumentos.`);
    const args = Array.isArray(raw.args)
      ? raw.args.filter((x): x is string => typeof x === 'string').map(value => value.slice(0, 2048))
      : [];
    const envRaw = raw.env && typeof raw.env === 'object' ? raw.env as Record<string, unknown> : {};
    const env = Object.fromEntries(Object.entries(envRaw)
      .filter((entry): entry is [string, string] => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(entry[0]) && typeof entry[1] === 'string')
      .slice(0, 100).map(([key, value]) => [key, value.slice(0, 4096)]));
    return {
      name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
      enabled: raw.disabled !== true && raw.enabled !== false,
      command,
      args,
      env,
      cwd: typeof raw.cwd === 'string' && raw.cwd.trim() ? path.resolve(WORKSPACE, raw.cwd.slice(0, 2048)) : WORKSPACE,
      transport: 'stdio',
    };
  }
  if (url) {
    if (!isAllowedEndpoint(url)) throw new Error(`URL do servidor ${name} precisa usar HTTPS ou HTTP em localhost/loopback.`);
    const headersRaw = raw.headers && typeof raw.headers === 'object' ? raw.headers as Record<string, unknown> : {};
    const headers = Object.fromEntries(Object.entries(headersRaw)
      .filter((entry): entry is [string, string] => /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(entry[0]) && typeof entry[1] === 'string')
      .slice(0, 100).map(([key, value]) => [key, value.slice(0, 4096)]));
    return {
      name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
      enabled: raw.disabled !== true && raw.enabled !== false,
      url,
      headers,
      transport: mode === 'stdio' ? 'auto' : mode,
    };
  }
  throw new Error(`Servidor ${name}: informe command/args (stdio) ou url (HTTP).`);
}

export function parseMcpConfig(input: unknown): McpServerDefinition[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A configuração precisa ser um objeto JSON.');
  const root = input as Record<string, unknown>;
  const rawServers = root.mcpServers && typeof root.mcpServers === 'object'
    ? root.mcpServers as Record<string, unknown>
    : root.servers && typeof root.servers === 'object'
      ? root.servers as Record<string, unknown>
      : null;
  if (!rawServers) throw new Error('Não encontrei a propriedade "mcpServers" (formato Claude Desktop) ou "servers".');
  const entries = Object.entries(rawServers);
  if (entries.length > 100) throw new Error('Limite de 100 servidores MCP por configuração.');
  return entries.map(([name, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Configuração inválida para ${name}.`);
    return normalizeDefinition(name, raw as Record<string, unknown>);
  });
}

function redactArguments(args: string[] = []): string[] {
  const output: string[] = [];
  let maskNext = false;
  for (const arg of args) {
    if (maskNext) { output.push('********'); maskNext = false; continue; }
    if (/^--?(?:token|api[-_]?key|password|passwd|secret|authorization|auth)$/i.test(arg)) {
      output.push(arg); maskNext = true; continue;
    }
    if (/^(--?)?(?:token|api[-_]?key|password|passwd|secret|authorization|auth)=/i.test(arg)) {
      output.push(arg.replace(/=.*/, '=********')); continue;
    }
    output.push(arg);
  }
  return output;
}

function redact(definition: McpServerDefinition) {
  return {
    ...definition,
    args: definition.args ? redactArguments(definition.args) : undefined,
    url: definition.url ? (() => { const u = new URL(definition.url!); u.search = ''; u.hash = ''; return u.toString(); })() : undefined,
    headers: definition.headers ? Object.fromEntries(Object.keys(definition.headers).map(key => [key, '********'])) : undefined,
    env: definition.env ? Object.fromEntries(Object.keys(definition.env).map(key => [key, '********'])) : undefined,
  };
}

export class McpRegistry {
  private definitions: McpServerDefinition[];
  private readonly live = new Map<string, LiveServer>();
  private readonly errors = new Map<string, string>();

  constructor() {
    const stored = readJson<unknown>(MCP_CONFIG_PATH, { mcpServers: {} });
    try { this.definitions = parseMcpConfig(stored); }
    catch (error) {
      this.definitions = [];
      this.errors.set('config', error instanceof Error ? error.message : String(error));
    }
  }

  listConfigured() {
    return this.definitions.map(def => ({
      ...redact(def),
      connected: this.live.has(def.name),
      tools: this.live.get(def.name)?.tools.length || 0,
      resources: this.live.get(def.name)?.resources.length || 0,
      prompts: this.live.get(def.name)?.prompts.length || 0,
      connectedAt: this.live.get(def.name)?.connectedAt || null,
      connectedTransport: this.live.get(def.name)?.mode || null,
      error: this.errors.get(def.name) || null,
      headerCount: Object.keys(def.headers || {}).length,
    }));
  }

  private definitionToRaw(def: McpServerDefinition): Record<string, unknown> {
    return def.command
      ? { command: def.command, args: def.args || [], cwd: def.cwd, env: def.env || {}, description: def.description, disabled: def.enabled === false }
      : { url: def.url, transport: def.transport, headers: def.headers || {}, description: def.description, disabled: def.enabled === false };
  }

  getConfigForExport(): { mcpServers: Record<string, unknown> } {
    return { mcpServers: Object.fromEntries(this.definitions.map(def => [def.name, this.definitionToRaw(def)])) };
  }

  async mergeConfig(input: unknown) {
    const imported = parseMcpConfig(input);
    const merged = new Map(this.definitions.map(def => [def.name, def]));
    for (const def of imported) merged.set(def.name, def);
    return this.saveConfig({ mcpServers: Object.fromEntries([...merged.values()].map(def => [def.name, this.definitionToRaw(def)])) });
  }

  async saveConfig(input: unknown) {
    const definitions = parseMcpConfig(input);
    const nextByName = new Map(definitions.map(def => [def.name, def]));
    const previousByName = new Map(this.definitions.map(def => [def.name, def]));
    for (const name of [...this.live.keys()]) {
      const previous = previousByName.get(name);
      const next = nextByName.get(name);
      const changed = !previous || !next || JSON.stringify(this.definitionToRaw(previous)) !== JSON.stringify(this.definitionToRaw(next));
      if (changed) await this.disconnect(name);
    }
    this.definitions = definitions;
    safeWriteJson(MCP_CONFIG_PATH, { mcpServers: Object.fromEntries(definitions.map(def => [def.name, this.definitionToRaw(def)])) });
    return this.listConfigured();
  }

  listTools() {
    return [...this.live.entries()].flatMap(([server, entry]) => entry.tools.map(tool => ({
      server,
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      annotations: tool.annotations || {},
    })));
  }

  listResources() {
    return [...this.live.entries()].flatMap(([server, entry]) => entry.resources.map(resource => ({ server, ...resource })));
  }

  listPrompts() {
    return [...this.live.entries()].flatMap(([server, entry]) => entry.prompts.map(prompt => ({ server, ...prompt })));
  }

  private async discoverCapabilities(client: Client) {
    // Alguns servidores MCP implementam somente parte das capacidades. Uma
    // falha ao listar recursos/prompts não deve impedir a conexão com tools.
    const [tools, resources, prompts] = await Promise.all([
      client.listTools().then(result => result.tools || []).catch(() => []),
      client.listResources().then(result => result.resources || []).catch(() => []),
      client.listPrompts().then(result => result.prompts || []).catch(() => []),
    ]);
    return { tools: tools as any[], resources: resources as any[], prompts: prompts as any[] };
  }

  private createClient() { return new Client({ name: 'godmode-core', version: '1.0.0' }); }

  private async connectHttp(def: McpServerDefinition, mode: 'streamable-http' | 'sse' | 'auto') {
    if (!def.url) throw new Error('URL HTTP não configurada.');
    const headers = Object.fromEntries(Object.entries(def.headers || {}).map(([k, v]) => [k, interpolateEnv(v)]));
    const url = new URL(def.url);
    const connectWith = async (transportMode: 'streamable-http' | 'sse') => {
      const client = this.createClient();
      const transport = transportMode === 'streamable-http'
        ? new StreamableHTTPClientTransport(url, { requestInit: { headers } })
        : new SSEClientTransport(url, {
            requestInit: { headers },
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
              const merged = new Headers(init?.headers);
              for (const [key, value] of Object.entries(headers)) if (!merged.has(key)) merged.set(key, value);
              return fetch(input, { ...init, headers: merged });
            },
          });
      try {
        await client.connect(transport);
        const capabilities = await this.discoverCapabilities(client);
        return { client, transport: transport as Transport, ...capabilities, mode: transportMode };
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    };
    if (mode === 'sse') return connectWith('sse');
    if (mode === 'streamable-http') return connectWith('streamable-http');
    try { return await connectWith('streamable-http'); }
    catch (streamError) {
      try { return await connectWith('sse'); }
      catch (sseError) {
        const first = streamError instanceof Error ? streamError.message : String(streamError);
        const second = sseError instanceof Error ? sseError.message : String(sseError);
        throw new Error(`Streamable HTTP falhou (${first}); fallback SSE também falhou (${second}).`);
      }
    }
  }

  async connect(name: string) {
    const def = this.definitions.find(item => item.name === name);
    if (!def) throw new Error(`Servidor MCP desconhecido: ${name}`);
    if (def.enabled === false) throw new Error(`${name} está desativado. Ative-o na configuração antes de conectar.`);
    if (this.live.has(name)) return this.listConfigured().find(item => item.name === name);
    try {
      let connected: { client: Client; transport: Transport; tools: any[]; resources: any[]; prompts: any[]; mode: McpMode };
      if (def.command) {
        const inherited = new Set(['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'PYTHONUTF8', 'PYTHONIOENCODING', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']);
        const envValues = new Map<string, { key: string; value: string }>();
        for (const [key, value] of Object.entries(process.env)) {
          if (inherited.has(key) && typeof value === 'string') {
            const normalized = process.platform === 'win32' ? key.toUpperCase() : key;
            envValues.set(normalized, { key: normalized, value });
          }
        }
        for (const [key, value] of Object.entries(def.env || {})) {
          const normalized = process.platform === 'win32' ? key.toUpperCase() : key;
          envValues.set(normalized, { key: normalized, value: interpolateEnv(String(value)) });
        }
        const env = Object.fromEntries([...envValues.values()].map(({ key, value }) => [key, value]));
        const client = this.createClient();
        const transport = new StdioClientTransport({
          command: def.command,
          args: def.args || [],
          cwd: def.cwd || WORKSPACE,
          env,
          stderr: 'inherit',
        });
        try {
          await client.connect(transport);
          const capabilities = await this.discoverCapabilities(client);
          connected = { client, transport, ...capabilities, mode: 'stdio' };
        } catch (error) {
          await client.close().catch(() => undefined);
          throw error;
        }
      } else {
        const httpMode = def.transport === 'sse' ? 'sse' : def.transport === 'streamable-http' ? 'streamable-http' : 'auto';
        connected = await this.connectHttp(def, httpMode);
      }
      this.live.set(name, { ...connected, connectedAt: new Date().toISOString() });
      this.errors.delete(name);
      return this.listConfigured().find(item => item.name === name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(name, message);
      throw new Error(`${name}: ${message}`);
    }
  }

  async connectAll() {
    const results = [];
    for (const def of this.definitions.filter(item => item.enabled !== false)) {
      try { results.push({ name: def.name, ok: true, status: await this.connect(def.name) }); }
      catch (error) { results.push({ name: def.name, ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
    return results;
  }

  async disconnect(name: string) {
    const live = this.live.get(name);
    if (!live) return;
    this.live.delete(name);
    await live.client.close().catch(() => undefined);
    this.errors.delete(name);
  }

  async disconnectAll() { await Promise.all([...this.live.keys()].map(name => this.disconnect(name))); }

  private async getLive(serverName: string) {
    let live = this.live.get(serverName);
    if (!live) {
      await this.connect(serverName);
      live = this.live.get(serverName);
    }
    if (!live) throw new Error(`Servidor MCP ${serverName} não conectou.`);
    return live;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    const live = await this.getLive(serverName);
    return await live.client.callTool({ name: toolName, arguments: args }) as any;
  }

  async readResource(serverName: string, uri: string) {
    const live = await this.getLive(serverName);
    if (!live.resources.some(resource => resource.uri === uri)) throw new Error('O recurso não está na lista de recursos anunciados pelo servidor.');
    return await live.client.readResource({ uri }) as any;
  }

  async getPrompt(serverName: string, name: string, args: Record<string, string>) {
    const live = await this.getLive(serverName);
    if (!live.prompts.some(prompt => prompt.name === name)) throw new Error('O prompt não está na lista de prompts anunciados pelo servidor.');
    return await live.client.getPrompt({ name, arguments: args }) as any;
  }
}

export const mcpRegistry = new McpRegistry();
