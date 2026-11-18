'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORE_KEY = 'godmode-core-conversations-v1';
const VIEW_TITLES = {
  chat: 'Chat do Agente',
  files: 'Arquivos & Editor',
  agents: 'Orquestrador de Missões',
  projects: 'Gerenciador de Projetos',
  mcp: 'Integrações & MCP',
  memory: 'Memória Multi-Nível',
  providers: 'Provedores de IA',
  settings: 'Sistema & API',
  workspace: 'Painel de Execução'
};

let taskQueueItems = [];
let projects = [];
let activeProjectId = '';
let currentMemoryFilter = 'all';
let providers = [];
let servers = [];
let tools = [];
let resources = [];
let prompts = [];
let memories = [];
let specialists = [];
let claudePlugins = [];
let mcpCatalog = [];
let pluginStatusMap = new Map();
let pluginTab = 'discover';
let pluginSearchText = '';
let selectedPluginKey = '';
let pluginLoadError = '';
let activeProviderId = '';
let activeModelId = '';
let providerModelCatalogs = new Map();
let sidebarSearchText = '';
let editingProviderId = null;
let pendingApproval = null;
let pendingApprovalConversationId = '';
let isSending = false;
let monitorSSE = null;
let monitorEvents = [];
let monitorConnected = false;
let conversations = loadConversations();
let activeConversationId = localStorage.getItem('godmode-core-active-chat') || '';
let pendingAttachments = [];
let currentOpenFile = null;
let currentFileContent = '';
let openEditorTabs = [];
let commandPaletteSelection = 0;

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SOURCE_BYTES = 12 * 1024 * 1024;
const ATTACHMENT_MAX_DIMENSION = 1280;
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && item.id && Array.isArray(item.messages)) : [];
  } catch { return []; }
}

function saveConversations() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(conversations.slice(0, 100)));
    localStorage.setItem('godmode-core-active-chat', activeConversationId);
  } catch {
    toast('O histórico ficou grande demais para o armazenamento do navegador. Considere excluir conversas antigas.', true);
  }
}

