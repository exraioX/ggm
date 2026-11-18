import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src', 'server.ts'), 'utf8');
const multiAgent = fs.readFileSync(path.join(root, 'src', 'multi-agent.ts'), 'utf8');
const providers = fs.readFileSync(path.join(root, 'src', 'providers.ts'), 'utf8');

test('UI: todos os itens da barra de atividades apontam para uma tela existente', () => {
  const views = new Set([...html.matchAll(/id="view-([^"]+)"/g)].map(match => match[1]));
  const navTargets = [...new Set([...html.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]))];
  assert.ok(navTargets.length >= 8);
  for (const target of navTargets) assert.ok(views.has(target), 'Tela ausente para data-view=' + target);
});

test('UI: IDs HTML são únicos e as páginas redundantes foram consolidadas', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
  assert.doesNotMatch(html, /id="view-(monitor|taskqueue)"/);
  assert.match(html, /id="view-agents"/);
  assert.match(html, /id="view-workspace"/);
});

test('UI: missão, fila e QA usam controles ligados ao JavaScript', () => {
  for (const id of ['workflow-form', 'workflow-agent-role', 'queue-workflow-btn', 'task-queue-list', 'run-task-queue', 'test-config-form', 'test-runner-output']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const symbol of ['runMultiAgentWorkflow', 'queueWorkflowTask', 'runTaskQueue', 'runProjectSuite', 'loadTestRunnerConfig']) {
    assert.ok(appJs.includes(symbol), 'Handler ausente: ' + symbol);
  }
  assert.match(server, /async function executeQueuedTask/);
  assert.match(server, /app\.post\('\/api\/tasks\/run'/);
  assert.match(server, /app\.post\('\/api\/agents\/workflow\/run'/);
  assert.match(multiAgent, /executionMode: 'sequential-llm-specialists'/);
});

test('UI: recursos/prompts MCP e saída do terminal possuem leitores conectados', () => {
  assert.match(html, /id="mcp-resources-list"/);
  assert.match(html, /id="mcp-prompts-list"/);
  assert.match(html, /id="mcp-capability-output"/);
  assert.match(appJs, /function renderMcpCapabilities/);
  assert.match(appJs, /inspectMcpResource/);
  assert.match(appJs, /inspectMcpPrompt/);
  assert.match(appJs, /function renderAgentTerminal/);
  assert.match(server, /output: serializedResult\.slice\(0, 6000\)/);
});


test('UI: sidebar reúne projetos e conversas recentes e mantém navegação para Chat', () => {
  for (const id of ['sidebar-search', 'sidebar-project-list', 'conversation-list', 'new-chat-side']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /data-view="chat"/);
  assert.match(html, /data-view="mcp"/);
  assert.match(appJs, /function renderSidebarProjects/);
  assert.match(appJs, /function renderConversationList/);
  assert.match(appJs, /setView\('chat'\);/);
});

test('UI: seletor de modelos aceita busca e texto livre, inclusive modelos Ollama', () => {
  assert.match(html, /id="chat-model"[^>]*list="chat-model-options"/);
  assert.match(html, /id="chat-model-options"/);
  assert.match(html, /id="provider-model-options"/);
  assert.match(appJs, /function loadProviderModelCatalog/);
  assert.match(appJs, /model: modelToUse/);
  assert.match(server, /requestedModel \|\| chosenModel \|\| provider\.model/);
  assert.match(multiAgent, /model: requestedModel \|\| provider\.model/);
  assert.match(providers, /endpoint\.pathname = '\/api\/tags'/);
  assert.match(providers, /const isLoopback = \['localhost', '127\.0\.0\.1', '::1'\]/);
});

test('UI: Plugins segue o fluxo Descobrir, Instalados, Marketplaces e Erros', () => {
  for (const tab of ['discover', 'installed', 'marketplaces', 'errors']) {
    assert.match(html, new RegExp('data-plugin-tab="' + tab + '"'));
  }
  assert.match(html, /id="plugin-entry-list"/);
  assert.match(html, /id="plugin-detail-panel"/);
  assert.match(appJs, /async function loadPluginManager/);
  assert.match(appJs, /function renderPluginManager/);
  assert.match(appJs, /function renderPluginDetail/);
  assert.match(appJs, /data-plugin-install/);
  assert.match(appJs, /data-plugin-connect/);
  assert.match(styles, /\.plugin-manager-layout/);
  assert.match(styles, /\.plugin-tabs/);
});

test('UI: projetos e especialistas são diretórios compactos, não grades de cartões', () => {
  assert.match(html, /id="project-list" class="project-list-rows"/);
  assert.match(html, /id="specialists-grid" class="specialist-list-rows"/);
  assert.match(appJs, /class="project-row/);
  assert.match(appJs, /class="specialist-row"/);
  assert.match(styles, /\.project-row/);
  assert.match(styles, /\.specialist-row/);
});

test('OmniRoute é configurado como gateway OpenAI-compatible e explica sua utilização', () => {
  assert.match(html, /id="setup-omniroute"/);
  assert.match(html, /npm install -g omniroute/);
  assert.match(html, /127\.0\.0\.1:20128\/v1/);
  assert.match(appJs, /function setupOmniRouteProvider/);
  assert.match(appJs, /http:\/\/127\.0\.0\.1:20128\/v1/);
  assert.match(appJs, /\/api\/providers\/.*\/secret/);
});

test('UI: JavaScript é sintaticamente válido e estilos das novas áreas existem', () => {
  assert.doesNotThrow(() => new Script(appJs, { filename: 'ui/app.js' }));
  for (const selector of ['.agent-center-grid', '.queue-stats', '.test-runner-output', '.capability-row', '.execution-grid']) {
    assert.ok(styles.includes(selector), 'Estilo ausente: ' + selector);
  }
});
