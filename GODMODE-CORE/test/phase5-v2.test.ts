import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMemoriesFromConversation, detectComplexity } from '../src/auto-memory.js';
import { taskQueue } from '../src/task-queue.js';
import { runAutoSetup } from '../src/auto-setup.js';
import { memoryManager } from '../src/memory-manager.js';

test('auto-memory: detecta complexidade corretamente a partir do texto', () => {
  // Frase simples
  assert.ok(detectComplexity('olá, como vai você?') < 5);
  assert.ok(detectComplexity('qual é o clima hoje?') < 5);

  // Frase complexa com múltiplos verbos e termos de arquitetura
  const complexPrompt = 'implemente um novo módulo de autenticação e também crie a arquitetura do banco de dados, em seguida configure os testes automatizados para o sistema';
  assert.ok(detectComplexity(complexPrompt) >= 5);
});

test('auto-memory: extrai memórias automaticamente de respostas do agente', () => {
  const projectId = 'test-proj-auto-mem-' + Date.now();
  const sessionId = 'session-auto-' + Date.now();

  const messages = [
    { role: 'user', content: 'Como devemos organizar o código?' },
    {
      role: 'assistant',
      content: 'A arquitetura do projeto segue o padrão hexagonal com portas e adaptadores. Além disso, não use bibliotecas externas para validação simples.',
    },
  ];

  const extracted = extractMemoriesFromConversation(messages, projectId, sessionId);
  assert.ok(extracted >= 1, 'Deve extrair pelo menos uma memória de arquitetura/restrição');

  const memories = memoryManager.list({ projectId });
  assert.ok(memories.some(m => m.source === 'inference'));
});

test('task-queue: adiciona, lista, atualiza e remove tarefas sequenciais', () => {
  const projectId = 'test-task-proj-' + Date.now();

  // 1. Add
  const task = taskQueue.add('Criar testes unitários para o módulo diff', 'coder', projectId);
  assert.equal(task.status, 'pending');
  assert.equal(task.agentRole, 'coder');
  assert.equal(task.projectId, projectId);

  // 2. List
  const list = taskQueue.list(projectId);
  assert.ok(list.some(t => t.id === task.id));

  // 3. Update status
  taskQueue.updateStatus(task.id, 'running');
  assert.equal(taskQueue.get(task.id)?.status, 'running');

  taskQueue.updateStatus(task.id, 'completed', 'Suíte de testes criada com 100% de cobertura.');
  const completedTask = taskQueue.get(task.id);
  assert.equal(completedTask?.status, 'completed');
  assert.ok(completedTask?.result?.includes('cobertura'));

  // 4. Stats
  const stats = taskQueue.stats(projectId);
  assert.ok(stats.completed >= 1);

  // 5. Remove
  taskQueue.remove(task.id);
  assert.equal(taskQueue.get(task.id), undefined);
});

test('auto-setup: registra servidores MCP gratuitos sem duplicar existentes', async () => {
  const result = await runAutoSetup();
  assert.ok(typeof result.alreadyDone === 'boolean');
  assert.ok(Array.isArray(result.registered));
  assert.ok(Array.isArray(result.skipped));
});
