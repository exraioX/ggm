import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateUnifiedDiff, readFileSafe } from '../src/diff-engine.js';
import { checkpointManager } from '../src/checkpoints.js';
import { monitor } from '../src/monitor.js';

test('diff-engine: gera unified diff correto', () => {
  const orig = 'linha 1\nlinha 2\nlinha 3\n';
  const mod = 'linha 1\nlinha alterada\nlinha 3\n';
  const diff = generateUnifiedDiff(orig, mod, 'teste.txt');

  assert.ok(diff.includes('--- a/teste.txt'));
  assert.ok(diff.includes('+++ b/teste.txt'));
  assert.ok(diff.includes('-linha 2'));
  assert.ok(diff.includes('+linha alterada'));
});

test('diff-engine: retorna string vazia se conteúdos forem iguais', () => {
  const text = 'conteudo idêntico\n';
  const diff = generateUnifiedDiff(text, text, 'igual.txt');
  assert.equal(diff, '');
});

test('diff-engine: readFileSafe rejeita paths fora do workspace', async () => {
  const ws = path.resolve(os.tmpdir(), 'godmode-test-ws');
  fs.mkdirSync(ws, { recursive: true });

  const safe = await readFileSafe('..\\..\\..\\etc\\passwd', ws);
  assert.equal(safe, null);

  const testFile = path.join(ws, 'hello.txt');
  fs.writeFileSync(testFile, 'ola mundo', 'utf8');

  const content = await readFileSafe(testFile, ws);
  assert.equal(content, 'ola mundo');

  fs.rmSync(ws, { recursive: true, force: true });
});

test('checkpoints: cria snapshot e reverte alteração', async () => {
  const tmp = path.resolve(os.tmpdir(), 'godmode-cp-test-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const fileToEdit = path.join(tmp, 'code.ts');
  fs.writeFileSync(fileToEdit, 'const x = 1;', 'utf8');

  const sessionId = 'session-test-123';
  const cpId = await checkpointManager.createCheckpoint(sessionId, [fileToEdit]);
  assert.ok(cpId);

  // Alterar o arquivo
  fs.writeFileSync(fileToEdit, 'const x = 999; // corrompido', 'utf8');

  // Reverter
  const result = await checkpointManager.revert(cpId, sessionId);
  assert.equal(result.reverted.length, 1);
  assert.equal(fs.readFileSync(fileToEdit, 'utf8'), 'const x = 1;');

  // Cleanup
  await checkpointManager.delete(cpId);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('monitor: emite eventos e registra no ring buffer', () => {
  monitor.emit({
    type: 'agent_start',
    agentId: 'test-agent',
    sessionId: 'test-session',
    model: 'ollama/llama3',
    task: 'tarefa teste',
  });

  const events = monitor.getEvents();
  assert.ok(events.length > 0);
  const last = events[events.length - 1];
  assert.equal(last.type, 'agent_start');
  assert.equal(last.agentId, 'test-agent');
});
