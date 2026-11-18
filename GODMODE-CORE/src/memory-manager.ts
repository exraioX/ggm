// memory-manager.ts — Sistema de memórias em diferentes níveis (Global, Projeto, Sessão)
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { GODMODE_HOME, MEMORY_PATH, readJson, safeWriteJson } from './config.js';
import { projectManager } from './project-manager.js';

export type MemoryLevel = 'session' | 'project' | 'global';
export type MemorySource = 'user' | 'agent' | 'inference';

export interface MultiLevelMemoryItem {
  id: string;
  level: MemoryLevel;
  projectId?: string;
  sessionId?: string;
  title: string;
  content: string;
  category: string;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

const GLOBAL_MEMORIES_PATH = path.join(GODMODE_HOME, 'memory-global.json');
const PROJECT_MEMORIES_PATH = path.join(GODMODE_HOME, 'memory-projects.json');

export class MemoryManager {
  private globalMemories: MultiLevelMemoryItem[] = [];
  private projectMemories: MultiLevelMemoryItem[] = [];
  private sessionMemories: Map<string, MultiLevelMemoryItem[]> = new Map();
  private initialized = false;

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Carregar memórias globais
    this.globalMemories = readJson<MultiLevelMemoryItem[]>(GLOBAL_MEMORIES_PATH, []);

    // Carregar memórias por projeto
    this.projectMemories = readJson<MultiLevelMemoryItem[]>(PROJECT_MEMORIES_PATH, []);

    // Migração de compatibilidade: se memory-global e memory-projects estiverem vazios
    // mas o legado MEMORY_PATH existir com dados, migrar como global
    if (this.globalMemories.length === 0 && this.projectMemories.length === 0 && fs.existsSync(MEMORY_PATH)) {
      try {
        const legacy = readJson<any[]>(MEMORY_PATH, []);
        if (Array.isArray(legacy) && legacy.length > 0) {
          for (const item of legacy) {
            this.globalMemories.push({
              id: item.id || randomUUID(),
              level: 'global',
              title: item.title || 'Memória legada',
              content: item.content || '',
              category: item.category || 'Projeto',
              source: 'user',
              createdAt: item.createdAt || new Date().toISOString(),
              updatedAt: item.updatedAt || new Date().toISOString(),
            });
          }
          this.saveGlobal();
        }
      } catch {
        // Falha silenciosa na migração legada
      }
    }
  }

  private saveGlobal(): void {
    safeWriteJson(GLOBAL_MEMORIES_PATH, this.globalMemories.slice(0, 500));
  }

  private saveProject(): void {
    safeWriteJson(PROJECT_MEMORIES_PATH, this.projectMemories.slice(0, 1000));
  }

  list(filter?: {
    level?: MemoryLevel;
    projectId?: string;
    sessionId?: string;
    category?: string;
    query?: string;
  }): MultiLevelMemoryItem[] {
    this.ensureInitialized();
    let result: MultiLevelMemoryItem[] = [];

    if (!filter?.level || filter.level === 'global') {
      result.push(...this.globalMemories);
    }
    if (!filter?.level || filter.level === 'project') {
      if (filter?.projectId) {
        result.push(...this.projectMemories.filter(m => m.projectId === filter.projectId));
      } else {
        result.push(...this.projectMemories);
      }
    }
    if (!filter?.level || filter.level === 'session') {
      if (filter?.sessionId) {
        result.push(...(this.sessionMemories.get(filter.sessionId) || []));
      } else {
        for (const sessionList of this.sessionMemories.values()) {
          result.push(...sessionList);
        }
      }
    }

    if (filter?.category) {
      result = result.filter(m => m.category.toLowerCase() === filter.category!.toLowerCase());
    }

    if (filter?.query) {
      const q = filter.query.toLowerCase();
      result = result.filter(m => m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q));
    }

