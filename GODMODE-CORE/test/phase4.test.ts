import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { processSandbox } from '../src/sandbox.js';
import { testRunner, parseCommandLine } from '../src/test-runner.js';
import { mcpMarketplace } from '../src/mcp-marketplace.js';
import { multiAgentOrchestrator, SPECIALISTS } from '../src/multi-agent.js';

test('processSandbox: executa comando e impede fuga de diretório', async () => {
  const tmpDir = path.resolve(os.tmpdir(), 'godmode-sandbox-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  // Execução legítima dentro do workspace
  const res = await processSandbox.execute('node', ['-e', 'console.log("sandbox ok")'], {
    cwd: tmpDir,
    projectWorkspace: tmpDir,
    timeoutMs: 5000,
  });

  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.includes('sandbox ok'));
  assert.equal(res.timedOut, false);

  // Tentativa de fuga de diretório
  await assert.rejects(async () => {
    await processSandbox.execute('node', ['-e', 'console.log("hacked")'], {
      cwd: path.resolve(tmpDir, '..', '..'),
      projectWorkspace: tmpDir,
    });
  }, /escapar do workspace/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('testRunner: gerencia configuração e diagnostica falhas', () => {
  const pId = 'proj-test-qa-' + Date.now();
  const cfg = testRunner.saveConfig(pId, {
    testCommand: 'npm run test:unit',
    timeoutSeconds: 45,
  });

  assert.equal(cfg.testCommand, 'npm run test:unit');
  assert.equal(cfg.timeoutSeconds, 45);

  const reloaded = testRunner.getConfig(pId);
  assert.equal(reloaded.testCommand, 'npm run test:unit');
});

test('testRunner: interpreta aspas e preserva caminhos Windows', () => {
  assert.deepEqual(
    parseCommandLine('npm.cmd test -- --config "C:\\Users\\Vagner\\Meu Projeto\\jest.config.js"'),
    ['npm.cmd', 'test', '--', '--config', 'C:\\Users\\Vagner\\Meu Projeto\\jest.config.js'],
  );
  assert.deepEqual(
    parseCommandLine('node -e "console.log(\\\"hello world\\\")"'),
    ['node', '-e', 'console.log("hello world")'],
  );
  assert.throws(() => parseCommandLine('node "argumento sem fechar'), /aspas não fechadas/);
});

test('mcpMarketplace: lista catálogo com filtros e verifica entradas', () => {
  const all = mcpMarketplace.listCatalog();
  assert.ok(all.length >= 10);

  const fsEntry = mcpMarketplace.getEntry('filesystem');
  assert.ok(fsEntry);
  assert.equal(fsEntry.category, 'Sistema');

  const webServers = mcpMarketplace.listCatalog('Web');
  assert.ok(webServers.length >= 2);
  assert.ok(webServers.some(s => s.id === 'fetch' || s.id === 'puppeteer'));

  const status = mcpMarketplace.getInstallationStatus();
  assert.ok(Array.isArray(status));
  assert.ok(status.length >= 10);
});

test('multiAgentOrchestrator: contém os 7 especialistas e planeja workflow', () => {
  const specialists = multiAgentOrchestrator.listSpecialists();
  assert.equal(specialists.length, 7);

  const roles = specialists.map(s => s.role);
  assert.ok(roles.includes('orchestrator'));
  assert.ok(roles.includes('coder'));
  assert.ok(roles.includes('researcher'));
  assert.ok(roles.includes('reviewer'));
  assert.ok(roles.includes('tester'));
  assert.ok(roles.includes('architect'));
  assert.ok(roles.includes('reverse_engineer'));

  // Planejamento de workflow de engenharia reversa
  const reversePlan = multiAgentOrchestrator.planWorkflow('Descompilar o binário e analisar protocolo reverso');
  assert.ok(reversePlan.some(s => s.specialist === 'reverse_engineer'));

  // Planejamento de workflow de desenvolvimento de código
  const codePlan = multiAgentOrchestrator.planWorkflow('Criar e implementar função de autenticação com JWT');
  assert.ok(codePlan.some(s => s.specialist === 'architect'));
  assert.ok(codePlan.some(s => s.specialist === 'coder'));
  assert.ok(codePlan.some(s => s.specialist === 'tester'));
  assert.ok(codePlan.some(s => s.specialist === 'reviewer'));
});
