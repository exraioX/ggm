// auto-setup.ts — Inicialização automática de servidores MCP gratuitos no LUPID
import path from 'node:path';
import { mcpRegistry } from './mcp-registry.js';
import { GODMODE_HOME, readJson, safeWriteJson } from './config.js';

const SETUP_FLAG_PATH = path.join(GODMODE_HOME, 'auto-setup-done.json');

const FREE_MCP_SERVERS = [
  {
    name: 'lupid-fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    transport: 'stdio' as const,
    description: 'Busca e lê páginas web, converte HTML para Markdown.',
  },
  {
    name: 'lupid-memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    transport: 'stdio' as const,
    description: 'Grafo de conhecimento persistente para o agente.',
  },
  {
    name: 'lupid-git',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    transport: 'stdio' as const,
    description: 'Git: status, diff, log, commit e branches.',
  },
  {
    name: 'lupid-sequentialthinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    transport: 'stdio' as const,
    description: 'Raciocínio passo a passo estruturado para tarefas complexas.',
  },
];

export interface SetupResult {
  alreadyDone: boolean;
  registered: string[];
  skipped: string[];
}

export async function runAutoSetup(): Promise<SetupResult> {
  const flag = readJson<{ done: boolean; at: string }>(SETUP_FLAG_PATH, { done: false, at: '' });
  if (flag.done) return { alreadyDone: true, registered: [], skipped: [] };

  const registered: string[] = [];
  const skipped: string[] = [];

  const existing = mcpRegistry.listConfigured().map((s: any) => s.name);

  for (const server of FREE_MCP_SERVERS) {
    if (existing.includes(server.name)) {
      skipped.push(server.name);
      continue;
    }
    try {
      await mcpRegistry.mergeConfig({
        mcpServers: {
          [server.name]: {
            command: server.command,
            args: server.args,
          },
        },
      });
      registered.push(server.name);
    } catch {
      skipped.push(server.name);
    }
  }

  safeWriteJson(SETUP_FLAG_PATH, { done: true, at: new Date().toISOString(), registered });
  console.log(`[LUPID] Auto-setup concluído: ${registered.length} MCPs registrados, ${skipped.length} já existiam.`);
  return { alreadyDone: false, registered, skipped };
}