function activeConversation() { return conversations.find(item => item.id === activeConversationId) || null; }

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `Falha HTTP ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setView(view) {
  // Aliases mantidos para links antigos; fila e monitor agora vivem nos seus centros integrados.
  if (view === 'taskqueue') view = 'agents';
  if (view === 'monitor') view = 'workspace';

  $$('.nav-item, .sidebar-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  $('#page-title').textContent = VIEW_TITLES[view] || 'LUPID';
  $('#breadcrumb').textContent = `LUPID / ${(VIEW_TITLES[view] || view).toUpperCase()}`;

  if (view === 'files') loadFileTree();
  if (view === 'agents') {
    loadSpecialists();
    loadTaskQueue();
    loadTestRunnerConfig();
  }
  if (view === 'projects') renderProjects();
  if (view === 'providers') renderProviders();
  if (view === 'mcp') { void loadPluginManager(); }
  if (view === 'memory') renderMemories();
  if (view === 'settings') refreshSystem();
  if (view === 'workspace') {
    initWorkspace();
    initMonitorIfNeeded();
  }
}

const WORKBENCH_COMMANDS = [
  { id:'chat', label:'Abrir Chat do Agente', detail:'Ctrl+1', icon:'◈', run:() => setView('chat') },
  { id:'files', label:'Abrir Explorer e Editor', detail:'Ctrl+2', icon:'▤', run:() => setView('files') },
  { id:'agents', label:'Abrir Multiagentes', detail:'Especialistas e workflows', icon:'⌘', run:() => setView('agents') },
  { id:'projects', label:'Gerenciar Projetos', detail:'Workspaces locais', icon:'▰', run:() => setView('projects') },
  { id:'mcp', label:'Abrir Extensões e MCP', detail:'Servidores e ferramentas', icon:'◇', run:() => setView('mcp') },
  { id:'memory', label:'Abrir Memória', detail:'Contexto persistente', icon:'▥', run:() => setView('memory') },
  { id:'workspace', label:'Abrir Terminal do Agente', detail:'Saída e permissões', icon:'>_', run:() => setView('workspace') },
  { id:'providers', label:'Configurar Provedores de IA', detail:'Ollama, LM Studio, llama.cpp…', icon:'◉', run:() => setView('providers') },
  { id:'settings', label:'Abrir Sistema e API', detail:'Diagnóstico local', icon:'⚙', run:() => setView('settings') },
  { id:'new-chat', label:'Nova conversa', detail:'Criar um chat', icon:'＋', run:() => createConversation() },
  { id:'save-file', label:'Salvar arquivo atual', detail:'Ctrl+S', icon:'▣', run:() => saveCurrentFile() },
  { id:'refresh-tree', label:'Atualizar árvore de arquivos', detail:'Explorer', icon:'↻', run:() => { setView('files'); void loadFileTree(); } }
];

function renderCommandPalette() {
  const input = $('#command-palette-input');
  const results = $('#command-palette-results');
  if (!input || !results) return;
  const query = input.value.trim().toLowerCase();
  const filtered = WORKBENCH_COMMANDS.filter(command => (command.label + ' ' + command.detail).toLowerCase().includes(query));
  commandPaletteSelection = Math.min(commandPaletteSelection, Math.max(0, filtered.length - 1));
  results.innerHTML = filtered.length ? filtered.map((command, index) =>
    '<button type="button" class="command-result' + (index === commandPaletteSelection ? ' active' : '') + '" data-command-id="' + command.id + '">' +
    '<span class="command-result-icon">' + command.icon + '</span><span class="command-result-label">' + command.label + '</span><span class="command-result-detail">' + command.detail + '</span></button>'
  ).join('') : '<div class="empty-inline">Nenhum comando encontrado.</div>';
}

function openCommandPalette() {
  const palette = $('#command-palette');
  const input = $('#command-palette-input');
  if (!palette || !input) return;
  palette.hidden = false;
  input.value = '';
  commandPaletteSelection = 0;
  renderCommandPalette();
  input.focus();
}

function closeCommandPalette() {
  const palette = $('#command-palette');
  if (palette) palette.hidden = true;
  $('#command-center-button')?.blur();
}

function executeWorkbenchCommand(id) {
  const command = WORKBENCH_COMMANDS.find(item => item.id === id);
  if (!command) return;
  closeCommandPalette();
  command.run();
}

function createConversation() {
  const conversation = {
    id: crypto.randomUUID(),
    title: 'Nova conversa',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  conversations.unshift(conversation);
  activeConversationId = conversation.id;
  pendingAttachments = [];
  renderAttachments();
  saveConversations();
  renderConversationList();
  renderChat();
  setView('chat');
  $('#chat-input').focus();
}

function deleteConversation(id) {
  if (pendingApproval && pendingApprovalConversationId === id) {
    const approval = pendingApproval;
    pendingApproval = null;
    pendingApprovalConversationId = '';
    void api(`/api/approvals/${encodeURIComponent(approval.approvalId)}`, { method: 'POST', body: JSON.stringify({ approved: false }) }).catch(() => undefined);
  }
  conversations = conversations.filter(item => item.id !== id);
  if (activeConversationId === id) activeConversationId = conversations[0]?.id || '';
  saveConversations();
  if (!activeConversationId) createConversation(); else { renderConversationList(); renderChat(); }
}

function renderConversationList() {
  const host = $('#conversation-list');
  if (!host) return;
  const query = sidebarSearchText.trim().toLowerCase();
  const visible = conversations.slice().sort((a, b) =>
    new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
  ).filter(item => !query || (item.title || '').toLowerCase().includes(query));

  host.innerHTML = visible.map(item => `
    <div class="conversation-item ${item.id === activeConversationId ? 'active' : ''}" data-conversation="${escapeHtml(item.id)}">
      <span class="conversation-item-icon">◈</span><span class="conv-name">${escapeHtml(item.title || 'Nova conversa')}</span>
      <button class="delete-conv" data-delete-conversation="${escapeHtml(item.id)}" title="Excluir conversa" aria-label="Excluir conversa">×</button>
    </div>`).join('') || '<div class="sidebar-empty">\nNenhuma conversa encontrada.</div>';

  $$('.conversation-item', host).forEach(node => node.addEventListener('click', event => {
    if (event.target.closest('[data-delete-conversation]')) return;
    activeConversationId = node.dataset.conversation;
    pendingAttachments = [];
    renderAttachments();
    saveConversations();
    renderConversationList();
    renderChat();
    setView('chat');
  }));

  $$('[data-delete-conversation]', host).forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (confirm('Excluir esta conversa deste navegador?')) deleteConversation(button.dataset.deleteConversation);
  }));
}

function renderSidebarProjects() {
  const host = $('#sidebar-project-list');
  if (!host) return;
  const query = sidebarSearchText.trim().toLowerCase();
  const visible = projects.filter(project => !query ||
    project.name.toLowerCase().includes(query) ||
    (project.path || '').toLowerCase().includes(query)
  );
  host.innerHTML = visible.map(project => `
    <button type="button" class="sidebar-project-row ${project.id === activeProjectId ? 'active' : ''}" data-sidebar-project="${escapeHtml(project.id)}" title="${escapeHtml(project.path)}">
      <span class="sidebar-project-icon">${project.id === activeProjectId ? '◉' : '▰'}</span>
      <span>${escapeHtml(project.name)}</span>
      ${project.id === activeProjectId ? '<i></i>' : ''}
    </button>`).join('') || '<div class="sidebar-empty">Nenhum projeto encontrado.</div>';

  $$('[data-sidebar-project]', host).forEach(button => button.addEventListener('click', () => {
    void selectProject(button.dataset.sidebarProject);
  }));
}
function formatMarkdown(raw) {
  if (!raw) return '';
  const codeBlocks = [];
  let text = String(raw).replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || '', code });
    return `___CODE_BLOCK_${idx}___`;
  });

  text = escapeHtml(text);
  text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/^### (.*$)/gim, '<h4 style="color:var(--accent);margin:8px 0 4px 0;">$1</h4>');
  text = text.replace(/^## (.*$)/gim, '<h3 style="color:var(--accent);margin:10px 0 4px 0;">$1</h3>');
  text = text.replace(/^# (.*$)/gim, '<h2 style="color:var(--accent);margin:12px 0 6px 0;">$1</h2>');
  text = text.replace(/^> (.*$)/gim, '<blockquote class="chat-quote">$1</blockquote>');
  text = text.replace(/^- (.*$)/gim, '<li style="margin-left:16px;">$1</li>');
  text = text.replace(/\n/g, '<br>');

  text = text.replace(/___CODE_BLOCK_(\d+)___/g, (_m, idxStr) => {
    const block = codeBlocks[Number(idxStr)];
    if (!block) return '';
    return `<div class="chat-code-block">
      <div class="code-block-header">
        <span>${escapeHtml(block.lang || 'código')}</span>
        <button class="copy-code-btn" type="button" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText);toast('Código copiado!')">Copiar</button>
      </div>
      <pre><code>${escapeHtml(block.code.trim())}</code></pre>
    </div>`;
  });

  return text;
}

function getSendButton() {
  return $('#chat-submit') || $('#send-button');
}

function setSendState(value) {
  const btn = getSendButton();
  if (!btn) return;
  const blocked = value || Boolean(pendingApproval);
  btn.disabled = blocked;
  btn.textContent = value ? 'Aguarde…' : pendingApproval ? 'Aprovação' : 'Enviar';
}

function renderChat() {
  const conversation = activeConversation();
  $('#active-chat-title').textContent = conversation?.title || 'Nova conversa';
  const messages = conversation?.messages || [];
  $('#chat-empty').classList.toggle('hidden', messages.length > 0);

  $('#chat-messages').innerHTML = messages.map(message => `
    <article class="message ${message.role === 'user' ? 'user' : 'assistant'}">
      <div class="message-avatar">${message.role === 'user' ? 'EU' : '▲'}</div>
      <div class="message-body">
        <div class="message-meta">${message.role === 'user' ? 'VOCÊ' : 'LUPID'}</div>
        <div class="message-text">${message.role === 'user' ? escapeHtml(message.content).replace(/\n/g, '<br>') : formatMarkdown(message.content)}</div>
        ${Array.isArray(message.attachments) && message.attachments.length ? `<div class="message-attachments">${message.attachments.map(attachment => `<img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name || 'imagem anexada')}">`).join('')}</div>` : ''}
      </div>
    </article>`).join('');

  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  const approvalBelongsHere = Boolean(pendingApproval && pendingApprovalConversationId === activeConversationId);
  $('#approval-panel').hidden = !approvalBelongsHere;
  const sendBtn = getSendButton();
  if (sendBtn) sendBtn.disabled = isSending || Boolean(pendingApproval);
  if (approvalBelongsHere) renderApproval(pendingApproval);
}

function updateProviderSelect() {
  const select = $('#chat-provider');
  const usable = providers.filter(item => item.enabled !== false);
  if (!select) return;
  if (!usable.length) {
    select.innerHTML = '<option value="">Nenhum provedor cadastrado</option>';
    activeProviderId = '';
    activeModelId = '';
    if ($('#chat-model')) $('#chat-model').value = '';
    return;
  }
  if (!usable.some(item => item.id === activeProviderId)) activeProviderId = usable[0].id;
  select.innerHTML = usable.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  select.value = activeProviderId;
  const provider = usable.find(item => item.id === activeProviderId);
  const savedModel = localStorage.getItem('godmode-model:' + activeProviderId);
  activeModelId = savedModel || provider?.model || '';
  if ($('#chat-model')) $('#chat-model').value = activeModelId;
  void loadProviderModelCatalog(activeProviderId);
}

async function loadProviderModelCatalog(id, force = false) {
  if (!id) return [];
  if (!force && providerModelCatalogs.has(id)) {
    renderProviderModelOptions(id);
    return providerModelCatalogs.get(id);
  }
  try {
    const response = await api('/api/providers/' + encodeURIComponent(id) + '/models');
    const models = Array.isArray(response.models) ? response.models : [];
    providerModelCatalogs.set(id, models);
    renderProviderModelOptions(id);
    return models;
  } catch (error) {
    if (force) toast('Não foi possível listar os modelos deste provedor: ' + error.message, true);
    providerModelCatalogs.set(id, []);
    renderProviderModelOptions(id);
    return [];
  }
}

function renderProviderModelOptions(id) {
  const models = providerModelCatalogs.get(id) || [];
  const options = models.map(model => '<option value="' + escapeHtml(model) + '"></option>').join('');
  const chatOptions = $('#chat-model-options');
  const providerOptions = $('#provider-model-options');
  if (chatOptions) chatOptions.innerHTML = options;
  if (providerOptions) providerOptions.innerHTML = options;
}

function setActiveChatModel(value) {
  activeModelId = String(value || '').trim().slice(0, 200);
  if (activeProviderId) {
    try { localStorage.setItem('godmode-model:' + activeProviderId, activeModelId); } catch {}
  }
}
async function loadProviders() {
  const result = await api('/api/providers');
  providers = result.providers || [];
  renderProviders();
}

async function refreshHealth() {
  try {
    const result = await api('/api/health');
    $('#gateway-indicator')?.classList.add('online');
    const statusEl = $('#gateway-status');
    if (statusEl) statusEl.textContent = `Ativo · porta ${result.port}`;
  } catch {
    $('#gateway-indicator')?.classList.remove('online');
    const statusEl = $('#gateway-status');
    if (statusEl) statusEl.textContent = 'Sem conexão';
  }
}

function renderProviders() {
  const host = $('#provider-list');
  if (!host) return;
  host.innerHTML = providers.map(item => `
    <div class="provider-row" data-provider-row="${escapeHtml(item.id)}">
      <div class="provider-row-main">
        <span class="provider-mark">${item.id === 'omniroute' ? '◎' : item.id.includes('ollama') ? '◉' : '◇'}</span>
        <div class="provider-row-copy">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.baseUrl)}</small>
          <span>${escapeHtml(item.model || 'Modelo ainda não escolhido')}</span>
        </div>
      </div>
      <div class="provider-row-state"><span class="status-pill ${item.model ? 'status-connected' : 'off'}">${item.model ? 'Configurado' : 'Sem modelo'}</span><small>${item.hasSecret ? 'Chave salva nesta sessão' : 'Sem chave / não configurada'}</small></div>
      <div class="provider-row-actions">
        <button class="button secondary small" data-edit-provider="${escapeHtml(item.id)}">Configurar</button>
        <button class="button secondary small" data-discover-provider="${escapeHtml(item.id)}">Modelos</button>
        <button class="button subtle-danger small" data-delete-provider="${escapeHtml(item.id)}" title="Excluir provedor">×</button>
      </div>
    </div>`).join('') || '<div class="empty-inline">Nenhum provedor cadastrado.</div>';

  $$('[data-edit-provider]', host).forEach(button => button.addEventListener('click', () => editProvider(button.dataset.editProvider)));
  $$('[data-discover-provider]', host).forEach(button => button.addEventListener('click', () => discoverProvider(button.dataset.discoverProvider)));
  $$('[data-delete-provider]', host).forEach(button => button.addEventListener('click', () => removeProvider(button.dataset.deleteProvider)));
  updateProviderSelect();
}

function openProviderForm(provider = null) {
  editingProviderId = provider?.id || null;
  $('#provider-form-title').textContent = provider ? `Editar ${provider.name}` : 'Cadastrar provedor';
  $('#provider-id').value = provider?.id || '';
  $('#provider-id').disabled = Boolean(provider);
  $('#provider-name').value = provider?.name || '';
  $('#provider-url').value = provider?.baseUrl || 'http://127.0.0.1:11434/v1';
  $('#provider-model').value = provider?.model || '';
  if ($('#provider-secret')) $('#provider-secret').value = '';
  $('#provider-form-wrap').hidden = false;
  renderProviderModelOptions(provider?.id || activeProviderId);
  $('#provider-name').focus();
}

function setupOmniRouteProvider() {
  const existing = providers.find(item => item.id === 'omniroute');
  openProviderForm(existing || null);
  if (!existing) {
    $('#provider-id').value = 'omniroute';
    $('#provider-name').value = 'OmniRoute';
    $('#provider-url').value = 'http://127.0.0.1:20128/v1';
    $('#provider-model').value = 'auto';
  }
  toast('Informe sua chave do OmniRoute. O serviço precisa estar iniciado em 127.0.0.1:20128.');
}

function editProvider(id) {
  const provider = providers.find(item => item.id === id);
  if (provider) openProviderForm(provider);
}

async function removeProvider(id) {
  if (!confirm(`Excluir o provedor "${id}"?`)) return;
  try {
    const result = await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    providers = result.providers;
    providerModelCatalogs.delete(id);
    if (activeProviderId === id) {
      activeProviderId = '';
      activeModelId = '';
    }
    renderProviders();
    toast('Provedor removido.');
  } catch (error) { toast(error.message, true); }
}

async function discoverProvider(id) {
  const provider = providers.find(item => item.id === id);
  if (provider) openProviderForm(provider);
  const models = await loadProviderModelCatalog(id, true);
  if (models.length) {
    toast(models.length + ' modelos encontrados. Digite para filtrar ou escolha na lista.');
    $('#provider-model')?.focus();
    if (provider && !$('#provider-model').value) $('#provider-model').value = models[0];
  } else {
    toast('Nenhum modelo foi listado. Você ainda pode digitar o identificador manualmente.', true);
  }
}

async function submitProvider(event) {
  event.preventDefault();
  const id = $('#provider-id').value.trim().toLowerCase();
  const secret = $('#provider-secret')?.value || '';
  const data = {
    id,
    name: $('#provider-name').value.trim(),
    baseUrl: $('#provider-url').value.trim(),
    model: $('#provider-model').value.trim(),
    enabled: true
  };
  try {
    await api('/api/providers', { method: 'POST', body: JSON.stringify(data) });
    if (secret.trim()) {
      await api('/api/providers/' + encodeURIComponent(id) + '/secret', {
        method:'POST',
        body:JSON.stringify({ secret:secret.trim() })
      });
    }
    await loadProviders();
    activeProviderId = id;
    activeModelId = data.model;
    if (activeModelId) localStorage.setItem('godmode-model:' + id, activeModelId);
    updateProviderSelect();
    $('#provider-form-wrap').hidden = true;
    toast('Provedor salvo com sucesso.');
  } catch (error) { toast(error.message, true); }
}
function messagesForModel(messages) {
  const selected = [];
  let remaining = 90000;
  let imageBudget = 6;
  for (let index = messages.length - 1; index >= 0 && selected.length < 80 && remaining > 0; index -= 1) {
    const item = messages[index];
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
    const content = item.content.length > remaining ? item.content.slice(-remaining) : item.content;
    const entry = { role: item.role, content };
    if (item.role === 'user' && Array.isArray(item.attachments) && item.attachments.length && imageBudget > 0) {
      entry.attachments = item.attachments.slice(0, imageBudget);
      imageBudget -= entry.attachments.length;
    }
    selected.unshift(entry);
    remaining -= content.length;
  }
  return selected;
}

async function sendMessage(event) {
  event?.preventDefault();
  if (isSending || pendingApproval) return;
  const provider = providers.find(item => item.id === activeProviderId);
  if (!provider) { toast('Cadastre ou selecione um provedor de IA.', true); setView('providers'); return; }
  const modelToUse = ($('#chat-model')?.value || activeModelId || provider.model || '').trim();
  if (!modelToUse) { toast('Digite ou selecione um modelo para conversar.', true); setView('providers'); editProvider(provider.id); return; }

  const rawText = $('#chat-input').value.trim();
  if (!rawText && !pendingAttachments.length) return;
  if (!activeConversation()) createConversation();
  const conversation = activeConversation();
  const conversationId = conversation.id;
  const attachments = pendingAttachments.slice();

  // Slash commands parsing
  let text = rawText;
  if (text.startsWith('/')) {
    const spaceIdx = text.indexOf(' ');
    const cmd = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    if (cmd === '/clear') {
      conversation.messages = [];
      saveConversations();
      renderChat();
      $('#chat-input').value = '';
      autoResizeInput();
      toast('Histórico da conversa limpo.');
      return;
    }
    if (cmd === '/plan') {
      text = `[DIRETIVA /plan - ARQUITETURA]: ${rest || 'Investigue o projeto e elabore um plano de ação arquitetural detalhado sem modificar arquivos.'}`;
    } else if (cmd === '/code') {
      text = `[DIRETIVA /code - PROGRAMAÇÃO]: ${rest || 'Implemente as alterações necessárias no código utilizando as ferramentas nativas com diff e precisão.'}`;
    } else if (cmd === '/test') {
      text = `[DIRETIVA /test - QA]: ${rest || 'Execute a suíte de testes e relate diagnósticos e falhas encontradas.'}`;
    } else if (cmd === '/review') {
      text = `[DIRETIVA /review - REVISÃO]: ${rest || 'Audite o código procurando potenciais bugs, falhas de segurança e melhorias.'}`;
    } else if (cmd === '/reverse') {
      text = `[DIRETIVA /reverse - ENGENHARIA REVERSA]: ${rest || 'Analise a estrutura de baixo nível e fluxo de execução.'}`;
    }
  }

  const message = { role: 'user', content: rawText, createdAt: new Date().toISOString() };
  if (attachments.length) message.attachments = attachments;
  conversation.messages.push(message);
  if (conversation.messages.length === 1) conversation.title = (rawText || `${attachments.length} imagem(ns)`).slice(0, 46) + (rawText.length > 46 ? '…' : '');
  conversation.updatedAt = new Date().toISOString();
  $('#chat-input').value = '';
  pendingAttachments = [];
  renderAttachments();
  autoResizeInput();
  saveConversations();
  renderConversationList();
  renderChat();
  isSending = true;
  setSendState(true);

  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.innerHTML = '<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>LUPID está pensando…</span>';
  $('#chat-messages').append(typing);

  try {
    const payloadMessages = messagesForModel(conversation.messages);
    if (text !== rawText && payloadMessages.length > 0) {
      payloadMessages[payloadMessages.length - 1].content = text;
    }

    // Check complexity for auto-orchestration
    const useOrch = await shouldUseOrchestrator(text);
    let result;
    if (useOrch) {
      typing.innerHTML = '<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span>🤖 Orquestrador ativado — delegando para especialistas…</span>';
      result = await api('/api/agents/workflow/run', {
        method: 'POST',
        body: JSON.stringify({ task: text, projectId: activeProjectId, providerId: activeProviderId, model: modelToUse })
      });
      // Normalize workflow result to chat-like shape
      if (result.result?.synthesis && !result.answer) {
        result = { answer: result.result.synthesis };
      }
    } else {
      result = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          providerId: activeProviderId,
          model: modelToUse,
          projectId: activeProjectId,
          messages: payloadMessages,
          toolsEnabled: $('#tools-toggle').checked
        })
      });
    }
    typing.remove();
    handleAgentResult(result, conversationId);
  } catch (error) {
    typing.remove();
    conversation.messages.push({ role: 'assistant', content: `Não foi possível concluir a solicitação: ${error.message}` });
    saveConversations();
    renderChat();
    toast(error.message, true);
  } finally {
    isSending = false;
    setSendState(false);
  }
}

function handleAgentResult(result, conversationId = activeConversationId) {
  if (result.status === 'approval_required') {
    pendingApproval = result;
    pendingApprovalConversationId = conversationId;
    renderChat();
    if (activeConversationId !== conversationId) toast('Uma ação aguarda sua aprovação em outra conversa. Volte a ela para revisar.');
    return;
  }
  if (result.status === 'cancelled') {
    pendingApproval = null;
    pendingApprovalConversationId = '';
    renderChat();
    toast(result.message || 'A ação foi cancelada.');
    return;
  }
  const conversation = conversations.find(item => item.id === conversationId);
  if (conversation && result.answer) {
    conversation.messages.push({ role: 'assistant', content: result.answer, createdAt: new Date().toISOString() });
    conversation.updatedAt = new Date().toISOString();
    saveConversations();
    renderConversationList();
    autoExtractMemories(conversationId);
  }
  pendingApproval = null;
  pendingApprovalConversationId = '';
  renderChat();
}

function renderApproval(approval) {
  const host = $('#approval-panel');
  host.hidden = false;
  host.innerHTML = `
    <div class="approval-title">⛨ APROVAÇÃO NECESSÁRIA · ${escapeHtml(approval.tool)}</div>
    <div class="approval-desc">${escapeHtml(approval.description || approval.message || 'A ferramenta solicitou uma modificação de arquivo que exige confirmação.')}</div>
    <pre class="approval-code">${escapeHtml(JSON.stringify(approval.arguments || {}, null, 2))}</pre>
    <div class="approval-actions">
      <button class="button approve" id="approve-action">Aprovar e Continuar</button>
      <button class="button reject" id="reject-action">Rejeitar Ação</button>
    </div>`;

  $('#approve-action').addEventListener('click', () => decideApproval(true));
  $('#reject-action').addEventListener('click', () => decideApproval(false));

  if (approval.approvalId) {
    fetchDiffPreview(approval.approvalId).then(diffData => {
      if (diffData) renderDiffInApproval(diffData);
    }).catch(() => undefined);
  }
}

async function decideApproval(approved) {
  if (!pendingApproval) return;
  const pending = pendingApproval;
  const conversationId = pendingApprovalConversationId;
  $$('.approval-actions button').forEach(button => { button.disabled = true; });
  try {
    const result = await api(`/api/approvals/${encodeURIComponent(pending.approvalId)}`, { method: 'POST', body: JSON.stringify({ approved }) });
    pendingApproval = null;
    $('#approval-panel').hidden = true;
    handleAgentResult(result, conversationId);
  } catch (error) {
    toast(error.message, true);
    $$('.approval-actions button').forEach(button => { button.disabled = false; });
  }
}

function autoResizeInput() {
  const input = $('#chat-input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'));
    img.src = dataUrl;
  });
}

async function prepareAttachment(file) {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (file.type === 'image/gif') return { dataUrl: rawDataUrl, mimeType: 'image/gif' };
  const img = await loadImageElement(rawDataUrl);
  const scale = Math.min(1, ATTACHMENT_MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const keepPng = file.type === 'image/png' && scale === 1;
  const dataUrl = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.82);
  return { dataUrl, mimeType: keepPng ? 'image/png' : 'image/jpeg' };
}

async function addAttachmentFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  for (const file of files) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) { toast(`Máximo de ${MAX_ATTACHMENTS} imagens por mensagem.`, true); break; }
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) { toast(`Tipo não suportado: ${file.name || file.type}.`, true); continue; }
    if (file.size > MAX_ATTACHMENT_SOURCE_BYTES) { toast(`"${file.name}" é muito grande.`, true); continue; }
    try {
      const { dataUrl, mimeType } = await prepareAttachment(file);
      pendingAttachments.push({ name: file.name || 'imagem', mimeType, dataUrl });
    } catch (error) { toast(`Erro ao anexar "${file.name}": ${error.message}`, true); }
  }
  renderAttachments();
}

function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderAttachments();
}

function renderAttachments() {
  const host = $('#attachment-list');
  if (!host) return;
  host.hidden = !pendingAttachments.length;
  host.innerHTML = pendingAttachments.map((attachment, index) => `
    <div class="attachment-chip">
      <img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name)}">
      <span class="attachment-name">${escapeHtml(attachment.name)}</span>
      <button type="button" class="attachment-remove" data-remove-attachment="${index}" title="Remover anexo">×</button>
    </div>`).join('');
  $$('[data-remove-attachment]', host).forEach(button => button.addEventListener('click', () => removeAttachment(Number(button.dataset.removeAttachment))));
}

function setDragActive(active) {
  $('#chat-form')?.classList.toggle('drag-active', active);
  const overlay = $('#drop-overlay');
  if (overlay) overlay.hidden = !active;
}

// ============================================================
// File Explorer & Code Editor (Estilo Antigravity)
// ============================================================

async function loadFileTree() {
  const container = $('#file-tree-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-inline">Carregando arquivos do workspace…</div>';
  try {
    const data = await api(`/api/files/tree${activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''}`);
    const rootEl = $('#file-tree-root');
    if (rootEl) rootEl.textContent = data.root || 'Workspace';
    if (!data.tree || !data.tree.length) {
      container.innerHTML = '<div class="empty-inline">Nenhum arquivo encontrado no workspace.</div>';
      return;
    }
    container.innerHTML = renderFileTreeNodes(data.tree);
    bindFileTreeEvents(container);
  } catch (error) {
    container.innerHTML = `<div class="empty-inline error">Erro ao carregar arquivos: ${escapeHtml(error.message)}</div>`;
  }
}

function renderFileTreeNodes(nodes, depth = 0) {
  return nodes.map(node => {
    const indent = depth * 14;
    if (node.type === 'directory') {
      const childrenHtml = node.children && node.children.length ? renderFileTreeNodes(node.children, depth + 1) : '';
      return `
        <div class="file-tree-dir" style="margin-left:${indent}px;">
          <div class="tree-item dir-item" data-path="${escapeHtml(node.path)}">
            <span class="tree-arrow">▾</span>
            <span class="tree-icon folder-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/></svg></span>
            <span class="tree-name">${escapeHtml(node.name)}</span>
          </div>
          <div class="tree-dir-children">${childrenHtml}</div>
        </div>`;
    } else {
      const activeClass = currentOpenFile === node.path ? ' active' : '';
      const ext = node.name.includes('.') ? node.name.split('.').pop() : '';
      const icon = getFileIcon(ext);
      return `
        <div class="tree-item file-item${activeClass}" style="margin-left:${indent}px;" data-file-path="${escapeHtml(node.path)}" title="${escapeHtml(node.path)}">
          <span class="tree-icon">${icon}</span>
          <span class="tree-name">${escapeHtml(node.name)}</span>
          <span class="tree-size">${formatBytes(node.size || 0)}</span>
        </div>`;
    }
  }).join('');
}

function getFileIcon(ext) {
  const type = String(ext || '').toLowerCase();
  const labels = { ts:'TS', tsx:'TSX', js:'JS', jsx:'JSX', mjs:'JS', cjs:'JS', json:'{}', md:'MD', mdx:'MDX', html:'5', htm:'5', css:'#', scss:'S', sass:'S', py:'Py', yml:'Y', yaml:'Y', rs:'Rs', go:'Go', java:'J', kt:'Kt', cs:'C#', cpp:'C++', c:'C', sh:'$_', ps1:'PS', sql:'DB', toml:'T', xml:'X', env:'ENV' };
  const label = labels[type] || '•';
  return '<span class="file-type-icon icon-' + escapeHtml(type) + '">' + escapeHtml(label) + '</span>';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function bindFileTreeEvents(container) {
  $$('.dir-item', container).forEach(item => {
    item.addEventListener('click', () => {
      const parent = item.closest('.file-tree-dir');
      const children = parent?.querySelector('.tree-dir-children');
      const arrow = item.querySelector('.tree-arrow');
      if (children) {
        const isHidden = children.style.display === 'none';
        children.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▾' : '▸';
      }
    });
  });

  $$('.file-item', container).forEach(item => {
    item.addEventListener('click', () => {
      const relPath = item.dataset.filePath;
      if (relPath) openFile(relPath);
    });
  });
}

function editorLanguage(path) {
  const ext = String(path || '').split('.').pop().toLowerCase();
  const languages = { ts:'TypeScript', tsx:'TypeScript React', js:'JavaScript', jsx:'JavaScript React', json:'JSON', html:'HTML', css:'CSS', scss:'SCSS', md:'Markdown', py:'Python', rs:'Rust', go:'Go', java:'Java', kt:'Kotlin', cs:'C#', sql:'SQL', yml:'YAML', yaml:'YAML', ps1:'PowerShell', sh:'Shell', xml:'XML' };
  return languages[ext] || 'Plain Text';
}

function updateEditorPosition() {
  const textarea = $('#file-editor-textarea');
  const target = $('#editor-status-position');
  if (!textarea || !target) return;
  const before = textarea.value.slice(0, textarea.selectionStart || 0);
  const line = before.split('\n').length;
  const column = before.length - before.lastIndexOf('\n');
  target.textContent = 'Ln ' + line + ', Col ' + column;
}

function updateEditorGutter() {
  const textarea = $('#file-editor-textarea');
  const gutter = $('#file-editor-gutter');
  if (!textarea || !gutter) return;
  const value = textarea.value || '';
  const lineCount = value.split('\n').length;
  gutter.textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join('\n');
  gutter.scrollTop = textarea.scrollTop;
  const meta = $('#editor-file-meta');
  if (meta) meta.textContent = currentOpenFile ? lineCount + ' linhas · ' + formatBytes(new TextEncoder().encode(value).length) : 'Abra um arquivo para começar';
  const language = $('#editor-status-language');
  if (language) language.textContent = currentOpenFile ? editorLanguage(currentOpenFile) : 'Plain Text';
  const crumb = $('#editor-crumb-file');
  if (crumb) crumb.textContent = currentOpenFile ? currentOpenFile.replace(/\\/g, '/') : 'selecione um arquivo';
  updateEditorPosition();
}

function renderEditorTabs() {
  const host = $('#editor-tabs');
  if (!host) return;
  if (!openEditorTabs.length) {
    host.innerHTML = '<div class="editor-tab-empty">Nenhum arquivo aberto</div>';
    return;
  }
  host.innerHTML = openEditorTabs.map(tab => {
    const basename = tab.path.split(/[\\/]/).pop() || tab.path;
    const ext = basename.includes('.') ? basename.split('.').pop() : '';
    const active = tab.path === currentOpenFile ? ' active' : '';
    const dirty = tab.dirty ? '<i class="editor-tab-dirty" title="Alterações não salvas"></i>' : '';
    return '<button type="button" class="editor-tab' + active + '" data-editor-tab-path="' + escapeHtml(tab.path) + '" title="' + escapeHtml(tab.path) + '">' +
      getFileIcon(ext) + '<span class="editor-tab-name">' + escapeHtml(basename) + '</span>' + dirty +
      '<span class="editor-tab-close" data-close-editor-tab="' + escapeHtml(tab.path) + '" role="button" aria-label="Fechar ' + escapeHtml(basename) + '" title="Fechar">×</span></button>';
  }).join('');
}

function setEditorFileHeader(path) {
  const basename = path ? path.split(/[\\/]/).pop() : 'Nenhum arquivo selecionado';
  const ext = path && basename.includes('.') ? basename.split('.').pop().toLowerCase() : '';
  const badge = $('#editor-file-badge');
  if (badge) {
    badge.className = 'file-type-icon icon-' + escapeHtml(ext);
    badge.textContent = ext ? ext.toUpperCase().slice(0, 3) : 'FILE';
    badge.style.display = path ? 'inline-grid' : 'none';
  }
  const heading = $('#editor-active-file');
  if (heading) heading.textContent = basename;
  const tab = openEditorTabs.find(item => item.path === path);
  const saveBtn = $('#editor-save-btn');
  if (saveBtn) saveBtn.disabled = !tab || !tab.dirty;
}

async function openFile(relPath) {
  let tab = openEditorTabs.find(item => item.path === relPath);
  const textarea = $('#file-editor-textarea');
  if (!tab) {
    currentOpenFile = relPath;
    setEditorFileHeader(relPath);
    if (textarea) { textarea.disabled = true; textarea.value = 'Carregando conteúdo…'; }
    const url = '/api/files/read?path=' + encodeURIComponent(relPath) + (activeProjectId ? '&projectId=' + encodeURIComponent(activeProjectId) : '');
    try {
      const data = await api(url);
      tab = { path: relPath, content: data.content, savedContent: data.content, dirty: false };
      openEditorTabs.push(tab);
    } catch (error) {
      if (textarea) textarea.value = 'Erro ao abrir arquivo: ' + error.message;
      toast('Falha ao abrir arquivo: ' + error.message, true);
      return;
    }
  }
  currentOpenFile = relPath;
  currentFileContent = tab.content;
  if (textarea) { textarea.value = tab.content; textarea.disabled = false; }
  $$('.file-item').forEach(el => el.classList.toggle('active', el.dataset.filePath === relPath));
  setEditorFileHeader(relPath);
  renderEditorTabs();
  updateEditorGutter();
}

function closeEditorTab(relPath) {
  const tab = openEditorTabs.find(item => item.path === relPath);
  if (!tab) return;
  if (tab.dirty && !confirm('O arquivo "' + relPath + '" tem alterações não salvas. Fechar mesmo assim?')) return;
  const index = openEditorTabs.findIndex(item => item.path === relPath);
  openEditorTabs.splice(index, 1);
  if (currentOpenFile === relPath) {
    const next = openEditorTabs[Math.min(index, openEditorTabs.length - 1)];
    if (next) {
      void openFile(next.path);
    } else {
      currentOpenFile = null;
      currentFileContent = '';
      const textarea = $('#file-editor-textarea');
      if (textarea) { textarea.value = ''; textarea.disabled = true; }
      setEditorFileHeader(null);
      updateEditorGutter();
      renderEditorTabs();
    }
  } else {
    renderEditorTabs();
  }
}

function resetEditorWorkspace() {
  openEditorTabs = [];
  currentOpenFile = null;
  currentFileContent = '';
  const textarea = $('#file-editor-textarea');
  if (textarea) { textarea.value = ''; textarea.disabled = true; }
  setEditorFileHeader(null);
  renderEditorTabs();
  updateEditorGutter();
}

function confirmEditorWorkspaceSwitch() {
  const dirty = openEditorTabs.filter(tab => tab.dirty);
  if (!dirty.length) return true;
  return confirm('Há ' + dirty.length + ' arquivo(s) com alterações não salvas. Trocar de projeto vai fechar essas abas. Deseja continuar?');
}

function filterFileTree(query) {
  const host = $('#file-tree-container');
  if (!host) return;
  const term = String(query || '').trim().toLowerCase();
  $$('.tree-item', host).forEach(item => {
    const path = item.dataset.filePath || item.dataset.path || '';
    const label = item.querySelector('.tree-name')?.textContent || '';
    item.hidden = Boolean(term) && !(path + ' ' + label).toLowerCase().includes(term);
  });
  $$('.file-tree-dir', host).forEach(folder => {
    const own = folder.querySelector(':scope > .dir-item');
    const descendants = [...folder.querySelectorAll('.tree-item')].some(item => !item.hidden);
    const folderName = own?.querySelector('.tree-name')?.textContent || '';
    const ownMatch = Boolean(term) && folderName.toLowerCase().includes(term);
    folder.hidden = Boolean(term) && !descendants && !ownMatch;
    if (term && ownMatch) folder.querySelectorAll('.tree-item').forEach(item => { item.hidden = false; });
  });
}

async function saveCurrentFile() {
  if (!currentOpenFile) return;
  const tab = openEditorTabs.find(item => item.path === currentOpenFile);
  const saveBtn = $('#editor-save-btn');
  const newContent = $('#file-editor-textarea').value;
  if (tab) { tab.content = newContent; tab.dirty = newContent !== tab.savedContent; }
  if (!tab || !tab.dirty) { if (saveBtn) saveBtn.disabled = true; return; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Salvando…'; }
  try {
    const res = await api('/api/files/save', {
      method: 'POST',
      body: JSON.stringify({ path: currentOpenFile, content: newContent, projectId: activeProjectId || undefined })
    });
    currentFileContent = newContent;
    tab.savedContent = newContent;
    tab.content = newContent;
    tab.dirty = false;
    renderEditorTabs();
    updateEditorGutter();
    toast(res.message || 'Arquivo salvo com sucesso!');
  } catch (error) {
    toast('Erro ao salvar arquivo: ' + error.message, true);
  } finally {
    if (saveBtn) {
      saveBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>Salvar <kbd>Ctrl S</kbd>';
      saveBtn.disabled = !tab.dirty;
    }
  }
}

// ============================================================
// Multiagente (7 Especialistas & Workflow Cooperativo)
// ============================================================

async function loadSpecialists() {
  const grid = $('#specialists-grid');
  if (!grid) return;
  try {
    const res = await api('/api/agents/specialists');
    specialists = res.specialists || [];
    const roleIcons = {
      orchestrator:'◎', coder:'⌘', researcher:'⌕', reviewer:'✓',
      tester:'▤', architect:'⌂', reverse_engineer:'⌁'
    };
    grid.innerHTML = specialists.map(agent => {
      const tools = (agent.recommendedTools || []).map(tool =>
        '<span class="specialist-tool-chip">' + escapeHtml(tool) + '</span>'
      ).join('');
      return '<article class="specialist-row">' +
        '<span class="specialist-row-icon">' + (roleIcons[agent.role] || '◇') + '</span>' +
        '<div class="specialist-row-main">' +
          '<strong>' + escapeHtml(agent.name) + ' <code>' + escapeHtml(agent.role) + '</code></strong>' +
          '<small>' + escapeHtml(agent.description || '') + '</small>' +
          (tools ? '<div class="specialist-row-tools">' + tools + '</div>' : '') +
        '</div>' +
        '<span class="status-pill status-connected">Disponível</span>' +
      '</article>';
    }).join('') || '<div class="empty-inline">Nenhum especialista registrado.</div>';
  } catch (error) {
    grid.innerHTML = '<div class="empty-inline error">Erro ao carregar especialistas: ' + escapeHtml(error.message) + '</div>';
  }
}
function renderWorkflowResult(result) {
  const progress = $('#workflow-progress');
  const stepsHost = $('#workflow-steps-list');
  const synthesis = $('#workflow-synthesis');
  const synthesisContent = $('#workflow-synthesis-content');
  const summary = $('#workflow-progress-summary');
  const steps = Array.isArray(result?.steps) ? result.steps : [];

  if (progress) progress.hidden = false;
  if (stepsHost) {
    const labels = { pending:'Aguardando', running:'Executando', completed:'Concluído', failed:'Falhou' };
    stepsHost.innerHTML = steps.map((step, index) => {
      const status = step.status || 'pending';
      const safeRole = escapeHtml(step.specialist || 'especialista');
      const output = step.output ? '<div class="workflow-step-output">' + escapeHtml(step.output.slice(0, 1200)) + '</div>' : '';
      const duration = typeof step.durationMs === 'number' ? '<small>' + step.durationMs + ' ms</small>' : '';
      return '<article class="workflow-step-item status-' + escapeHtml(status) + '">' +
        '<span class="step-num">' + String(index + 1).padStart(2, '0') + '</span>' +
        '<div class="step-info"><div class="step-agent"><strong>' + safeRole + '</strong> ' + duration + '</div>' +
        '<div class="step-inst">' + escapeHtml(step.instruction || '') + '</div>' + output + '</div>' +
        '<span class="step-status status-pill ' + (status === 'failed' ? 'off' : '') + '">' + (labels[status] || status) + '</span>' +
      '</article>';
    }).join('') || '<div class="empty-inline">O workflow não retornou etapas.</div>';
  }
  if (summary) {
    const completed = result?.completedSteps ?? steps.filter(step => step.status === 'completed').length;
    const failed = result?.failedSteps ?? steps.filter(step => step.status === 'failed').length;
    summary.textContent = failed ? completed + '/' + steps.length + ' concluídas · ' + failed + ' falhas' : completed + '/' + steps.length + ' concluídas';
    summary.classList.toggle('risk-high', failed > 0);
  }
  if (synthesis && synthesisContent) {
    synthesis.hidden = false;
    synthesisContent.textContent = result?.finalSynthesis || 'Sem síntese retornada pelo provedor.';
  }
}

async function runMultiAgentWorkflow(event) {
  event?.preventDefault();
  const task = $('#workflow-task-input')?.value?.trim();
  if (!task) return;

  const submitBtn = $('#workflow-submit-btn');
  const queueBtn = $('#queue-workflow-btn');
  const progress = $('#workflow-progress');
  const synthesis = $('#workflow-synthesis');
  const summary = $('#workflow-progress-summary');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Executando…'; }
  if (queueBtn) queueBtn.disabled = true;
  if (progress) progress.hidden = false;
  if (synthesis) synthesis.hidden = true;
  if ($('#workflow-steps-list')) $('#workflow-steps-list').innerHTML = '<div class="empty-inline">Enviando missão ao orquestrador…</div>';
  if (summary) summary.textContent = 'Em execução';

  try {
    const response = await api('/api/agents/workflow/run', {
      method: 'POST',
      body: JSON.stringify({
        task,
        agentRole: $('#workflow-agent-role')?.value || 'auto',
        projectId: activeProjectId || undefined,
        providerId: activeProviderId || undefined,
        model: activeModelId || undefined
      })
    });

    renderWorkflowResult(response.result);
    await loadTaskQueue();
    if ($('#workflow-task-input')) $('#workflow-task-input').value = '';
    toast(response.result?.success ? 'Missão concluída e registrada na fila.' : 'Missão terminou com etapas que precisam de revisão.', !response.result?.success);
  } catch (error) {
    const payload = error.payload || {};
    if (payload.result) renderWorkflowResult(payload.result);
    else {
      if (synthesis) synthesis.hidden = false;
      if ($('#workflow-synthesis-content')) $('#workflow-synthesis-content').textContent = error.message;
      if (summary) summary.textContent = 'Falha na execução';
    }
    await loadTaskQueue();
    toast('Erro no workflow: ' + error.message, true);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Executar agora'; }
    if (queueBtn) queueBtn.disabled = false;
  }
}

// ============================================================
// Validação do projeto — usa o TestRunner real do backend
// ============================================================

async function loadTestRunnerConfig() {
  if (!activeProjectId) return;
  try {
    const response = await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/tests/config');
    const config = response.config || {};
    if ($('#test-command')) $('#test-command').value = config.testCommand || 'npm test';
    if ($('#lint-command')) $('#lint-command').value = config.lintCommand || 'npm run lint';
    if ($('#build-command')) $('#build-command').value = config.buildCommand || 'npm run typecheck';
    if ($('#test-timeout')) $('#test-timeout').value = String(config.timeoutSeconds || 60);
  } catch (error) {
    toast('Não foi possível carregar a configuração de testes: ' + error.message, true);
  }
}

async function saveTestRunnerConfig(event) {
  event?.preventDefault();
  if (!activeProjectId) { toast('Selecione um projeto antes de configurar os testes.', true); return; }
  const config = {
    testCommand: $('#test-command')?.value.trim() || '',
    lintCommand: $('#lint-command')?.value.trim() || '',
    buildCommand: $('#build-command')?.value.trim() || '',
    timeoutSeconds: Math.max(5, Math.min(600, Number($('#test-timeout')?.value) || 60))
  };
  try {
    await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/tests/config', {
      method:'POST',
      body:JSON.stringify(config)
    });
    toast('Comandos de validação salvos para este projeto.');
  } catch (error) { toast('Falha ao salvar os comandos: ' + error.message, true); }
}

function renderTestRunnerResult(result) {
  const status = $('#test-runner-status');
  const summary = $('#test-runner-summary');
  const output = $('#test-runner-output');
  if (status) {
    status.textContent = result.success ? 'APROVADO' : result.timedOut ? 'TEMPO ESGOTADO' : 'FALHOU';
    status.className = 'status-pill ' + (result.success ? 'status-connected' : 'off');
  }
  if (summary) {
    summary.textContent = (result.suite || 'Execução') + ' · código ' + result.exitCode + ' · ' +
      result.durationMs + ' ms · ' + (result.diagnostics?.length || 0) + ' diagnóstico(s)';
  }
  if (output) {
    const diagnostics = Array.isArray(result.diagnostics) && result.diagnostics.length
      ? '\n\nDIAGNÓSTICOS:\n' + result.diagnostics.join('\n')
      : '';
    output.textContent = (result.output || '(sem saída do processo)') + diagnostics;
  }
}

async function runProjectSuite(suite, button) {
  if (!activeProjectId) { toast('Cadastre ou selecione um projeto primeiro.', true); return; }
  const control = button || document.querySelector('[data-run-suite="' + suite + '"]');
  if (control) { control.disabled = true; control.textContent = 'Executando…'; }
  const status = $('#test-runner-status');
  if (status) { status.textContent = 'EXECUTANDO'; status.className = 'status-pill'; }
  if ($('#test-runner-output')) $('#test-runner-output').textContent = '$ Iniciando ' + suite + '…';

  try {
    const response = await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/tests/run', {
      method:'POST',
      body:JSON.stringify({ suite })
    });
    renderTestRunnerResult(response.result);
    if (response.result.success) toast('Validação ' + suite + ' concluída.');
    else toast('A validação ' + suite + ' encontrou falhas.', true);
  } catch (error) {
    const result = error.payload?.result;
    if (result) renderTestRunnerResult(result);
    else {
      if (status) { status.textContent = 'ERRO'; status.className = 'status-pill off'; }
      if ($('#test-runner-output')) $('#test-runner-output').textContent = error.message;
      if ($('#test-runner-summary')) $('#test-runner-summary').textContent = 'Não foi possível executar a suíte.';
    }
    toast('Falha ao executar ' + suite + ': ' + error.message, true);
  } finally {
    if (control) {
      control.disabled = false;
      control.textContent = suite === 'test' ? '▶ Executar testes' : suite === 'build' ? 'Verificar tipos / build' : 'Executar lint';
    }
  }
}

// ============================================================
// Claude Code Plugins & MCP Marketplace
// ============================================================

// ============================================================
// Claude Code Plugins & MCP Marketplace
// ============================================================

async function loadPluginManager() {
  pluginLoadError = '';
  try {
    const [pluginRes, catalogRes, statusRes, serverRes, toolRes, resourceRes, promptRes] = await Promise.all([
      api('/api/claude/plugins'),
      api('/api/mcp/marketplace/catalog'),
      api('/api/mcp/marketplace/status'),
      api('/api/mcp/servers'),
      api('/api/mcp/tools'),
      api('/api/mcp/resources'),
      api('/api/mcp/prompts')
    ]);
    claudePlugins = pluginRes.plugins || [];
    mcpCatalog = catalogRes.catalog || [];
    pluginStatusMap = new Map((statusRes.status || []).map(item => [item.id, item]));
    servers = serverRes.servers || [];
    tools = toolRes.tools || [];
    resources = resourceRes.resources || [];
    prompts = promptRes.prompts || [];
    renderPluginManager();
    renderServers();
    renderTools();
    renderMcpCapabilities();
  } catch (error) {
    pluginLoadError = error.message || String(error);
    renderPluginManager();
    toast('Não foi possível carregar a área de plugins: ' + pluginLoadError, true);
  }
}

function getPluginEntries() {
  const query = pluginSearchText.trim().toLowerCase();
  let entries = [];

  if (pluginTab === 'discover') {
    entries = mcpCatalog.map(item => {
      const status = pluginStatusMap.get(item.id) || { installed:false, enabled:false, connected:false };
      return {
        key:'catalog:' + item.id, type:'catalog', id:item.id,
        name:item.name, description:item.description, category:item.category,
        package:item.command + ' ' + (item.args || []).join(' '),
        author:item.author, permissions:item.permissions || [], risk:item.risk,
        installed:status.installed, enabled:status.enabled, connected:status.connected
      };
    });
  } else if (pluginTab === 'installed') {
    entries = servers.map(server => ({
      key:'server:' + server.name, type:'server', id:server.name,
      name:server.name, description:server.description || 'Servidor MCP configurado',
      category:'Servidor MCP', connected:Boolean(server.connected),
      enabled:server.enabled !== false, error:server.error || '',
      toolsCount:Number(server.tools || 0), command:server.command, args:server.args || [],
      url:server.url, transport:server.transport
    }));
    const serverNames = new Set(servers.map(server => server.name));
    claudePlugins.filter(plugin => plugin.source !== 'claude-desktop' || !serverNames.has(plugin.name)).forEach(plugin => {
      entries.push({
        key:'native:' + plugin.source + ':' + plugin.name, type:'native', id:plugin.name,
        name:plugin.name, description:plugin.description || 'Plugin detectado na configuração do Claude',
        category:plugin.source === 'claude-code' ? 'Claude Code' : 'Claude Desktop',
        source:plugin.source, enabled:plugin.enabled !== false, toolsCount:(plugin.tools || []).length
      });
    });
  } else if (pluginTab === 'marketplaces') {
    const categories = [...new Set(mcpCatalog.map(item => item.category))];
    entries = [{
      key:'marketplace:curated', type:'marketplace', id:'curated',
      name:'GODMODE MCP Curated', description:'Catálogo integrado de servidores MCP mantido junto ao GODMODE CORE.',
      category:'Catálogo integrado', itemCount:mcpCatalog.length, categories
    }];
  } else if (pluginTab === 'errors') {
    entries = servers.filter(server => Boolean(server.error)).map(server => ({
      key:'error:' + server.name, type:'error', id:server.name,
      name:server.name, description:server.description || 'Falha em servidor MCP',
      error:server.error, category:server.transport || (server.command ? 'stdio' : 'HTTP'),
      connected:Boolean(server.connected), command:server.command, url:server.url
    }));
  }

  if (query) {
    entries = entries.filter(item =>
      [item.name,item.description,item.category,item.package,item.author,item.id,item.error]
        .filter(Boolean).join(' ').toLowerCase().includes(query)
    );
  }
  return entries;
}

function renderPluginManager() {
  const list = $('#plugin-entry-list');
  const title = $('#plugin-list-title');
  const count = $('#plugin-list-count');
  const errorCount = $('#plugin-error-count');
  if (!list) return;

  const errors = servers.filter(server => Boolean(server.error)).length;
  if (errorCount) errorCount.textContent = String(errors);
  const labels = {
    discover:'Catálogo disponível',
    installed:'Extensões instaladas',
    marketplaces:'Fontes de plugins',
    errors:'Falhas de conexão'
  };
  if (title) title.textContent = labels[pluginTab] || 'Plugins';
  const entries = getPluginEntries();
  if (count) count.textContent = String(entries.length);

  $$('[data-plugin-tab]').forEach(button => {
    const active = button.dataset.pluginTab === pluginTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (!entries.some(entry => entry.key === selectedPluginKey)) {
    selectedPluginKey = entries[0]?.key || '';
  }

  list.innerHTML = entries.map(entry => {
    let status = '';
    if (entry.type === 'catalog') status = entry.installed ? (entry.enabled ? 'Instalado' : 'Desativado') : 'Disponível';
    else if (entry.type === 'server') status = entry.error ? 'Erro' : entry.connected ? 'Conectado' : entry.enabled ? 'Desconectado' : 'Desativado';
    else if (entry.type === 'native') status = entry.enabled ? 'Detectado' : 'Inativo';
    else if (entry.type === 'error') status = 'Erro';
    else status = entry.itemCount + ' integrações';

    const icon = entry.type === 'catalog' ? '◇' : entry.type === 'server' ? '⌘' :
      entry.type === 'native' ? '⚡' : entry.type === 'error' ? '!' : '▦';
    return '<button type="button" class="plugin-entry' + (entry.key === selectedPluginKey ? ' active' : '') +
      '" data-plugin-select="' + escapeHtml(entry.key) + '">' +
      '<span class="plugin-entry-icon">' + icon + '</span>' +
      '<span class="plugin-entry-copy"><strong>' + escapeHtml(entry.name) + '</strong><small>' +
      escapeHtml(entry.category || '') + '</small></span>' +
      '<span class="plugin-entry-status">' + escapeHtml(status) + '</span>' +
    '</button>';
  }).join('') || (pluginLoadError
    ? '<div class="empty-inline error">' + escapeHtml(pluginLoadError) + '</div>'
    : '<div class="empty-inline">Nenhum item nesta categoria.</div>');

  renderPluginDetail(entries.find(entry => entry.key === selectedPluginKey) || null);
}

function renderPluginDetail(entry) {
  const host = $('#plugin-detail-panel');
  if (!host) return;
  if (!entry) {
    host.innerHTML = '<div class="plugin-detail-empty"><div class="plugin-detail-mark">◇</div><h3>Selecione uma integração</h3><p>Escolha um item à esquerda para ver detalhes e ações disponíveis.</p></div>';
    return;
  }

  const tag = (label, value) => '<span class="plugin-detail-tag"><small>' + escapeHtml(label) + '</small><strong>' + escapeHtml(value) + '</strong></span>';
  let meta = '';
  let actions = '';
  let capabilities = '';
  let warning = '';

  if (entry.type === 'catalog') {
    meta = tag('Categoria',entry.category) + tag('Autor',entry.author || 'Comunidade') +
      tag('Risco declarado',entry.risk || 'Não classificado') + tag('Pacote',entry.package || 'MCP');
    capabilities = '<div class="plugin-detail-section"><h4>Permissões declaradas</h4><div class="plugin-permissions">' +
      (entry.permissions || []).map(permission => '<code>' + escapeHtml(permission) + '</code>').join('') +
      '</div></div><div class="plugin-detail-section"><h4>Como funciona</h4><p>Este item registra um servidor MCP no GODMODE. A conexão só inicia quando você escolher Conectar, após revisar o comando e os argumentos.</p></div>';
    if (entry.installed) {
      actions = '<button class="button secondary" data-plugin-toggle="' + escapeHtml(entry.id) + '" data-enabled="' + String(entry.enabled) + '">' +
        (entry.enabled ? 'Desativar' : 'Ativar') + '</button><span class="plugin-inline-state">' + (entry.connected ? 'Conectado' : 'Instalado; conexão sob demanda') + '</span>';
    } else {
      actions = '<button class="button primary" data-plugin-install="' + escapeHtml(entry.id) + '">＋ Instalar integração</button>';
    }
  } else if (entry.type === 'server' || entry.type === 'error') {
    meta = tag('Tipo',entry.category || 'MCP') + tag('Estado',entry.error ? 'Erro' : entry.connected ? 'Conectado' : entry.enabled ? 'Desconectado' : 'Desativado') +
      tag('Ferramentas',String(entry.toolsCount || 0));
    if (entry.url) meta += tag('Endpoint',entry.url);
    if (entry.command) meta += tag('Comando',entry.command + ' ' + (entry.args || []).join(' '));
    capabilities = entry.error
      ? '<div class="plugin-error-box"><strong>Último erro</strong><p>' + escapeHtml(entry.error) + '</p></div>'
      : '<div class="plugin-detail-section"><h4>Conexão</h4><p>Este servidor disponibiliza suas ferramentas MCP quando estiver conectado. Ferramentas podem solicitar aprovação conforme a política do núcleo.</p></div>';
    if (entry.connected) actions += '<button class="button secondary" data-plugin-disconnect="' + escapeHtml(entry.id) + '">Desconectar</button>';
    else if (entry.enabled) actions += '<button class="button primary" data-plugin-connect="' + escapeHtml(entry.id) + '">Conectar</button>';
    if (!entry.connected) actions += '<button class="button subtle-danger" data-plugin-remove="' + escapeHtml(entry.id) + '">Remover</button>';
  } else if (entry.type === 'native') {
    meta = tag('Origem',entry.source === 'claude-code' ? 'Claude Code' : 'Claude Desktop') +
      tag('Estado',entry.enabled ? 'Detectado' : 'Inativo') + tag('Ferramentas conhecidas',String(entry.toolsCount || 0));
    capabilities = '<div class="plugin-detail-section"><h4>Plugin nativo detectado</h4><p>O GODMODE identificou esta entrada na configuração do Claude. A administração e instalação de plugins nativos do Claude Code ainda não é suportada por esta integração; servidores MCP compatíveis podem ser importados e gerenciados separadamente.</p></div>';
  } else if (entry.type === 'marketplace') {
    meta = tag('Origem','Integrado ao GODMODE') + tag('Itens',String(entry.itemCount || 0)) +
      tag('Categorias',(entry.categories || []).join(', ') || '—');
    capabilities = '<div class="plugin-detail-section"><h4>Catálogo MCP integrado</h4><p>Esta versão oferece um catálogo curado embutido. Ainda não há cadastro de marketplaces Git remotos nem sincronização de fontes nativas do Claude Code.</p></div>';
    actions = '<button class="button primary" data-plugin-show-discover>Ver integrações</button>';
  }

  host.innerHTML = '<div class="plugin-detail-header"><div class="plugin-detail-icon">' +
    (entry.type === 'native' ? '⚡' : entry.type === 'marketplace' ? '▦' : '◇') + '</div><div class="plugin-detail-heading">' +
    '<div class="plugin-detail-eyebrow">' + escapeHtml(entry.category || 'Integração') + '</div><h3>' + escapeHtml(entry.name) +
    '</h3><p>' + escapeHtml(entry.description || '') + '</p></div></div>' +
    '<div class="plugin-detail-tags">' + meta + '</div>' +
    capabilities +
    (warning ? '<div class="plugin-detail-warning">' + warning + '</div>' : '') +
    (actions ? '<div class="plugin-detail-actions">' + actions + '</div>' : '');
}

async function performPluginAction(action, id, enabled) {
  try {
    if (action === 'install') {
      await api('/api/mcp/marketplace/install/' + encodeURIComponent(id), { method:'POST', body:'{}' });
      toast('Integração ' + id + ' instalada. Conecte-a depois de revisar o comando.');
      pluginTab = 'installed';
      selectedPluginKey = 'server:' + id;
    } else if (action === 'toggle') {
      await api('/api/mcp/marketplace/toggle/' + encodeURIComponent(id), {
        method:'POST', body:JSON.stringify({ enabled:!enabled })
      });
      toast('Estado de ' + id + ' atualizado.');
    } else if (action === 'connect') {
      await connectMcp(id);
      return;
    } else if (action === 'disconnect') {
      await disconnectMcp(id);
      return;
    } else if (action === 'remove') {
      await removeMcp(id);
      return;
    }
    await loadPluginManager();
  } catch (error) {
    toast('Não foi possível atualizar a integração: ' + error.message, true);
  }
}

async function syncClaudePlugins() {
  const btn = $('#import-claude-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  try {
    const result = await api('/api/claude/plugins/import', { method:'POST', body:'{}' });
    toast('Sincronização concluída: ' + result.imported + ' servidor(es) MCP importado(s).');
    await loadPluginManager();
  } catch (error) {
    toast('Erro ao sincronizar Claude: ' + error.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Sincronizar Claude'; }
  }
}

// ============================================================
// MCP Core Handlers
// ============================================================

async function loadMcp() {
  try {
    const [serversResult, toolsResult, resourcesResult, promptsResult] = await Promise.all([
      api('/api/mcp/servers'), api('/api/mcp/tools'), api('/api/mcp/resources'), api('/api/mcp/prompts'),
    ]);
    servers = serversResult.servers || [];
    tools = toolsResult.tools || [];
    resources = resourcesResult.resources || [];
    prompts = promptsResult.prompts || [];
    renderServers();
    renderTools();
    renderMcpCapabilities();
    renderPluginManager();
  } catch (error) { toast(`Falha ao consultar MCP: ${error.message}`, true); }
}

function renderServers() {
  const host = $('#mcp-server-list');
  if (!host) return;
  host.innerHTML = servers.map(server => (
    '<div class="plugin-connection-row">' +
      '<div class="plugin-connection-main"><strong>' + escapeHtml(server.name) + '</strong>' +
      '<small>' + escapeHtml(server.transport || (server.command ? 'stdio' : 'HTTP')) + ' · ' +
      escapeHtml(server.command || server.url || '') + '</small>' +
      (server.error ? '<span class="plugin-connection-error">' + escapeHtml(server.error) + '</span>' : '') +
      '</div>' +
      '<span class="status-pill ' + (server.connected ? 'status-connected' : 'off') + '">' +
        (server.connected ? 'Conectado' : server.enabled === false ? 'Desativado' : 'Desconectado') +
      '</span>' +
      '<div class="plugin-connection-actions">' +
        (server.connected
          ? '<button class="button secondary small" data-disconnect-mcp="' + escapeHtml(server.name) + '">Desconectar</button>'
          : '<button class="button primary small" data-connect-mcp="' + escapeHtml(server.name) + '" ' + (server.enabled === false ? 'disabled' : '') + '>Conectar</button>') +
        '<button class="button subtle-danger small" data-remove-mcp="' + escapeHtml(server.name) + '" ' + (server.connected ? 'disabled' : '') + ' title="Remover servidor">×</button>' +
      '</div>' +
    '</div>'
  )).join('') || '<div class="empty-inline">Nenhum servidor MCP configurado.</div>';

  $$('[data-connect-mcp]', host).forEach(button => button.addEventListener('click', () => void connectMcp(button.dataset.connectMcp)));
  $$('[data-disconnect-mcp]', host).forEach(button => button.addEventListener('click', () => void disconnectMcp(button.dataset.disconnectMcp)));
  $$('[data-remove-mcp]', host).forEach(button => button.addEventListener('click', () => void removeMcp(button.dataset.removeMcp)));
}
function renderTools() {
  const host = $('#mcp-tools-list');
  if (!host) return;
  const countEl = $('#tools-count');
  if (countEl) countEl.textContent = `${tools.length} ferramenta(s)`;
  host.innerHTML = tools.map(tool => `
    <div class="tool-row">
      <div>
        <strong>${escapeHtml(tool.server)} / ${escapeHtml(tool.name)}</strong>
        <small>${escapeHtml(tool.description || 'Sem descrição.')}</small>
      </div>
      <span class="tool-approval">${tool.requiresApproval ? '◉ Confirmação' : '○ Leitura'}</span>
    </div>`).join('') || '<div class="empty-inline">Conecte um servidor MCP para descobrir ferramentas.</div>';
}

function renderMcpCapabilities() {
  const resourceHost = $('#mcp-resources-list');
  const promptHost = $('#mcp-prompts-list');
  const resCount = $('#resources-count');
  const promptCount = $('#prompts-count');
  if (resCount) resCount.textContent = resources.length + ' recurso(s)';
  if (promptCount) promptCount.textContent = prompts.length + ' prompt(s)';

  if (resourceHost) {
    resourceHost.innerHTML = resources.map(resource => (
      '<article class="capability-row">' +
        '<div class="capability-row-main"><strong>' + escapeHtml(resource.name || resource.uri) + '</strong>' +
        '<small>' + escapeHtml(resource.server) + ' · ' + escapeHtml(resource.mimeType || 'Resource') + '</small>' +
        '<span>' + escapeHtml(resource.description || resource.uri || '') + '</span></div>' +
        '<button type="button" class="button secondary small" data-read-resource data-server="' + escapeHtml(resource.server) + '" data-uri="' + escapeHtml(resource.uri) + '">Ler recurso</button>' +
      '</article>'
    )).join('') || '<div class="empty-inline">Nenhum resource anunciado por servidores conectados.</div>';
  }
  if (promptHost) {
    promptHost.innerHTML = prompts.map(prompt => (
      '<article class="capability-row">' +
        '<div class="capability-row-main"><strong>' + escapeHtml(prompt.title || prompt.name) + '</strong>' +
        '<small>' + escapeHtml(prompt.server) + ' · ' + ((prompt.arguments || []).length) + ' argumento(s)</small>' +
        '<span>' + escapeHtml(prompt.description || 'Template de prompt MCP') + '</span></div>' +
        '<button type="button" class="button secondary small" data-get-prompt data-server="' + escapeHtml(prompt.server) + '" data-prompt-name="' + escapeHtml(prompt.name) + '">Obter prompt</button>' +
      '</article>'
    )).join('') || '<div class="empty-inline">Nenhum prompt anunciado por servidores conectados.</div>';
  }
}

async function inspectMcpResource(server, uri) {
  const output = $('#mcp-capability-output');
  if (output) output.textContent = 'Lendo resource ' + uri + '…';
  try {
    const result = await api('/api/mcp/resources/read', { method:'POST', body:JSON.stringify({ server, uri }) });
    if (output) output.textContent = JSON.stringify(result.result, null, 2);
  } catch (error) {
    if (output) output.textContent = 'Falha ao ler resource: ' + error.message;
    toast(error.message, true);
  }
}

async function inspectMcpPrompt(server, name) {
  const prompt = prompts.find(item => item.server === server && item.name === name);
  const args = {};
  for (const argument of (prompt?.arguments || [])) {
    if (!argument.required) continue;
    const value = window.prompt(argument.description || argument.name, '');
    if (value === null) return;
    args[argument.name] = value;
  }
  const output = $('#mcp-capability-output');
  if (output) output.textContent = 'Obtendo prompt ' + name + '…';
  try {
    const result = await api('/api/mcp/prompts/get', { method:'POST', body:JSON.stringify({ server, name, arguments:args }) });
    if (output) output.textContent = JSON.stringify(result.result, null, 2);
  } catch (error) {
    if (output) output.textContent = 'Falha ao obter prompt: ' + error.message;
    toast(error.message, true);
  }
}
async function importMcp() {
  const text = $('#mcp-config').value.trim();
  if (!text) { toast('Cole a configuração JSON antes de importar.', true); return; }
  let config;
  try { config = JSON.parse(text); } catch (error) { toast(`JSON inválido: ${error.message}`, true); return; }
  try {
    const result = await api('/api/mcp/import', { method: 'POST', body: JSON.stringify(config) });
    servers = result.servers || [];
    await loadPluginManager();
    const fb = $('#mcp-import-feedback');
    if (fb) {
      fb.textContent = `${result.imported} servidor(es) importado(s).`;
      fb.classList.remove('error');
    }
    toast('Configuração MCP importada com sucesso.');
  } catch (error) {
    const fb = $('#mcp-import-feedback');
    if (fb) {
      fb.textContent = error.message;
      fb.classList.add('error');
    }
    toast(error.message, true);
  }
}

async function connectMcp(name) {
  const server = servers.find(item => item.name === name);
  if (server?.command && !confirm(`Isso iniciará um processo local:\n\n${server.command} ${(server.args || []).join(' ')}\n\nDeseja conectar?`)) return;
  try {
    const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/connect`, { method: 'POST', body: '{}' });
    servers = result.servers || [];
    await loadPluginManager();
    toast(`Servidor ${name} conectado.`);
  } catch (error) {
    await loadPluginManager();
    toast(error.message, true);
  }
}

