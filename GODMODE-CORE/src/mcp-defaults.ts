import { WORKSPACE } from './config.js';

const windows = process.platform === 'win32';
const npxCommand = windows ? 'cmd' : 'npx';
const npxPrefix = windows ? ['/c', 'npx', '-y'] : ['-y'];

function npmServer(packageName: string, args: string[], description: string) {
  return {
    command: npxCommand,
    args: [...npxPrefix, packageName, ...args],
    cwd: WORKSPACE,
    autoStart: true,
    enabled: true,
    description,
  };
}

/**
 * Seeded only when the user's MCP configuration does not exist yet.
 * The three lightweight core servers are installed by npx on first launch
 * and run as independent stdio child processes managed by GODMODE CORE.
 */
export function createDefaultMcpConfig() {
  return {
    mcpServers: {
      filesystem: npmServer(
        '@modelcontextprotocol/server-filesystem',
        [WORKSPACE],
        'Acesso aos arquivos do workspace do GODMODE. Operações de escrita exigem aprovação.'
      ),
      memory: npmServer(
        '@modelcontextprotocol/server-memory',
        [],
        'Memória persistente em grafo para contexto e relações de pesquisa.'
      ),
      'sequential-thinking': npmServer(
        '@modelcontextprotocol/server-sequential-thinking',
        [],
        'Organização de tarefas complexas e análise estruturada de hipóteses.'
      )
    }
  };
}