    // Mais recentes primeiro
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): MultiLevelMemoryItem | undefined {
    this.ensureInitialized();
    const g = this.globalMemories.find(m => m.id === id);
    if (g) return g;
    const p = this.projectMemories.find(m => m.id === id);
    if (p) return p;
    for (const sessionList of this.sessionMemories.values()) {
      const s = sessionList.find(m => m.id === id);
      if (s) return s;
    }
    return undefined;
  }

  create(input: {
    level: MemoryLevel;
    projectId?: string;
    sessionId?: string;
    title: string;
    content: string;
    category?: string;
    source?: MemorySource;
  }): MultiLevelMemoryItem {
    this.ensureInitialized();
    const title = input.title.trim().slice(0, 140);
    const content = input.content.trim().slice(0, 8000);
    if (!title || !content) throw new Error('Título e conteúdo são obrigatórios.');

    const now = new Date().toISOString();
    const item: MultiLevelMemoryItem = {
      id: randomUUID(),
      level: input.level,
      projectId: input.level === 'project' ? (input.projectId || projectManager.getActive().id) : undefined,
      sessionId: input.level === 'session' ? input.sessionId : undefined,
      title,
      content,
      category: input.category || 'Projeto',
      source: input.source || 'user',
      createdAt: now,
      updatedAt: now,
      expiresAt: input.level === 'session' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : undefined,
    };

    if (item.level === 'global') {
      this.globalMemories.unshift(item);
      this.saveGlobal();
    } else if (item.level === 'project') {
      this.projectMemories.unshift(item);
      this.saveProject();
    } else if (item.level === 'session' && item.sessionId) {
      const list = this.sessionMemories.get(item.sessionId) || [];
      list.unshift(item);
      this.sessionMemories.set(item.sessionId, list);
    }

    return item;
  }

  update(id: string, input: Partial<Pick<MultiLevelMemoryItem, 'title' | 'content' | 'category' | 'level' | 'projectId'>>): MultiLevelMemoryItem {
    this.ensureInitialized();
    const item = this.get(id);
    if (!item) throw new Error(`Memória ${id} não encontrada.`);

    if (input.title !== undefined) item.title = input.title.trim().slice(0, 140);
    if (input.content !== undefined) item.content = input.content.trim().slice(0, 8000);
    if (input.category !== undefined) item.category = input.category;
    if (input.projectId !== undefined && item.level === 'project') item.projectId = input.projectId;
    item.updatedAt = new Date().toISOString();

    if (item.level === 'global') this.saveGlobal();
    else if (item.level === 'project') this.saveProject();

    return item;
  }

  delete(id: string): boolean {
    this.ensureInitialized();
    const gIdx = this.globalMemories.findIndex(m => m.id === id);
    if (gIdx !== -1) {
      this.globalMemories.splice(gIdx, 1);
      this.saveGlobal();
      return true;
    }

    const pIdx = this.projectMemories.findIndex(m => m.id === id);
    if (pIdx !== -1) {
      this.projectMemories.splice(pIdx, 1);
      this.saveProject();
      return true;
    }

    for (const [sId, sList] of this.sessionMemories.entries()) {
      const sIdx = sList.findIndex(m => m.id === id);
      if (sIdx !== -1) {
        sList.splice(sIdx, 1);
        this.sessionMemories.set(sId, sList);
        return true;
      }
    }

    return false;
  }

  /**
   * Coleta as memórias mais relevantes para injetar no System Prompt do Agente.
   * Prioriza:
   * 1. Memórias específicas do projeto ativo (até 15)
   * 2. Memórias globais (preferências, arquitetura geral) (até 10)
   * 3. Memórias da sessão corrente (se houver) (até 5)
   */
  getRelevantContext(projectId?: string, sessionId?: string): string[] {
    this.ensureInitialized();
    const lines: string[] = [];
    const activeProj = projectId ? projectManager.get(projectId) : projectManager.getActive();
    const resolvedProjId = activeProj?.id || projectId;
    const projName = activeProj?.name || (projectId ? 'Projeto' : 'Atual');

    if (resolvedProjId) {
      const pMems = this.projectMemories
        .filter(m => m.projectId === resolvedProjId)
        .slice(0, 15);
      for (const m of pMems) {
        lines.push(`- [Projeto: ${projName} / ${m.category}] ${m.title}: ${m.content.slice(0, 1000)} (origem: ${m.source})`);
      }
    }

    const gMems = this.globalMemories.slice(0, 10);
    for (const m of gMems) {
      lines.push(`- [Global / ${m.category}] ${m.title}: ${m.content.slice(0, 1000)} (origem: ${m.source})`);
    }

    if (sessionId && this.sessionMemories.has(sessionId)) {
      const sMems = (this.sessionMemories.get(sessionId) || []).slice(0, 5);
      for (const m of sMems) {
        lines.push(`- [Sessão / ${m.category}] ${m.title}: ${m.content.slice(0, 800)}`);
      }
    }

    return lines;
  }
}

export const memoryManager = new MemoryManager();