async function disconnectMcp(name) {
  try {
    const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/disconnect`, { method: 'POST', body: '{}' });
    servers = result.servers || [];
    await loadPluginManager();
    toast(`Servidor ${name} desconectado.`);
  } catch (error) { toast(error.message, true); }
}

async function removeMcp(name) {
  if (!confirm(`Remover o servidor MCP "${name}"?`)) return;
  try {
    const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' });
    servers = result.servers || [];
    await loadPluginManager();
    toast('Configuração removida.');
  } catch (error) { toast(error.message, true); }
}

// ============================================================
// Gerenciador de Projetos
// ============================================================

async function loadProjects() {
  try {
    const data = await api('/api/projects');
    projects = Array.isArray(data.projects) ? data.projects : [];
    activeProjectId = data.activeId || projects[0]?.id || '';
    renderProjectSelector();
    renderProjects();
  } catch (error) {
    console.error('Falha ao carregar projetos:', error);
  }
}

function renderProjectSelector() {
  const sel = $('#project-selector');
  if (sel) {
    sel.innerHTML = projects.map(p => `
      <option value="${escapeHtml(p.id)}" ${p.id === activeProjectId ? 'selected' : ''}>
        ${escapeHtml(p.name)}
      </option>
    `).join('');
  }
  const statusProject = $('#statusbar-project');
  if (statusProject) statusProject.textContent = projects.find(p => p.id === activeProjectId)?.name || 'Workspace local';
  renderSidebarProjects();
}

async function selectProject(id) {
  if (!id || id === activeProjectId) return;
  if (!confirmEditorWorkspaceSwitch()) { renderProjectSelector(); return; }
  try {
    const previousProjectId = activeProjectId;
    const data = await api(`/api/projects/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    projects = data.projects || [];
    activeProjectId = data.activeId || id;
    if (activeProjectId !== previousProjectId) resetEditorWorkspace();
    renderProjectSelector();
    renderProjects();
    await Promise.all([refreshSystem(), refreshHealth(), loadMemories(), loadFileTree()]);
    toast(`Projeto ativo alterado para: ${projects.find(p => p.id === activeProjectId)?.name || id}`);
    toast('🔍 Indexando símbolos do projeto em background…');
    api('/api/projects/' + encodeURIComponent(id) + '/index', { method: 'POST', body: '{}' })
      .then(r => toast(`📊 Índice atualizado: ${r.totalSymbols || 0} símbolo(s) encontrado(s).`))
      .catch(() => {});
  } catch (error) {
    renderProjectSelector();
    toast(error.message, true);
  }
}

