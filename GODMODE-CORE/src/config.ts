import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = path.resolve(process.cwd(), '..');
const configuredHome = process.env.GODMODE_HOME?.trim();
export const GODMODE_HOME = path.resolve(configuredHome || path.join(os.homedir(), '.godmode'));
export const WORKSPACE = path.resolve(process.env.GODMODE_WORKSPACE || projectRoot);
const parsedPort = Number.parseInt(process.env.PORT || '8765', 10);
export const PORT = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 8765;
const requestedHost = (process.env.HOST || '127.0.0.1').trim().toLowerCase();
// Nunca permitir que uma configuração acidental exponha o Core na rede.
export const HOST = new Set(['127.0.0.1', 'localhost', '::1']).has(requestedHost) ? requestedHost : '127.0.0.1';
export const PROVIDER_CONFIG_PATH = path.resolve(process.env.GODMODE_PROVIDER_CONFIG || path.join(GODMODE_HOME, 'providers.json'));
export const MCP_CONFIG_PATH = path.resolve(process.env.GODMODE_MCP_CONFIG || path.join(GODMODE_HOME, 'mcp-servers.json'));
export const MEMORY_PATH = path.join(GODMODE_HOME, 'memory.json');
// O GODMODE CORE é independente: por padrão só a própria interface (CORE_ORIGINS)
// pode chamar a API. Defina GODMODE_ALLOWED_ORIGINS para liberar outros clientes locais.
export const ALLOWED_ORIGINS = new Set(
  (process.env.GODMODE_ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim()).filter(Boolean),
);
export const CORE_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`,
]);

export function ensureGodmodeHome(): void {
  fs.mkdirSync(GODMODE_HOME, { recursive: true });
  try { fs.chmodSync(GODMODE_HOME, 0o700); } catch { /* Windows ACLs are managed by the OS. */ }
}

export function safeWriteJson(filePath: string, value: unknown): void {
  ensureGodmodeHome();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* chmod is not available on all Windows filesystems. */ }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
