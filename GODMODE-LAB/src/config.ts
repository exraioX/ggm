import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface LabServiceConfig {
  command: string;
  args: string[];
  cwd?: string;
}

export interface McpServerConfig {
  name: string;
  description: string;
  enabled: boolean;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  services?: LabServiceConfig[];
}

const root = path.resolve(process.cwd(), '..');
const configuredWorkspace = process.env.GODMODE_LAB_WORKSPACE;
const defaultWorkspace = path.resolve(process.cwd(), configuredWorkspace || '../G0DM0D3');
const workspace = fs.existsSync(defaultWorkspace) ? defaultWorkspace : root;
const npx = process.env.GODMODE_LAB_NPX || (process.platform === 'win32' ? 'npx.cmd' : 'npx');
const uvx = process.env.GODMODE_LAB_UVX || (process.platform === 'win32' ? 'uvx.exe' : 'uvx');
const headroom = process.env.GODMODE_LAB_HEADROOM || (process.platform === 'win32' ? 'headroom.exe' : 'headroom');
const goldieCommand = process.env.GOLDIE_MCP_COMMAND?.trim();

export const PORT = Number.parseInt(process.env.PORT || '8765', 10);
export const WORKSPACE = workspace;
export const ALLOWED_ORIGINS = new Set(
  (process.env.GODMODE_LAB_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map(value => value.trim()).filter(Boolean),
);

export const MCP_SERVERS: McpServerConfig[] = [
  {
    name: 'rea',
    description: 'Reverse Engineer Anything — inspect application structure, binaries, JavaScript/Electron and runtime evidence.',
    enabled: true,
    command: npx,
    args: ['-y', 'rea-agents@6.9.0', 'mcp'],
    cwd: workspace,
  },
  {
    name: 'serena',
    description: 'Semantic code navigation, symbol search, references and safe code editing.',
    enabled: true,
    command: uvx,
    args: ['--python', '3.13', 'serena-agent', 'start-mcp-server', '--project-from-cwd', '--context', 'codex'],
    cwd: workspace,
  },
  {
    name: 'headroom',
    description: 'Local context compression, retrieval and cross-agent memory tools.',
    enabled: true,
    command: headroom,
    args: ['mcp', 'serve', '--proxy-url', 'http://127.0.0.1:8787'],
    cwd: workspace,
    services: [{ command: headroom, args: ['proxy', '--port', '8787'], cwd: workspace }],
  },
  {
    name: 'goldie',
    description: 'Shared SQLite vector memory with semantic recall across agents.',
    enabled: Boolean(goldieCommand),
    command: goldieCommand || 'goldie-mcp',
    args: ['-b', 'ollama'],
    cwd: workspace,
    env: {
      GOLDIE_DB_PATH: process.env.GOLDIE_DB_PATH || path.join(os.homedir(), '.local', 'share', 'goldie', 'index.db'),
      OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    },
  },
];

export function getServerConfig(name: string): McpServerConfig | undefined {
  return MCP_SERVERS.find(server => server.name === name);
}