async function submitProject(event) {
  event.preventDefault();
  const name = $('#proj-name')?.value.trim();
  const pathVal = $('#proj-path')?.value.trim();
  const desc = $('#proj-desc')?.value.trim();
  if (!name || !pathVal) {
    toast('Preencha o nome e caminho da pasta.', true);
    return;
  }
  if (!confirmEditorWorkspaceSwitch()) return;
  try {
    const previousProjectId = activeProjectId;
    const res = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, path: pathVal, description: desc }),
    });
    projects = res.projects || [];
    activeProjectId = res.activeId || activeProjectId;
    if (activeProjectId !== previousProjectId) resetEditorWorkspace();
    $('#project-form')?.reset();
    renderProjectSelector();
    renderProjects();
    await loadFileTree();
    toast('Projeto cadastrado com sucesso!');
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteProject(id) {
  const proj = projects.find(p => p.id === id);
  if (!confirm(`Excluir o projeto "${proj?.name || id}"? Os arquivos no disco NÃO serão apagados.`)) return;
  if (id === activeProjectId && !confirmEditorWorkspaceSwitch()) return;
  try {
    const previousProjectId = activeProjectId;
    const res = await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    projects = res.projects || [];
    activeProjectId = res.activeId || projects[0]?.id || '';
    if (activeProjectId !== previousProjectId) resetEditorWorkspace();
    renderProjectSelector();
    renderProjects();
    await loadFileTree();
    toast('Projeto removido.');
  } catch (error) {
    toast(error.message, true);
  }
}

