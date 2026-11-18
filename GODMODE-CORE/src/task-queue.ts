// task-queue.ts — Fila autônoma de tarefas sequenciais do LUPID
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { GODMODE_HOME, readJson, safeWriteJson } from './config.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentTask {
  id: string;
  instruction: string;
  agentRole: string;
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
  projectId?: string;
}

const TASK_QUEUE_PATH = path.join(GODMODE_HOME, 'task-queue.json');

export class TaskQueue {
  private tasks: AgentTask[] = [];

  constructor() {
    this.tasks = readJson<AgentTask[]>(TASK_QUEUE_PATH, [])
      .map(t => ({ ...t, status: t.status === 'running' ? 'pending' : t.status }));
    this.persist();
  }

  add(instruction: string, agentRole = 'auto', projectId?: string): AgentTask {
    const task: AgentTask = {
      id: randomUUID(),
      instruction: instruction.slice(0, 2000),
      agentRole,
      status: 'pending',
      createdAt: new Date().toISOString(),
      projectId,
    };
    this.tasks.push(task);
    this.persist();
    return task;
  }

  list(projectId?: string): AgentTask[] {
    if (projectId) return this.tasks.filter(t => !t.projectId || t.projectId === projectId);
    return this.tasks.slice();
  }

  get(id: string): AgentTask | undefined {
    return this.tasks.find(t => t.id === id);
  }

  updateStatus(id: string, status: TaskStatus, result?: string, error?: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    task.status = status;
    if (status === 'running') task.startedAt = new Date().toISOString();
    if (status === 'completed' || status === 'failed') {
      task.completedAt = new Date().toISOString();
      if (result) task.result = result.slice(0, 5000);
      if (error) task.error = error.slice(0, 1000);
    }
    this.persist();
  }

  remove(id: string): void {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.persist();
  }

  clear(projectId?: string): void {
    if (projectId) {
      this.tasks = this.tasks.filter(t => t.projectId && t.projectId !== projectId);
    } else {
      this.tasks = [];
    }
    this.persist();
  }

  stats(projectId?: string) {
    const current = this.list(projectId);
    return {
      total: current.length,
      pending: current.filter(t => t.status === 'pending').length,
      running: current.filter(t => t.status === 'running').length,
      completed: current.filter(t => t.status === 'completed').length,
      failed: current.filter(t => t.status === 'failed').length,
    };
  }

  private persist(): void {
    safeWriteJson(TASK_QUEUE_PATH, this.tasks.slice(-200));
  }
}

export const taskQueue = new TaskQueue();
