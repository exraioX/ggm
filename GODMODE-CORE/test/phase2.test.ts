import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectManager } from '../src/project-manager.js';
import { memoryManager } from '../src/memory-manager.js';

test('projectManager: lista projeto padrão inicial', () => {
  const result = projectManager.list();
  assert.ok(result.projects.length >= 1);
  assert.ok(result.activeId);
  const active = projectManager.getActive();
  assert.ok(active);
  assert.equal(active.id, result.activeId);
});

test('projectManager: cria, atualiza, ativa e exclui projeto', () => {
  const tmpDir = path.resolve(os.tmpdir(), 'godmode-proj-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  // Criar
  const proj = projectManager.create({
    name: 'Projeto Teste Temporário',
    path: tmpDir,
    description: 'Criado pelo teste unitário',
  });
  assert.equal(proj.name, 'Projeto Teste Temporário');
  assert.equal(path.resolve(proj.path), tmpDir);

  // Ativar
  const activated = projectManager.setActive(proj.id);
  assert.equal(activated.id, proj.id);
  assert.equal(projectManager.getActive().id, proj.id);

  // Atualizar
  const updated = projectManager.update(proj.id, { name: 'Nome Atualizado' });
  assert.equal(updated.name, 'Nome Atualizado');

  // Deletar
  projectManager.delete(proj.id);
  assert.equal(projectManager.get(proj.id), undefined);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('projectManager: rejeita pasta inexistente', () => {
  assert.throws(() => {
    projectManager.create({
      name: 'Inexistente',
      path: 'c:\\pasta-que-definitivamente-nao-existe-xyz-12345',
    });
  }, /não existe/);
});

test('memoryManager: suporta memórias em múltiplos níveis (global, projeto, sessão)', () => {
  const pId = 'proj-test-' + Date.now();
  const sId = 'sess-test-' + Date.now();

  const mGlobal = memoryManager.create({
    level: 'global',
    title: 'Preferência Global',
    content: 'Usar TypeScript estrito sempre',
    category: 'Preferência',
    source: 'user',
  });
  assert.equal(mGlobal.level, 'global');

  const mProj = memoryManager.create({
    level: 'project',
    projectId: pId,
    title: 'Arquitetura do Projeto',
    content: 'Usa Express e Node 22',
    category: 'Projeto',
    source: 'agent',
  });
  assert.equal(mProj.level, 'project');
  assert.equal(mProj.projectId, pId);

  const mSess = memoryManager.create({
    level: 'session',
    sessionId: sId,
    title: 'Contexto de Conversa',
    content: 'Usuário pediu refatoração do módulo X',
    category: 'Referência',
    source: 'inference',
  });
  assert.equal(mSess.level, 'session');

  // Filtragem por nível
  const globals = memoryManager.list({ level: 'global' });
  assert.ok(globals.some(m => m.id === mGlobal.id));

  const projs = memoryManager.list({ level: 'project', projectId: pId });
  assert.ok(projs.some(m => m.id === mProj.id));

  // Contexto formatado para o agente
  const context = memoryManager.getRelevantContext(pId, sId);
  assert.ok(context.some(c => c.includes('Arquitetura do Projeto')));
  assert.ok(context.some(c => c.includes('Preferência Global')));
  assert.ok(context.some(c => c.includes('Contexto de Conversa')));

  // Cleanup
  memoryManager.delete(mGlobal.id);
  memoryManager.delete(mProj.id);
  memoryManager.delete(mSess.id);
});