function renderProjects() {
  const host = $('#project-list');
  if (!host) return;
  const countEl = $('#projects-count');
  if (countEl) countEl.textContent = projects.length + ' workspace(s)';

  host.innerHTML = projects.map(project => {
    const active = project.id === activeProjectId;
    const updated = project.lastUsedAt ? new Date(project.lastUsedAt).toLocaleDateString('pt-BR') : '';
    return '<article class="project-row' + (active ? ' active' : '') + '">' +
      '<span class="project-row-icon">' + (active ? '◉' : '▰') + '</span>' +
      '<div class="project-row-copy">' +
        '<strong>' + escapeHtml(project.name) + (active ? ' <span class="project-active-label">ATIVO</span>' : '') + '</strong>' +
        '<small>' + escapeHtml(project.path) + '</small>' +
        '<span>' + escapeHtml(project.description || 'Sem descrição') + (updated ? ' · Último uso ' + updated : '') + '</span>' +
      '</div>' +
      '<div class="project-row-actions">' +
        (active ? '<span class="project-active-check">✓</span>' : '<button type="button" class="button secondary small" data-activate-project="' + escapeHtml(project.id) + '">Abrir</button>') +
        (projects.length > 1 ? '<button type="button" class="button subtle-danger small" data-delete-project="' + escapeHtml(project.id) + '" title="Remover projeto">×</button>' : '') +
      '</div>' +
    '</article>';
  }).join('') || '<div class="empty-inline">Nenhum projeto cadastrado. Adicione uma pasta para começar.</div>';

  $$('[data-activate-project]', host).forEach(button => {
    button.addEventListener('click', () => void selectProject(button.dataset.activateProject));
  });
  $$('[data-delete-project]', host).forEach(button => {
    button.addEventListener('click', () => void deleteProject(button.dataset.deleteProject));
  });
}
// ============================================================
// Memória Multi-Nível (Global, Projeto, Sessão)
// ============================================================

