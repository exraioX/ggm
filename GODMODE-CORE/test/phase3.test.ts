import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { modelRouter } from '../src/model-router.js';
import { projectIndexer } from '../src/project-indexer.js';

test('modelRouter: detecta tipo de tarefa a partir da mensagem', () => {
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Escreva uma função em typescript para calcular fibonacci' }]), 'code');
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Execute os testes unitários do smoke test' }]), 'test');
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Revise o diff de alterações procurando vulnerabilidade' }]), 'review');
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Pesquise onde fica o arquivo de configuração' }]), 'research');
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Resuma o conteúdo deste artigo' }]), 'summary');
  assert.equal(modelRouter.detectTaskType([{ role: 'user', content: 'Olá, como você está?' }]), 'chat');
});

test('modelRouter: seleciona provedor com cadeia de fallback', () => {
  const decision = modelRouter.select([{ role: 'user', content: 'Crie uma classe UserService' }]);
  assert.ok(decision);
  assert.equal(decision.taskType, 'code');
  assert.ok(decision.provider);
  assert.ok(decision.model);
  assert.ok(Array.isArray(decision.fallbackChain));
});

test('projectIndexer: indexa diretório, extrai símbolos e gera resumo', async () => {
  const tmpDir = path.resolve(os.tmpdir(), 'godmode-index-test-' + Date.now());
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

  const codeFile = path.join(tmpDir, 'src', 'calc.ts');
  fs.writeFileSync(codeFile, `
import { helper } from './helper.js';

export interface CalcOptions {
  precision: number;
}

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}

export function multiply(x: number, y: number): number {
  return x * y;
}
  `, 'utf8');

  const pId = 'test-proj-index';
  const index = await projectIndexer.buildIndex(pId, tmpDir, true);

  assert.equal(index.totalFiles, 1);
  assert.ok(index.totalSymbols >= 3); // CalcOptions, Calculator, multiply

  // Busca de símbolos
  const results = projectIndexer.searchSymbols(pId, 'Calculator');
  assert.ok(results.length >= 1);
  assert.equal(results[0].name, 'Calculator');
  assert.equal(results[0].kind, 'class');

  const fnResults = projectIndexer.searchSymbols(pId, 'multiply');
  assert.ok(fnResults.length >= 1);
  assert.equal(fnResults[0].kind, 'function');

  // Resumo
  const summary = projectIndexer.getSummary(pId);
  assert.ok(summary.includes('Calculator'));
  assert.ok(summary.includes('calc.ts'));

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
