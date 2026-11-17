import path from 'node:path';

import type { Request, Response, NextFunction } from 'express';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackAddress(address = ''): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOOPBACK_NAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function requireLoopback(req: Request, res: Response, next: NextFunction): void {
  if (!isLoopbackAddress(req.socket.remoteAddress || '')) {
    res.status(403).json({ error: 'GODMODE LAB accepts connections from this computer only.' });
    return;
  }
  if (!isAllowedLocalOrigin(req.header('origin'))) {
    res.status(403).json({ error: 'Origin is not allowed for the local GODMODE LAB gateway.' });
    return;
  }
  next();
}

export function isAllowedModelEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return LOOPBACK_NAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Only tools explicitly marked read-only are executed without a confirmation.
 * Unknown tools are treated as potentially mutating: this is intentionally
 * conservative for file writes, shell commands, reverse-engineering actions,
 * package installation and memory deletion.
 */
export function toolRequiresApproval(tool: {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}): boolean {
  if (tool.annotations?.destructiveHint === true) return true;
  if (tool.annotations?.readOnlyHint === true) return false;

  const name = tool.name.toLowerCase();
  const readOnly = /^(list|get|search|find|inspect|analy[sz]e|read|query|recall|retrieve|status|stats|doctor|check|lookup|view|show|decompile|disassemble|explain|describe|discover|map)(_|$)/;
  return !readOnly.test(name);
}


const PATH_ARGUMENT_KEYS = /^(path|file|file_path|directory|directory_path|root|workspace|target|source|target_path|output_path|input_path|project_path|source_path|binary_path|application_path)$/i;

/** Force a second confirmation for filesystem targets outside the configured workspace. */
export function hasPathOutsideWorkspace(value: unknown, workspace: string, key = ''): boolean {
  if (typeof value === 'string' && (PATH_ARGUMENT_KEYS.test(key) || /(?:path|file|directory)$/i.test(key))) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
    const expanded = value.startsWith('~/') || value.startsWith('~\\')
      ? path.join(process.env.USERPROFILE || process.env.HOME || '', value.slice(2))
      : value;
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