async function loadMemories() {
  let query = '';
  if (currentMemoryFilter === 'project') query = `?level=project&projectId=${encodeURIComponent(activeProjectId)}`;
  else if (currentMemoryFilter === 'global') query = '?level=global';
  else if (currentMemoryFilter === 'session') query = '?level=session';
  const result = await api(`/api/memories${query}`);
  memories = result.memories || [];
  renderMemories();
}

function renderMemories() {
  const host = $('#memory-list');
  if (!host) return;
  const countEl = $('#memory-count');
  if (countEl) countEl.textContent = `${memories.length} memória(s) encontrada(s)`;
  host.innerHTML = memories.map(item => {
    const levelLabel = item.level === 'global' ? 'Global' : (item.level === 'project' ? 'Projeto' : 'Sessão');
    const levelClass = item.level === 'global' ? 'risk-low' : (item.level === 'project' ? 'risk-medium' : 'risk-high');
    const sourceLabel = item.source === 'agent' ? 'Agente' : (item.source === 'inference' ? 'Inferência' : 'Usuário');
    return `
      <article class="memory-card">
        <div class="memory-card-head">
          <div>
            <h4>${escapeHtml(item.title)}</h4>
            <small>${new Date(item.updatedAt || item.createdAt).toLocaleString('pt-BR')}</small>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <span class="risk-badge ${levelClass}">${escapeHtml(levelLabel)}</span>
            <span class="memory-tag">${escapeHtml(item.category)}</span>
            <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">(${escapeHtml(sourceLabel)})</span>
          </div>
        </div>
        <p>${escapeHtml(item.content)}</p>
        <div class="card-actions">
          <button class="button secondary small" data-delete-memory="${escapeHtml(item.id)}">Excluir</button>
        </div>
      </article>
    `;
  }).join('') || '<div class="empty-inline">Nenhuma memória encontrada.</div>';

  $$('[data-delete-memory]', host).forEach(button => button.addEventListener('click', () => deleteMemory(button.dataset.deleteMemory)));
}

async function saveMemory(event) {
  event.preventDefault();
  try {
    const level = $('#memory-level')?.value || 'project';
    await api('/api/memories', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#memory-title').value,
        category: $('#memory-category').value,
        content: $('#memory-content').value,
        level,
        projectId: activeProjectId,
        source: 'user',
      })
    });
    $('#memory-form').reset();
    await loadMemories();
    toast('Memória salva com sucesso.');
  } catch (error) { toast(error.message, true); }
}

