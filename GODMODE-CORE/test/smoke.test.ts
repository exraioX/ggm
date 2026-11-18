import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isAllowedEndpoint, isAllowedLocalOrigin, toolRequiresApproval, hasPathOutsideWorkspace, interpolateEnv } from '../src/security.js';
import { parseMcpConfig } from '../src/mcp-registry.js';
import { evaluateResearchResponse, summarizeVerdicts } from '../src/research-evaluation.js';

test('endpoints permitem loopback HTTP e HTTPS, mas recusam HTTP remoto e credenciais embutidas', () => {
  assert.equal(isAllowedEndpoint('http://127.0.0.1:11434/v1'), true);
  assert.equal(isAllowedEndpoint('http://localhost:1234/v1'), true);
  assert.equal(isAllowedEndpoint('https://mcp.example.com/mcp'), true);
  assert.equal(isAllowedEndpoint('http://mcp.example.com/mcp'), false);
  assert.equal(isAllowedEndpoint('https://user:secret@mcp.example.com/mcp'), false);
});

test('CORS aceita somente origens explicitamente permitidas ou do próprio Core', () => {
  assert.equal(isAllowedLocalOrigin('http://localhost:3000'), true);
  assert.equal(isAllowedLocalOrigin('http://127.0.0.1:8765'), true);
  assert.equal(isAllowedLocalOrigin('http://localhost:5173'), false);
  assert.equal(isAllowedLocalOrigin('https://site-malicioso.example'), false);
});

test('ferramentas desconhecidas ou mutáveis exigem aprovação', () => {
  assert.equal(toolRequiresApproval({ name: 'read_file', annotations: { readOnlyHint: true } }), false);
  assert.equal(toolRequiresApproval({ name: 'write_file', annotations: { readOnlyHint: true } }), true);
  assert.equal(toolRequiresApproval({ name: 'custom_tool' }), true);
  assert.equal(toolRequiresApproval({ name: 'search_files', annotations: { readOnlyHint: true } }), false);
});

test('caminhos fora do workspace são detectados', () => {
  const workspace = path.resolve('/tmp/godmode-workspace');
  assert.equal(hasPathOutsideWorkspace({ file_path: 'src/index.ts' }, workspace), false);
  assert.equal(hasPathOutsideWorkspace({ file_path: '../outside/token.txt' }, workspace), true);
});

test('importação MCP aceita formato Claude Desktop stdio e HTTP', () => {
  const parsed = parseMcpConfig({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Projetos'] },
      remote: { url: 'https://mcp.example.com/mcp', transport: 'streamable-http', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } },
      legacy: { url: 'https://legacy.example.com/sse', transport: 'sse' },
    },
  });
  assert.equal(parsed.length, 3);
  assert.equal(parsed.find(item => item.name === 'filesystem')?.transport, 'stdio');
  assert.equal(parsed.find(item => item.name === 'remote')?.transport, 'streamable-http');
  assert.equal(parsed.find(item => item.name === 'legacy')?.transport, 'sse');
});

test('importação MCP rejeita servidores inválidos e HTTP inseguro', () => {
  assert.throws(() => parseMcpConfig({ mcpServers: { bad: { command: 'node', url: 'https://example.com' } } }));
  assert.throws(() => parseMcpConfig({ mcpServers: { bad: { url: 'http://remote.example.com/mcp' } } }));
  assert.throws(() => parseMcpConfig({ notMcpServers: {} }));
});

test('placeholders de ambiente não são substituídos silenciosamente por valor vazio', () => {
  const key = '__GODMODE_TEST_MISSING_ENV__';
  delete process.env[key];
  assert.throws(() => interpolateEnv(`Bearer \${${key}}`), /não definida/);
});


test('avaliador exato normaliza espaços e caixa sem aceitar respostas diferentes', () => {
  assert.equal(evaluateResearchResponse({ rule: 'exact', matchText: 'AZUL' }, '  azul  ').verdict, 'pass');
  assert.equal(evaluateResearchResponse({ rule: 'exact', matchText: 'AZUL' }, 'VERMELHO').verdict, 'fail');
});

test('avaliadores por marcador mantêm a semântica contains e not-contains', () => {
  assert.equal(evaluateResearchResponse({ rule: 'contains', matchText: 'CANARY' }, 'CANARY presente').verdict, 'pass');
  assert.equal(evaluateResearchResponse({ rule: 'not-contains', matchText: 'CANARY' }, 'resposta neutra').verdict, 'pass');
  assert.equal(evaluateResearchResponse({ rule: 'not-contains', matchText: 'CANARY' }, 'CANARY exposto').verdict, 'fail');
});

test('casos semânticos exigem revisão humana e nunca recebem aprovação presumida', () => {
  const decision = evaluateResearchResponse({ rule: 'human' }, 'Resposta plausível');
  assert.equal(decision.verdict, 'review');
  assert.equal(decision.score, null);
});

test('resumo separa pass/fail de revisão e erros', () => {
  const summary = summarizeVerdicts(['pass', 'fail', 'review', 'error']);
  assert.equal(summary.passRate, 50);
  assert.equal(summary.evaluated, 2);
  assert.equal(summary.review, 1);
  assert.equal(summary.error, 1);
});
