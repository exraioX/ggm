import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_SERVERS, WORKSPACE, type McpServerConfig, type LabServiceConfig } from './config.js';

interface LiveServer {
  client: Client;
  transport: StdioClientTransport;
  tools: any[];
  connectedAt: string;
  error?: string;
}

interface LiveService {
  process: ChildProcess;
  startedAt: string;
  error?: string;
}

export class McpRegistry {
  private readonly servers = new Map<string, LiveServer>();
  private readonly services = new Map<string, LiveService>();
  private readonly errors = new Map<string, string>();

  listConfigured() {
    return MCP_SERVERS.map(server => ({
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      connected: this.servers.has(server.name),
      tools: this.servers.get(server.name)?.tools.length || 0,
      connectedAt: this.servers.get(server.name)?.connectedAt || null,
      error: this.errors.get(server.name) || null,
    }));
  }

  listTools() {
    return [...this.servers.entries()].flatMap(([server, live]) => live.tools.map(tool => ({
      server,
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      annotations: tool.annotations || {},
    })));
  }

  async connect(name: string) {
    const config = MCP_SERVERS.find(item => item.name === name);
    if (!config) throw new Error(`Unknown MCP server: ${name}`);
    if (!config.enabled) throw new Error(`${name} is disabled. Configure its executable before connecting.`);
    if (this.servers.has(name)) return this.listConfigured().find(item => item.name === name);

    try {
      for (const service of config.services || []) await this.ensureService(`${name}:${service.command}`, service);

      const env = Object.fromEntries(
        Object.entries({ ...process.env, ...config.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        cwd: config.cwd || WORKSPACE,
        env,
        stderr: 'pipe',
      });
      const client = new Client({ name: 'godmode-lab', version: '0.1.0' });
      client.onerror = error => this.errors.set(name, error.message);
      await client.connect(transport);
      const response = await client.listTools();
      this.servers.set(name, {
        client,
        transport,
        tools: response.tools as any[],
        connectedAt: new Date().toISOString(),
      });
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
    for (const config of MCP_SERVERS.filter(item => item.enabled)) {
      try {
        results.push({ name: config.name, ok: true, status: await this.connect(config.name) });
      } catch (error) {
        results.push({ name: config.name, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  async disconnect(name: string) {
    const live = this.servers.get(name);
    if (!live) return;
    this.servers.delete(name);
    await live.client.close().catch(() => undefined);
    this.errors.delete(name);
  }

  async disconnectAll() {
    await Promise.all([...this.servers.keys()].map(name => this.disconnect(name)));
    for (const service of this.services.values()) service.process.kill();
    this.services.clear();
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>) {
    let live = this.servers.get(serverName);
    if (!live) {
      await this.connect(serverName);
      live = this.servers.get(serverName);
    }
    if (!live) throw new Error(`MCP server ${serverName} did not connect.`);
    const result = await live.client.callTool({ name: toolName, arguments: args });
    return result as any;
  }

  private async ensureService(key: string, config: LabServiceConfig) {
    const existing = this.services.get(key);
    if (existing && existing.process.exitCode === null && !existing.process.killed) return;

    const child = spawn(config.command, config.args, {
      cwd: config.cwd || WORKSPACE,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    const service: LiveService = { process: child, startedAt: new Date().toISOString() };
    this.services.set(key, service);
    child.once('error', error => {
      service.error = error.message;
      this.errors.set(key.split(':')[0], `Unable to start service: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      if (code !== null && code !== 0) this.errors.set(key.split(':')[0], `Background service exited (${code}; ${signal || 'no signal'}).`);
      this.services.delete(key);
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 900);
      child.once('spawn', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    if (child.exitCode !== null) throw new Error(`Background service exited before startup (${child.exitCode}).`);
  }
}

export const mcpRegistry = new McpRegistry();