async function deleteMemory(id) {
  if (!confirm('Excluir esta memória permanentemente?')) return;
  try {
    await api(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadMemories();
    toast('Memória excluída.');
  } catch (error) { toast(error.message, true); }
}

async function refreshSystem() {
  try {
    const result = await api('/api/health');
    const grid = $('#system-overview');
    if (grid) {
      grid.innerHTML = [
        ['NÚCLEO', result.name],
        ['VERSÃO', result.version],
        ['PORTA LOCAL', `${result.host}:${result.port}`],
        ['TEMPO ATIVO', `${result.uptimeSeconds}s`],
        ['WORKSPACE', result.workspace],
        ['SEGURANÇA', 'Loopback restrito'],
      ].map(([label, value]) => `<div class="system-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
    }
    const endpointEl = $('#openai-endpoint');
    if (endpointEl) endpointEl.textContent = `${location.origin}/v1`;
  } catch (error) {
    const grid = $('#system-overview');
    if (grid) grid.innerHTML = `<div class="empty-inline">Não foi possível consultar o núcleo: ${escapeHtml(error.message)}</div>`;
  }
}

// ============================================================
// Monitor em Tempo Real (SSE)
// ============================================================

function initMonitorIfNeeded() {
  if (monitorSSE) return;
  api('/api/monitor/events').then(data => {
    const events = Array.isArray(data.events) ? data.events : (Array.isArray(data) ? data : []);
    events.forEach(ev => {
      monitorEvents.push(ev);
      if (monitorEvents.length > 200) monitorEvents.shift();
    });
    renderMonitorFeed();
    renderMonitorStats();
    renderAgentTerminal();
  }).catch(() => undefined);

  function connect() {
    const sse = new EventSource('/api/monitor/stream');
    monitorSSE = sse;
    sse.onopen = () => {
      monitorConnected = true;
      $('#monitor-status')?.classList.add('online');
    };
    sse.onmessage = event => {
      let parsed;
      try { parsed = JSON.parse(event.data); } catch { return; }
      appendMonitorEvent(parsed);
    };
    sse.onerror = () => {
      monitorConnected = false;
      $('#monitor-status')?.classList.remove('online');
      sse.close();
      monitorSSE = null;
      window.setTimeout(connect, 3000);
    };
  }
  connect();
}

function appendMonitorEvent(event) {
  if (event?.type === 'monitor_cleared') {
    monitorEvents = [];
    renderMonitorFeed();
    renderMonitorStats();
    renderAgentTerminal();
    return;
  }
  monitorEvents.push(event);
  if (monitorEvents.length > 200) monitorEvents.shift();
  renderMonitorFeed();
  renderMonitorStats();
  renderAgentTerminal();
}

async function clearMonitorHistory() {
  const button = $('#monitor-clear');
  if (button) { button.disabled = true; button.textContent = 'Limpando…'; }
  try {
    await api('/api/monitor/clear', { method:'POST', body:'{}' });
    monitorEvents = [];
    renderMonitorFeed();
    renderMonitorStats();
    renderAgentTerminal();
    toast('Histórico de execução limpo.');
  } catch (error) {
    toast('Não foi possível limpar o histórico: ' + error.message, true);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Limpar eventos'; }
  }
}

function renderAgentTerminal() {
  const host = $('#agent-terminal-output');
  if (!host) return;
  const events = monitorEvents.filter(event => event.type === 'tool_result').slice(-35);
  if (!events.length) {
    host.textContent = '$ Aguardando comandos do agente...';
    return;
  }
  host.textContent = events.map(event => {
    const time = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('pt-BR') : '--:--:--';
    const status = event.isError ? 'ERRO' : 'OK';
    const duration = typeof event.durationMs === 'number' ? ' · ' + event.durationMs + ' ms' : '';
    const output = typeof event.output === 'string' && event.output.trim()
      ? event.output.slice(0, 6000)
      : '(sem saída capturada)';
    return '[' + time + '] ' + status + ' · ' + (event.tool || 'ferramenta') + duration + '\\n' + output;
  }).join('\\n\\n' + '─'.repeat(54) + '\\n\\n');
  host.scrollTop = host.scrollHeight;
}

function renderMonitorFeed() {
  const host = $('#monitor-feed');
  if (!host) return;
  if (!monitorEvents.length) {
    host.innerHTML = '<div class="empty-inline">Aguardando eventos do agente…</div>';
    return;
  }
  host.innerHTML = monitorEvents.slice(-60).reverse().map(ev => {
    const typeClass = ev.type === 'error' || (ev.type === 'tool_result' && ev.isError)
      ? 'risk-high'
      : ev.type === 'approval_requested'
      ? 'risk-medium'
      : 'risk-low';
    const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString('pt-BR') : '';
    let details = '';
    if (ev.type === 'tool_call') details = `<strong>${escapeHtml(ev.tool)}</strong> (${escapeHtml(ev.server)})`;
    else if (ev.type === 'tool_result') details = `<strong>${escapeHtml(ev.tool)}</strong> em ${ev.durationMs}ms`;
    else if (ev.type === 'token_usage') details = `${(ev.promptTokens || 0) + (ev.completionTokens || 0)} tokens`;
    else if (ev.type === 'workflow_step') details = `<strong>${escapeHtml(ev.specialist || 'agente')}</strong> · etapa ${Number(ev.stepIndex || 0) + 1}/${ev.totalSteps || 0} · ${escapeHtml(ev.status || '')}${ev.durationMs ? ` · ${ev.durationMs} ms` : ''}`;
    else if (ev.type === 'step_progress') details = `Passo ${ev.step}/${ev.maxSteps} · ${escapeHtml(ev.phase || '')}`;
    else if (ev.type === 'error') details = `<span style="color:var(--danger);">${escapeHtml(ev.error || 'Erro desconhecido')}</span>`;
    return `
      <div class="monitor-item">
        <span class="monitor-time">${escapeHtml(ts)}</span>
        <span class="risk-badge ${typeClass}">${escapeHtml(ev.type)}</span>
        <span class="monitor-details">${details}</span>
      </div>
    `;
  }).join('');
}

function renderMonitorStats() {
  const host = $('#monitor-stats');
  if (!host) return;
  const toolCalls = monitorEvents.filter(ev => ev.type === 'tool_call').length;
  const tokenEvents = monitorEvents.filter(ev => ev.type === 'token_usage');
  const totalTokens = tokenEvents.reduce((sum, ev) => sum + (ev.promptTokens || 0) + (ev.completionTokens || 0), 0);
  const toolResults = monitorEvents.filter(ev => ev.type === 'tool_result');
  const avgMs = toolResults.length ? Math.round(toolResults.reduce((sum, ev) => sum + (ev.durationMs || 0), 0) / toolResults.length) : 0;
  const errors = monitorEvents.filter(ev => ev.type === 'error' || (ev.type === 'tool_result' && ev.isError)).length;
  host.innerHTML = [
    ['Chamadas', toolCalls],
    ['Tokens', totalTokens],
    ['Tempo Médio (ms)', avgMs || '—'],
    ['Erros', errors],
  ].map(([label, val]) => `<div class="monitor-stat"><strong>${escapeHtml(String(val))}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

// ============================================================
// Diff Engine Visual
// ============================================================

function colorDiff(diffText) {
  return escapeHtml(diffText)
    .split('\n')
    .map(line => {
      if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="diff-add">${line}</span>`;
      if (line.startsWith('-') && !line.startsWith('---')) return `<span class="diff-del">${line}</span>`;
      if (line.startsWith('@@')) return `<span class="diff-hunk">${line}</span>`;
      if (line.startsWith('---') || line.startsWith('+++')) return `<span class="diff-header">${line}</span>`;
      return `<span class="diff-ctx">${line}</span>`;
    })
    .join('\n');
}

async function fetchDiffPreview(approvalId) {
  try {
    const data = await api(`/api/approvals/${encodeURIComponent(approvalId)}/preview`);
    if (data && data.diff) return data;
    return null;
  } catch { return null; }
}

function renderDiffInApproval(diffData) {
  const host = $('#approval-panel');
  if (!host) return;
  const existing = host.querySelector('.diff-details');
  if (existing) existing.remove();
  const riskHtml = diffData.risk
    ? `<span class="risk-badge risk-${escapeHtml(diffData.risk)}">${escapeHtml(diffData.risk.toUpperCase())}</span> `
    : '';
  const details = document.createElement('details');
  details.className = 'diff-details';
  details.innerHTML = `<summary style="cursor:pointer;font-size:11px;color:var(--accent);margin-top:10px;">${riskHtml}Diff das alterações (clique para expandir)</summary><pre class="diff-block">${colorDiff(diffData.diff)}</pre>`;
  host.appendChild(details);
}

// ============================================================
// Auto-Memory Extraction
// ============================================================

async function autoExtractMemories(conversationId) {
  const conversation = conversations.find(c => c.id === conversationId);
  if (!conversation || conversation.messages.length < 4) return;
  try {
    const res = await api('/api/memory/auto-extract', {
      method: 'POST',
      body: JSON.stringify({
        messages: conversation.messages.slice(-10),
        projectId: activeProjectId,
        sessionId: conversationId,
      })
    });
    if (res.extracted > 0) {
      toast(`💾 ${res.extracted} memória(s) extraída(s) automaticamente da conversa.`);
    }
  } catch { /* silencioso */ }
}

// ============================================================
// Auto-Orchestrator Complexity Check
// ============================================================

async function shouldUseOrchestrator(text) {
  try {
    const res = await api('/api/chat/complexity', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    return res.useOrchestrator && res.score >= 5;
  } catch { return false; }
}

// ============================================================
// Task Queue
// ============================================================

async function loadTaskQueue() {
  try {
    const res = await api('/api/tasks' + (activeProjectId ? '?projectId=' + encodeURIComponent(activeProjectId) : ''));
    taskQueueItems = res.tasks || [];
    renderTaskQueue(res.stats);
  } catch (error) { toast('Erro ao carregar fila: ' + error.message, true); }
}

function renderTaskQueue(stats) {
  const host = $('#task-queue-list');
  if (!host) return;
  const countEl = $('#task-queue-count');
  if (countEl) countEl.textContent = (stats?.total ?? taskQueueItems.length) + ' tarefa(s) · ' + (stats?.pending ?? 0) + ' pendente(s)';

  const statsHost = $('#task-queue-stats');
  if (statsHost) {
    const summary = stats || { pending:0, running:0, completed:0, failed:0 };
    statsHost.innerHTML = [
      ['Pendentes', summary.pending || 0],
      ['Executando', summary.running || 0],
      ['Concluídas', summary.completed || 0],
      ['Falhas', summary.failed || 0]
    ].map(item => '<div class="queue-stat"><strong>' + item[1] + '</strong><span>' + item[0] + '</span></div>').join('');
  }

  if (!taskQueueItems.length) {
    host.innerHTML = '<div class="empty-inline">Nenhuma tarefa na fila. Adicione uma missão acima.</div>';
    return;
  }

  const statusLabels = { pending:'Pendente', running:'Executando', completed:'Concluída', failed:'Falhou' };
  const roleLabels = { auto:'Orquestrador automático', orchestrator:'Orquestrador', coder:'Programador', researcher:'Pesquisador', reviewer:'Revisor', tester:'QA / Testador', architect:'Arquiteto', reverse_engineer:'Engenharia reversa' };
  host.innerHTML = taskQueueItems.slice().reverse().map(task => {
    const result = task.result ? '<details class="queue-result"><summary>Ver resultado</summary><pre>' + escapeHtml(task.result) + '</pre></details>' : '';
    const error = task.error ? '<div class="queue-error">' + escapeHtml(task.error) + '</div>' : '';
    const retry = task.status === 'failed' ? '<button class="button secondary small" data-retry-task="' + escapeHtml(task.id) + '">Tentar novamente</button>' : '';
    const remove = task.status !== 'running' ? '<button class="button subtle-danger small" data-remove-task="' + escapeHtml(task.id) + '" title="Remover tarefa">×</button>' : '';
    return '<article class="task-item" data-task-id="' + escapeHtml(task.id) + '">' +
      '<span class="task-item-status task-status-' + escapeHtml(task.status) + '"></span>' +
      '<div class="task-item-content"><div class="task-item-title">' + escapeHtml(task.instruction) + '</div>' +
      '<div class="task-item-meta">' + escapeHtml(statusLabels[task.status] || task.status) + ' · ' + escapeHtml(roleLabels[task.agentRole] || task.agentRole) + ' · ' + new Date(task.createdAt).toLocaleString('pt-BR') + '</div>' +
      error + result + '</div><div class="task-item-actions">' + retry + remove + '</div></article>';
  }).join('');

  $$('[data-remove-task]', host).forEach(button => button.addEventListener('click', async () => {
    try {
      await api('/api/tasks/' + encodeURIComponent(button.dataset.removeTask), { method:'DELETE' });
      await loadTaskQueue();
    } catch (error) { toast(error.message, true); }
  }));
  $$('[data-retry-task]', host).forEach(button => button.addEventListener('click', async () => {
    try {
      await api('/api/tasks/' + encodeURIComponent(button.dataset.retryTask) + '/retry', { method:'POST', body:'{}' });
      await loadTaskQueue();
      toast('Tarefa reenfileirada.');
    } catch (error) { toast(error.message, true); }
  }));
}

async function queueWorkflowTask() {
  const instruction = $('#workflow-task-input')?.value?.trim();
  if (!instruction) { toast('Descreva a missão antes de adicioná-la.', true); return; }
  const button = $('#queue-workflow-btn');
  if (button) { button.disabled = true; button.textContent = 'Adicionando…'; }
  try {
    await api('/api/tasks', {
      method:'POST',
      body:JSON.stringify({
        instruction,
        agentRole:$('#workflow-agent-role')?.value || 'auto',
        projectId:activeProjectId || undefined
      })
    });
    if ($('#workflow-task-input')) $('#workflow-task-input').value = '';
    await loadTaskQueue();
    toast('Missão adicionada à fila.');
  } catch (error) { toast('Não foi possível adicionar a missão: ' + error.message, true); }
  finally { if (button) { button.disabled = false; button.textContent = 'Adicionar à fila'; } }
}

async function runTaskQueue() {
  const button = $('#run-task-queue');
  if (button) { button.disabled = true; button.textContent = 'Executando…'; }
  try {
    const response = await api('/api/tasks/run', {
      method:'POST',
      body:JSON.stringify({ projectId:activeProjectId || undefined, providerId:activeProviderId || undefined })
    });
    await loadTaskQueue();
    const summary = response.stats || {};
    toast('Fila processada: ' + (summary.completed || 0) + ' concluída(s), ' + (summary.failed || 0) + ' falha(s).', (summary.failed || 0) > 0);
  } catch (error) {
    await loadTaskQueue();
    toast('Falha ao processar fila: ' + error.message, true);
  } finally { if (button) { button.disabled = false; button.textContent = 'Executar pendentes'; } }
}

async function clearTaskQueue() {
  if (!confirm('Remover todas as tarefas deste projeto, mantendo as tarefas globais e dos outros projetos?')) return;
  try {
    await api('/api/tasks/clear', { method:'POST', body:JSON.stringify({ projectId:activeProjectId || undefined }) });
    await loadTaskQueue();
    toast('Fila do projeto limpa.');
  } catch (error) { toast(error.message, true); }
}

// ============================================================
// Workspace do Agente
// ============================================================

function initWorkspace() {
  // O workspace operacional é alimentado pelo mesmo stream usado pela timeline.
  initMonitorIfNeeded();
  renderMonitorFeed();
  renderMonitorStats();
  renderAgentTerminal();
}

// ============================================================
// Wire up UI Events
// ============================================================

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));

$('#monitor-clear')?.addEventListener('click', clearMonitorHistory);

$('#sidebar-search')?.addEventListener('input', event => {
  sidebarSearchText = event.target.value || '';
  renderSidebarProjects();
  renderConversationList();
  if ($('#sidebar-search-clear')) $('#sidebar-search-clear').hidden = !sidebarSearchText;
});
$('#sidebar-search-clear')?.addEventListener('click', () => {
  sidebarSearchText = '';
  if ($('#sidebar-search')) $('#sidebar-search').value = '';
  $('#sidebar-search-clear').hidden = true;
  renderSidebarProjects();
  renderConversationList();
});
$('#sidebar-add-project')?.addEventListener('click', () => {
  setView('projects');
  if ($('#project-form-wrap')) $('#project-form-wrap').hidden = false;
  window.setTimeout(() => $('#proj-name')?.focus(), 0);
});
$('#add-project-button')?.addEventListener('click', () => {
  const wrap = $('#project-form-wrap');
  if (wrap) wrap.hidden = !wrap.hidden;
  if (wrap && !wrap.hidden) $('#proj-name')?.focus();
});
$('#close-project-form')?.addEventListener('click', () => {
  if ($('#project-form-wrap')) $('#project-form-wrap').hidden = true;
});
$('#sidebar-collapse')?.addEventListener('click', () => {
  document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed');
});
$('#new-chat-side')?.addEventListener('click', createConversation);
$('#new-chat-top')?.addEventListener('click', createConversation);
$('#chat-form')?.addEventListener('submit', sendMessage);
$('#chat-input')?.addEventListener('input', autoResizeInput);
$('#chat-input')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage(event);
  }
});
$('#chat-attach')?.addEventListener('change', event => {
  void addAttachmentFiles(event.target.files);
  event.target.value = '';
});
$('#chat-input')?.addEventListener('paste', event => {
  const items = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && ALLOWED_ATTACHMENT_TYPES.has(item.type));
  if (!items.length) return;
  event.preventDefault();
  void addAttachmentFiles(items.map(item => item.getAsFile()).filter(Boolean));
});

let dragDepth = 0;
const composerForm = $('#chat-form');
if (composerForm) {
  composerForm.addEventListener('dragenter', event => { event.preventDefault(); dragDepth += 1; setDragActive(true); });
  composerForm.addEventListener('dragover', event => event.preventDefault());
  composerForm.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) setDragActive(false); });
  composerForm.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0; setDragActive(false);
    void addAttachmentFiles(event.dataTransfer?.files);
  });
}

$('#chat-provider')?.addEventListener('change', event => {
  activeProviderId = event.target.value;
  const provider = providers.find(item => item.id === activeProviderId);
  activeModelId = localStorage.getItem('godmode-model:' + activeProviderId) || provider?.model || '';
  if ($('#chat-model')) $('#chat-model').value = activeModelId;
  void loadProviderModelCatalog(activeProviderId, true);
});
$('#chat-model')?.addEventListener('input', event => setActiveChatModel(event.target.value));
$('#chat-model')?.addEventListener('change', event => setActiveChatModel(event.target.value));
$('#refresh-chat-models')?.addEventListener('click', () => void loadProviderModelCatalog(activeProviderId, true));
$$('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  $('#chat-input').value = button.dataset.prompt;
  autoResizeInput();
  $('#chat-input').focus();
}));

$('#add-provider')?.addEventListener('click', () => openProviderForm());
$('#setup-omniroute')?.addEventListener('click', setupOmniRouteProvider);
$('#close-provider-form')?.addEventListener('click', () => { $('#provider-form-wrap').hidden = true; });
$('#provider-form')?.addEventListener('submit', submitProvider);
$('#discover-models')?.addEventListener('click', async () => {
  const id = $('#provider-id').value.trim().toLowerCase();
  if (!providers.some(item => item.id === id)) {
    toast('Salve o provedor primeiro para buscar os modelos. Você pode digitar um ID manualmente.', true);
    return;
  }
  await discoverProvider(id);
});

$('#import-mcp')?.addEventListener('click', importMcp);
$('#connect-all-mcp')?.addEventListener('click', async () => {
  const count = servers.filter(item => item.command && item.enabled !== false && !item.connected).length;
  if (!confirm(`Conectar todos os servidores MCP habilitados (${count})?`)) return;
  try {
    const result = await api('/api/mcp/servers/connect-all', { method: 'POST', body: '{}' });
    await loadPluginManager();
    const failed = result.results.filter(item => !item.ok);
    toast(failed.length ? `${failed.length} servidores não conectaram.` : 'Todos os servidores conectados.');
  } catch (error) { toast(error.message, true); }
});

$('#project-selector')?.addEventListener('change', event => { selectProject(event.target.value); });
$('#project-form')?.addEventListener('submit', submitProject);

$$('.memory-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.memory-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMemoryFilter = btn.dataset.filter || 'all';
    loadMemories();
  });
});
$('#memory-form')?.addEventListener('submit', saveMemory);
$('#refresh-system')?.addEventListener('click', refreshSystem);
$('#copy-endpoint')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/v1`);
    toast('Endpoint local copiado!');
  } catch {
    toast('Não foi possível copiar o endpoint.', true);
  }
});

// Workbench editor, tabs, quick search and command palette.
$('#refresh-file-tree')?.addEventListener('click', loadFileTree);
$('#editor-save-btn')?.addEventListener('click', saveCurrentFile);
$('#file-editor-textarea')?.addEventListener('input', () => {
  const textarea = $('#file-editor-textarea');
  const tab = openEditorTabs.find(item => item.path === currentOpenFile);
  if (tab && textarea) {
    tab.content = textarea.value;
    tab.dirty = tab.content !== tab.savedContent;
    if ($('#editor-save-btn')) $('#editor-save-btn').disabled = !tab.dirty;
    renderEditorTabs();
  }
  updateEditorGutter();
});
$('#file-editor-textarea')?.addEventListener('scroll', updateEditorGutter);
$('#file-editor-textarea')?.addEventListener('click', updateEditorPosition);
$('#file-editor-textarea')?.addEventListener('keyup', updateEditorPosition);
$('#file-editor-textarea')?.addEventListener('keydown', event => {
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const field = event.currentTarget;
    field.setRangeText('  ', field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
$('#editor-tabs')?.addEventListener('click', event => {
  const close = event.target.closest('[data-close-editor-tab]');
  if (close) { event.stopPropagation(); closeEditorTab(close.dataset.closeEditorTab); return; }
  const tab = event.target.closest('[data-editor-tab-path]');
  if (tab) void openFile(tab.dataset.editorTabPath);
});
$('#file-tree-search')?.addEventListener('input', event => filterFileTree(event.target.value));
$('#workflow-form')?.addEventListener('submit', runMultiAgentWorkflow);
$('#import-claude-btn')?.addEventListener('click', syncClaudePlugins);


// IDE command center and keyboard shortcuts.
$('#command-center-button')?.addEventListener('click', openCommandPalette);
$('#command-palette-input')?.addEventListener('input', () => { commandPaletteSelection = 0; renderCommandPalette(); });
$('#command-palette-results')?.addEventListener('click', event => {
  const command = event.target.closest('[data-command-id]');
  if (command) executeWorkbenchCommand(command.dataset.commandId);
});
$('#command-palette-results')?.addEventListener('mousemove', event => {
  const row = event.target.closest('[data-command-id]');
  if (!row) return;
  const rows = $$('[data-command-id]', $('#command-palette-results'));
  commandPaletteSelection = rows.indexOf(row);
  rows.forEach((item, index) => item.classList.toggle('active', index === commandPaletteSelection));
});
$$('[data-close-palette]').forEach(node => node.addEventListener('click', closeCommandPalette));
$('#toggle-sidebar')?.addEventListener('click', () => {
  document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed');
});
document.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  const palette = $('#command-palette');
  if (palette && !palette.hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = $$('[data-command-id]', $('#command-palette-results'));
      if (!rows.length) return;
      commandPaletteSelection = (commandPaletteSelection + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((row, index) => row.classList.toggle('active', index === commandPaletteSelection));
      rows[commandPaletteSelection]?.scrollIntoView({ block:'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = $$('[data-command-id]', $('#command-palette-results'))[commandPaletteSelection];
      if (row) executeWorkbenchCommand(row.dataset.commandId);
      return;
    }
  }
  if (modifier && event.shiftKey && key === 'p') { event.preventDefault(); openCommandPalette(); return; }
  if (modifier && key === 'k' && $('#sidebar-search')) { event.preventDefault(); $('#sidebar-search').focus(); return; }
  if (modifier && event.shiftKey && key === 'o') { event.preventDefault(); createConversation(); return; }
  if (modifier && key === '1') { event.preventDefault(); setView('chat'); return; }
  if (modifier && key === '2') { event.preventDefault(); setView('files'); return; }
  if (modifier && key === 's' && currentOpenFile && $('#view-files')?.classList.contains('active')) {
    event.preventDefault();
    void saveCurrentFile();
  }
});

// Mission center, task queue, QA runner and execution console.
$('#queue-workflow-btn')?.addEventListener('click', queueWorkflowTask);
$('#run-task-queue')?.addEventListener('click', runTaskQueue);
$('#clear-task-queue')?.addEventListener('click', clearTaskQueue);
$('#test-config-form')?.addEventListener('submit', saveTestRunnerConfig);
$$('[data-run-suite]').forEach(button => button.addEventListener('click', () => runProjectSuite(button.dataset.runSuite, button)));
$$('[data-plugin-tab]').forEach(button => button.addEventListener('click', () => {
  pluginTab = button.dataset.pluginTab || 'discover';
  selectedPluginKey = '';
  renderPluginManager();
}));
$('#plugin-search')?.addEventListener('input', event => {
  pluginSearchText = event.target.value || '';
  selectedPluginKey = '';
  renderPluginManager();
});
$('#plugin-refresh')?.addEventListener('click', () => void loadPluginManager());
$('#plugin-entry-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-plugin-select]');
  if (!button) return;
  selectedPluginKey = button.dataset.pluginSelect;
  renderPluginManager();
});
$('#plugin-detail-panel')?.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-plugin-show-discover')) {
    pluginTab = 'discover';
    selectedPluginKey = '';
    renderPluginManager();
    return;
  }
  if (button.hasAttribute('data-plugin-install')) void performPluginAction('install', button.dataset.pluginInstall);
  else if (button.hasAttribute('data-plugin-toggle')) void performPluginAction('toggle', button.dataset.pluginToggle, button.dataset.enabled === 'true');
  else if (button.hasAttribute('data-plugin-connect')) void performPluginAction('connect', button.dataset.pluginConnect);
  else if (button.hasAttribute('data-plugin-disconnect')) void performPluginAction('disconnect', button.dataset.pluginDisconnect);
  else if (button.hasAttribute('data-plugin-remove')) void performPluginAction('remove', button.dataset.pluginRemove);
});
$('#mcp-resources-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-read-resource]');
  if (button) void inspectMcpResource(button.dataset.server, button.dataset.uri);
});
$('#mcp-prompts-list')?.addEventListener('click', event => {
  const button = event.target.closest('[data-get-prompt]');
  if (button) void inspectMcpPrompt(button.dataset.server, button.dataset.promptName);
});



async function init() {
  if (!conversations.length) createConversation();
  else if (!conversations.some(item => item.id === activeConversationId)) activeConversationId = conversations[0].id;

  renderConversationList();
  renderChat();

  try {
    await Promise.all([
      loadProjects(),
      loadProviders(),
      loadMemories(),
      refreshSystem(),
      refreshHealth(),
      loadFileTree(),
      loadSpecialists(),
      loadPluginManager(),
      loadTaskQueue()
    ]);

    // Auto-setup de MCPs gratuitos na inicialização
    api('/api/setup/run', { method: 'POST', body: '{}' })
      .then(r => {
        if (!r.alreadyDone && r.registered?.length > 0) {
          toast(`⚡ ${r.registered.length} servidores MCP gratuitos configurados automaticamente.`);
        }
      })
      .catch(() => {});
  } catch (error) {
    toast(error.message, true);
  }
  window.setInterval(refreshHealth, 15000);
}

init();
