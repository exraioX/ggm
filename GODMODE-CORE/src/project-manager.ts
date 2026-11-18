// project-manager.ts — Gerenciador de múltiplos projetos e repositórios locais
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { GODMODE_HOME, WORKSPACE, readJson, safeWriteJson } from './config.js';

export interface ProjectItem {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  isActive?: boolean;
}

interface ProjectsData {
  activeId: string;
  projects: ProjectItem[];
}

const PROJECTS_CONFIG_PATH = path.join(GODMODE_HOME, 'projects.json');

export class ProjectManager {
  private projects: ProjectItem[] = [];
  private activeId: string = '';

  constructor() {
    this.load();
  }

  private load(): void {
    const data = readJson<ProjectsData>(PROJECTS_CONFIG_PATH, { activeId: '', projects: [] });
    this.projects = Array.isArray(data.projects) ? data.projects : [];
    this.activeId = typeof data.activeId === 'string' ? data.activeId : '';

    // Se nenhum projeto estiver cadastrado, inicializa com o WORKSPACE padrão atual
    if (this.projects.length === 0) {
      const defaultProject: ProjectItem = {
        id: 'default',
        name: path.basename(WORKSPACE) || 'Projeto Principal',
        path: WORKSPACE,
        description: 'Espaço de trabalho padrão inicial',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        isActive: true,
      };
      this.projects.push(defaultProject);
      this.activeId = defaultProject.id;
      this.save();
    } else {
      // Garantir que activeId seja válido
      if (!this.projects.some(p => p.id === this.activeId)) {
        this.activeId = this.projects[0].id;
      }
      for (const p of this.projects) {
        p.isActive = p.id === this.activeId;
      }
    }
  }

  private save(): void {
    for (const p of this.projects) {
      p.isActive = p.id === this.activeId;
    }
    safeWriteJson(PROJECTS_CONFIG_PATH, {
      activeId: this.activeId,
      projects: this.projects,
    });
  }

  list(): { activeId: string; projects: ProjectItem[] } {
    this.load();
    return {
      activeId: this.activeId,
      projects: this.projects.map(p => ({ ...p, isActive: p.id === this.activeId })),
    };
  }

  get(id: string): ProjectItem | undefined {
    this.load();
    const p = this.projects.find(item => item.id === id);
    if (!p) return undefined;
    return { ...p, isActive: p.id === this.activeId };
  }

  getActive(): ProjectItem {
    this.load();
    const active = this.projects.find(p => p.id === this.activeId);
    if (active) return { ...active, isActive: true };
    return { ...this.projects[0], isActive: true };
  }

  getActiveWorkspace(): string {
    return this.getActive().path;
  }

  create(input: { name: string; path: string; description?: string }): ProjectItem {
    this.load();
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const rawPath = typeof input.path === 'string' ? input.path.trim() : '';
    if (!name) throw new Error('Nome do projeto é obrigatório.');
    if (!rawPath) throw new Error('Caminho da pasta do projeto é obrigatório.');

    const resolvedPath = path.resolve(rawPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`A pasta informada não existe: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`O caminho informado não é uma pasta: ${resolvedPath}`);
    }

    // Verificar se já existe projeto com o mesmo caminho
    const existing = this.projects.find(p => path.resolve(p.path).toLowerCase() === resolvedPath.toLowerCase());
    if (existing) {
      throw new Error(`Já existe um projeto cadastrado nesta pasta: ${existing.name}`);
    }

    const now = new Date().toISOString();
    const project: ProjectItem = {
      id: randomUUID(),
      name,
      path: resolvedPath,
      description: typeof input.description === 'string' ? input.description.slice(0, 500) : '',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      isActive: false,
    };

    this.projects.push(project);
    this.save();
    return project;
  }

  update(id: string, input: Partial<Pick<ProjectItem, 'name' | 'path' | 'description'>>): ProjectItem {
    this.load();
    const project = this.projects.find(p => p.id === id);
    if (!project) throw new Error(`Projeto ${id} não encontrado.`);

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error('Nome do projeto não pode ser vazio.');
      project.name = name;
    }
    if (input.description !== undefined) {
      project.description = input.description.slice(0, 500);
    }
    if (input.path !== undefined) {
      const rawPath = input.path.trim();
      const resolved = path.resolve(rawPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw new Error(`Pasta inválida ou inexistente: ${resolved}`);
      }
      project.path = resolved;
    }

    project.updatedAt = new Date().toISOString();
    this.save();
    return { ...project, isActive: project.id === this.activeId };
  }

  setActive(id: string): ProjectItem {
    this.load();
    const project = this.projects.find(p => p.id === id);
    if (!project) throw new Error(`Projeto ${id} não encontrado.`);

    this.activeId = project.id;
    project.lastUsedAt = new Date().toISOString();
    this.save();
    return { ...project, isActive: true };
  }

  delete(id: string): void {
    this.load();
    if (this.projects.length <= 1) {
      throw new Error('Não é possível excluir o único projeto restante.');
    }
    const idx = this.projects.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Projeto ${id} não encontrado.`);

    this.projects.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.projects[0].id;
    }
    this.save();
  }
}

export const projectManager = new ProjectManager();
