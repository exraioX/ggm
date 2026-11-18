import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response, NextFunction } from 'express';
import { ALLOWED_ORIGINS, CORE_ORIGINS, WORKSPACE } from './config.js';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const MUTATING_NAME = /(^|[_-])(write|edit|create|update|delete|remove|move|rename|execute|run|shell|terminal|command|install|uninstall|patch|format|commit|push|deploy|restart|kill|stop|save|store|remember|forget|clear|reset)([_-]|$)/i;
const READONLY_NAME = /^(list|get|search|find|inspect|analy[sz]e|read|query|recall|retrieve|status|stats|doctor|check|lookup|view|show|decompile|disassemble|explain|describe|discover|map|fetch|browse)(_|$)/i;
const PATH_KEYS = /^(path|file|file_path|directory|directory_path|root|workspace|target|source|target_path|output_path|input_path|project_path|source_path|binary_path|application_path)$/i;

export function isLoopbackAddress(address = ''): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  return !origin || ALLOWED_ORIGINS.has(origin) || CORE_ORIGINS.has(origin);
}

export function requireLocalApp(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackAddress(req.socket.remoteAddress || '')) {
    res.status(403).json({ error: 'O GODMODE aceita conexões somente deste computador.' });
    return;
  }
  const origin = req.header('origin');
  if (origin && !isAllowedLocalOrigin(origin)) {
    res.status(403).json({ error: 'Origem não permitida para o núcleo local.' });
    return;
  }
  next();
}

export function isAllowedEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && LOOPBACK_NAMES.has(url.hostname);
  } catch { return false; }
}

export function toolRequiresApproval(tool: {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}): boolean {
  if (tool.annotations?.destructiveHint === true || MUTATING_NAME.test(tool.name)) return true;
  if (tool.annotations?.readOnlyHint === true) return false;
  return !READONLY_NAME.test(tool.name);
}

export function hasPathOutsideWorkspace(value: unknown, workspace = WORKSPACE, key = ''): boolean {
  if (typeof value === 'string' && (PATH_KEYS.test(key) || /(?:path|file|directory)$/i.test(key))) {
    let candidate = value;
    // URIs com esquema "file://" apontam para o sistema de arquivos e PRECISAM
    // passar pela checagem de workspace abaixo; tratá-las como "não é um
    // caminho" permitiria escapar da sandbox só trocando "/etc/passwd" por
    // "file:///etc/passwd". Convertemos para um caminho real antes de validar.
    if (/^file:\/\//i.test(candidate)) {
      try { candidate = fileURLToPath(candidate); }
      catch { return true; } // file:// malformado: trata como suspeito e exige aprovação.
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      // Outros esquemas (http, https, s3, etc.) são recursos remotos, não
      // caminhos no disco local — não há o que validar contra o workspace.
      return false;
    }
    const expanded = candidate.startsWith('~/') || candidate.startsWith('~\\')
      ? path.join(process.env.USERPROFILE || process.env.HOME || '', candidate.slice(2))
      : candidate;
    const resolved = path.resolve(workspace, expanded);
    const relative = path.relative(path.resolve(workspace), resolved);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  }
  if (Array.isArray(value)) return value.some(item => hasPathOutsideWorkspace(item, workspace, key));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([childKey, childValue]) => hasPathOutsideWorkspace(childValue, workspace, childKey));
  }
  return false;
}

export function interpolateEnv(value: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) throw new Error(`Variável de ambiente ${name} não definida.`);
    return resolved;
  });
}
