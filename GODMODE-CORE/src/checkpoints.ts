// checkpoints.ts — snapshots de arquivos antes de modificações destrutivas
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GODMODE_HOME } from './config.js';

// ============================================================
// Interfaces públicas
// ============================================================

export interface CheckpointInfo {
  id: string;
  sessionId: string;
  createdAt: string;
  fileCount: number;
  files: string[];
}

export interface RevertResult {
  reverted: string[];
  notFound: string[];
  errors: string[];
}

interface CheckpointMeta {
  id: string;
  sessionId: string;
  createdAt: string;
  files: Array<{ path: string; existed: boolean }>;
}

// ============================================================
// Constantes
// ============================================================

const MAX_CHECKPOINTS_PER_SESSION = 20;
const CHECKPOINTS_BASE = path.join(GODMODE_HOME, 'checkpoints');

// ============================================================
// Classe CheckpointManager
// ============================================================

export class CheckpointManager {
  // Cache em memória: sessionId → lista de CheckpointInfo (mais antigos primeiro)
  private cache: Map<string, CheckpointInfo[]> = new Map();
  private initialized = false;

  /**
   * Carrega metadados do disco na primeira chamada.
   */
  private ensureLoaded(): void {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (!fs.existsSync(CHECKPOINTS_BASE)) return;
      for (const sessionDir of fs.readdirSync(CHECKPOINTS_BASE)) {
        const sessionPath = path.join(CHECKPOINTS_BASE, sessionDir);
        if (!fs.statSync(sessionPath).isDirectory()) continue;
        const infos: CheckpointInfo[] = [];
        for (const cpDir of fs.readdirSync(sessionPath)) {
          const metaPath = path.join(sessionPath, cpDir, '.meta.json');
          if (!fs.existsSync(metaPath)) continue;
          try {
            const meta: CheckpointMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            infos.push({
              id: meta.id,
              sessionId: meta.sessionId,
              createdAt: meta.createdAt,
              fileCount: meta.files.length,
              files: meta.files.map(f => f.path),
            });
          } catch {
            // Metadado corrompido; ignorar
          }
        }
        // Ordenar por data de criação (mais antigos primeiro)
        infos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        this.cache.set(sessionDir, infos);
      }
    } catch {
      // Falha silenciosa na inicialização; o cache ficará vazio
    }
  }

  /**
   * Cria um checkpoint dos arquivos informados para a sessão.
   * Retorna o checkpointId gerado.
   */
  async createCheckpoint(sessionId: string, filePaths: string[]): Promise<string> {
    this.ensureLoaded();
    const checkpointId = randomUUID();
    const cpDir = path.join(CHECKPOINTS_BASE, sessionId, checkpointId);
    fs.mkdirSync(cpDir, { recursive: true });

    const filesMeta: Array<{ path: string; existed: boolean }> = [];

    for (const filePath of filePaths) {
      const existed = fs.existsSync(filePath);
      filesMeta.push({ path: filePath, existed });
      if (existed) {
        try {
          // Preservar estrutura relativa usando hash do caminho como nome de arquivo
          const safeName = Buffer.from(filePath).toString('base64url').slice(0, 200);
          fs.copyFileSync(filePath, path.join(cpDir, safeName));
        } catch {
          // Não impedir a operação se a cópia falhar
        }
      }
    }

    const meta: CheckpointMeta = {
      id: checkpointId,
      sessionId,
      createdAt: new Date().toISOString(),
      files: filesMeta,
    };

    fs.writeFileSync(path.join(cpDir, '.meta.json'), JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });

    // Atualizar cache
    const infos = this.cache.get(sessionId) ?? [];
    infos.push({
      id: checkpointId,
      sessionId,
      createdAt: meta.createdAt,
      fileCount: filesMeta.length,
      files: filesMeta.map(f => f.path),
    });

    // Purge dos mais antigos se exceder o limite
    while (infos.length > MAX_CHECKPOINTS_PER_SESSION) {
      const oldest = infos.shift()!;
      await this.deleteDir(path.join(CHECKPOINTS_BASE, sessionId, oldest.id));
    }

    this.cache.set(sessionId, infos);
    return checkpointId;
  }

  /**
   * Lista checkpoints. Se sessionId for informado, filtra por sessão.
   */
  listCheckpoints(sessionId?: string): CheckpointInfo[] {
    this.ensureLoaded();
    if (sessionId) {
      return [...(this.cache.get(sessionId) ?? [])].reverse(); // mais recentes primeiro
    }
    const all: CheckpointInfo[] = [];
    for (const infos of this.cache.values()) {
      all.push(...infos);
    }
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Reverte os arquivos de um checkpoint ao estado salvo.
   */
  async revert(checkpointId: string, sessionId: string): Promise<RevertResult> {
    this.ensureLoaded();
    const cpDir = path.join(CHECKPOINTS_BASE, sessionId, checkpointId);
    const metaPath = path.join(cpDir, '.meta.json');

    if (!fs.existsSync(metaPath)) {
      throw new Error(`Checkpoint ${checkpointId} não encontrado para a sessão ${sessionId}.`);
    }

    const meta: CheckpointMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const result: RevertResult = { reverted: [], notFound: [], errors: [] };

    for (const fileEntry of meta.files) {
      const safeName = Buffer.from(fileEntry.path).toString('base64url').slice(0, 200);
      const savedPath = path.join(cpDir, safeName);

      if (!fileEntry.existed) {
        // Arquivo não existia; remover se existir agora
        try {
          if (fs.existsSync(fileEntry.path)) fs.unlinkSync(fileEntry.path);
          result.reverted.push(fileEntry.path);
        } catch (err) {
          result.errors.push(`${fileEntry.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }

      if (!fs.existsSync(savedPath)) {
        result.notFound.push(fileEntry.path);
        continue;
      }

      try {
        fs.mkdirSync(path.dirname(fileEntry.path), { recursive: true });
        fs.copyFileSync(savedPath, fileEntry.path);
        result.reverted.push(fileEntry.path);
      } catch (err) {
        result.errors.push(`${fileEntry.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return result;
  }

  /**
   * Remove um checkpoint do disco e do cache.
   */
  async delete(checkpointId: string): Promise<void> {
    this.ensureLoaded();
    // Buscar a sessão no cache
    for (const [sessionId, infos] of this.cache.entries()) {
      const idx = infos.findIndex(i => i.id === checkpointId);
      if (idx !== -1) {
        infos.splice(idx, 1);
        await this.deleteDir(path.join(CHECKPOINTS_BASE, sessionId, checkpointId));
        return;
      }
    }
    throw new Error(`Checkpoint ${checkpointId} não encontrado.`);
  }

  /**
   * Remove um diretório recursivamente com tratamento de erros.
   */
  private async deleteDir(dirPath: string): Promise<void> {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
      // Falha silenciosa na remoção
    }
  }
}

// Singleton exportado
export const checkpointManager = new CheckpointManager();
