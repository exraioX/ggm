'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STORE_KEY = 'godmode-core-conversations-v1';
const VIEW_TITLES = { chat: 'Conversas', projects: 'Gerenciador de Projetos', providers: 'Provedores de IA', mcp: 'Integrações MCP', memory: 'Memória Multi-Nível', settings: 'Sistema', monitor: 'Monitor' };
let projects = [];
let activeProjectId = '';
let currentMemoryFilter = 'all';
let providers = [];
let servers = [];
let tools = [];
let resources = [];
let prompts = [];
let memories = [];
let activeProviderId = '';
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
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_SOURCE_BYTES = 12 * 1024 * 1024; // limite do arquivo original, antes de redimensionar
const ATTACHMENT_MAX_DIMENSION = 1280; // imagens maiores são reduzidas antes de anexar
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
  } catch (error) {
    // Provavelmente QuotaExceededError (ex.: muitas imagens anexadas salvas no navegador).
    toast('O histórico ficou grande demais para o armazenamento do navegador. Considere excluir conversas antigas com imagens.', true);
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
  if (!response.ok) throw new Error(payload?.error || payload?.message || `Falha HTTP ${response.status}`);
  return payload;
}
function setView(view) {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
  $('#page-title').textContent = VIEW_TITLES[view] || 'GODMODE CORE';
  $('#breadcrumb').textContent = `GODMODE CORE / ${(VIEW_TITLES[view] || view).toUpperCase()}`;
  if (view === 'projects') renderProjects();
  if (view === 'providers') renderProviders();
  if (view === 'mcp') { renderServers(); renderTools(); renderMcpCapabilities(); }
  if (view === 'memory') renderMemories();
  if (view === 'settings') refreshSystem();
  if (view === 'monitor') initMonitorIfNeeded();
}
function createConversation() {
  const conversation = { id: crypto.randomUUID(), title: 'Nova conversa', messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  conversations.unshift(conversation);
  activeConversationId = conversation.id;
  pendingAttachments = []; renderAttachments();
  saveConversations();
  renderConversationList();
  renderChat();
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
  host.innerHTML = conversations.map(item => `
    <div class="conversation-item ${item.id === activeConversationId ? 'active' : ''}" data-conversation="${escapeHtml(item.id)}">
      <span>◦</span><span class="conv-name">${escapeHtml(item.title || 'Nova conversa')}</span>
      <button class="delete-conv" data-delete-conversation="${escapeHtml(item.id)}" title="Excluir conversa" aria-label="Excluir conversa">×</button>
    </div>`).join('');
  $$('.conversation-item', host).forEach(node => node.addEventListener('click', event => {
    if (event.target.closest('[data-delete-conversation]')) return;
    activeConversationId = node.dataset.conversation;
    pendingAttachments = []; renderAttachments();
    saveConversations(); renderConversationList(); renderChat();
  }));
  $$('[data-delete-conversation]', host).forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    if (confirm('Excluir esta conversa deste navegador?')) deleteConversation(button.dataset.deleteConversation);
  }));
}
function renderChat() {
  const conversation = activeConversation();
  $('#active-chat-title').textContent = conversation?.title || 'Nova conversa';
  const messages = conversation?.messages || [];
  $('#chat-empty').classList.toggle('hidden', messages.length > 0);
  $('#chat-messages').innerHTML = messages.map(message => `
    <article class="message ${message.role === 'user' ? 'user' : 'assistant'}">
      <div class="message-avatar">${message.role === 'user' ? 'EU' : 'G'}</div>
      <div class="message-body"><div class="message-meta">${message.role === 'user' ? 'VOCÊ' : 'GODMODE'}</div>${escapeHtml(message.content).replace(/\n/g, '<br>')}${Array.isArray(message.attachments) && message.attachments.length ? `<div class="message-attachments">${message.attachments.map(attachment => `<img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name || 'imagem anexada')}">`).join('')}</div>` : ''}</div>
    </article>`).join('');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
  const approvalBelongsHere = Boolean(pendingApproval && pendingApprovalConversationId === activeConversationId);
  $('#approval-panel').hidden = !approvalBelongsHere;
  $('#send-button').disabled = isSending || Boolean(pendingApproval);
  if (approvalBelongsHere) renderApproval(pendingApproval);
}
function updateProviderSelect() {
  const select = $('#chat-provider');
  const usable = providers.filter(item => item.enabled !== false);
  if (!usable.length) {
    select.innerHTML = '<option value="">Nenhum provedor cadastrado</option>';
    activeProviderId = '';
    return;
  }
  if (!usable.some(item => item.id === activeProviderId)) activeProviderId = usable[0].id;
  select.innerHTML = usable.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ' · configure um modelo'}</option>`).join('');
  select.value = activeProviderId;
}
async function loadProviders() {
  const result = await api('/api/providers');
  providers = result.providers || [];
  updateProviderSelect();
  renderProviders();
}
async function refreshHealth() {
  try {
    const result = await api('/api/health');
    $('#gateway-indicator').classList.add('online');
    $('#gateway-status').textContent = `Ativo · ${result.port}`;
  } catch {
    $('#gateway-indicator').classList.remove('online');
    $('#gateway-status').textContent = 'Sem conexão';
  }
}
function renderProviders() {
  const host = $('#provider-cards');
  if (!host) return;
  host.innerHTML = providers.map(item => `
    <article class="provider-card">
      <div class="provider-card-head"><div><div class="provider-name">${escapeHtml(item.name)}</div><div class="provider-kind">${item.kind === 'openrouter' ? 'OpenRouter' : 'API compatível com OpenAI'}</div></div><span class="status-pill ${item.model ? '' : 'off'}">${item.model ? 'Modelo definido' : 'Configuração pendente'}</span></div>
      <div class="provider-url">${escapeHtml(item.baseUrl)}</div>
      <div class="provider-model">Modelo: ${escapeHtml(item.model || 'não selecionado')}</div>
      <div class="provider-kind">${item.hasSecret ? 'Chave carregada na memória do núcleo' : (item.kind === 'openrouter' ? 'Chave ainda não configurada' : 'Não exige chave por padrão')}</div>
      <div class="card-actions"><button class="button secondary small" data-edit-provider="${escapeHtml(item.id)}">Configurar</button><button class="button secondary small" data-discover-provider="${escapeHtml(item.id)}">Buscar modelos</button><button class="button secondary small" data-delete-provider="${escapeHtml(item.id)}">Excluir</button>${item.hasSecret ? `<button class="button secondary small" data-clear-secret="${escapeHtml(item.id)}">Remover chave</button>` : ""}</div>
    </article>`).join('') || '<div class="empty-inline">Nenhum provedor cadastrado.</div>';
  $$('[data-edit-provider]', host).forEach(button => button.addEventListener('click', () => editProvider(button.dataset.editProvider)));
  $$('[data-discover-provider]', host).forEach(button => button.addEventListener('click', () => discoverProvider(button.dataset.discoverProvider)));
  $$('[data-delete-provider]', host).forEach(button => button.addEventListener('click', () => removeProvider(button.dataset.deleteProvider)));
  $$('[data-clear-secret]', host).forEach(button => button.addEventListener('click', () => clearProviderSecret(button.dataset.clearSecret)));
  updateProviderSelect();
}
function openProviderForm(provider = null) {
  editingProviderId = provider?.id || null;
  $('#provider-form-title').textContent = provider ? `Editar ${provider.name}` : 'Adicionar provedor';
  $('#provider-id').value = provider?.id || '';
  $('#provider-id').disabled = Boolean(provider);
  $('#provider-name').value = provider?.name || '';
  $('#provider-kind').value = provider?.kind || 'openai-compatible';
  $('#provider-url').value = provider?.baseUrl || 'http://127.0.0.1:11434/v1';
  $('#provider-model').value = provider?.model || '';
  $('#provider-secret').value = '';
  $('#discovered-models').innerHTML = '';
  $('#provider-form-wrap').hidden = false;
  $('#provider-name').focus();
}
function editProvider(id) { const provider = providers.find(item => item.id === id); if (provider) openProviderForm(provider); }
async function removeProvider(id) {
  if (!confirm(`Excluir o provedor "${id}"?`)) return;
  try { const result = await api(`/api/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }); providers = result.providers; renderProviders(); toast('Provedor removido.'); }
  catch (error) { toast(error.message, true); }
}
async function discoverProvider(id) {
  try {
    const result = await api(`/api/providers/${encodeURIComponent(id)}/models`);
    const provider = providers.find(item => item.id === id);
    openProviderForm(provider || null);
    showModelOptions(result.models || []);
  } catch (error) { toast(error.message, true); }
}
function showModelOptions(models) {
  const host = $('#discovered-models');
  host.innerHTML = models.length ? `<div class="muted-note">Modelos encontrados — clique para selecionar:</div>${models.slice(0, 80).map(model => `<button class="model-option" type="button" data-model-option="${escapeHtml(model)}">${escapeHtml(model)}</button>`).join('')}` : '<span class="muted-note">Nenhum modelo foi listado. Você ainda pode digitar o identificador manualmente.</span>';
  $$('[data-model-option]', host).forEach(button => button.addEventListener('click', () => { $('#provider-model').value = button.dataset.modelOption; }));
}
async function clearProviderSecret(id) {
  if (!confirm('Remover a chave deste provedor da memória do núcleo?')) return;
  try { await api(`/api/providers/${encodeURIComponent(id)}/secret`, { method: 'POST', body: JSON.stringify({ secret: '' }) }); await loadProviders(); toast('Chave removida da memória do núcleo.'); }
  catch (error) { toast(error.message, true); }
}
async function submitProvider(event) {
  event.preventDefault();
  const id = $('#provider-id').value.trim().toLowerCase();
  const data = { id, name: $('#provider-name').value.trim(), kind: $('#provider-kind').value, baseUrl: $('#provider-url').value.trim(), model: $('#provider-model').value.trim(), enabled: true };
  const secret = $('#provider-secret').value;
  try {
    await api('/api/providers', { method: 'POST', body: JSON.stringify(data) });
    if (secret.trim()) await api(`/api/providers/${encodeURIComponent(id)}/secret`, { method: 'POST', body: JSON.stringify({ secret }) });
    $('#provider-secret').value = '';
    await loadProviders();
    activeProviderId = id; updateProviderSelect();
    $('#provider-form-wrap').hidden = true;
    toast('Provedor salvo.');
  } catch (error) { toast(error.message, true); }
}
function messagesForModel(messages) {
  const selected = [];
  let remaining = 90000;
  let imageBudget = 6; // reenviar no máx. 6 imagens no histórico, para não inflar cada chamada
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
  if (!provider.model) { toast('Configure o identificador do modelo antes de conversar.', true); setView('providers'); editProvider(provider.id); return; }
  const text = $('#chat-input').value.trim();
  if (!text && !pendingAttachments.length) return;
  if (!activeConversation()) createConversation();
  const conversation = activeConversation();
  const conversationId = conversation.id;
  const attachments = pendingAttachments.slice();
  const message = { role: 'user', content: text, createdAt: new Date().toISOString() };
  if (attachments.length) message.attachments = attachments;
  conversation.messages.push(message);
  if (conversation.messages.length === 1) conversation.title = (text || `${attachments.length} imagem(ns)`).slice(0, 46) + (text.length > 46 ? '…' : '');
  conversation.updatedAt = new Date().toISOString();
  $('#chat-input').value = '';
  pendingAttachments = [];
  renderAttachments();
  autoResizeInput();
  saveConversations(); renderConversationList(); renderChat();
  isSending = true; setSendState(true);
  const typing = document.createElement('div'); typing.className = 'typing'; typing.textContent = 'GODMODE está pensando…'; $('#chat-messages').append(typing);
  try {
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ providerId: activeProviderId, projectId: activeProjectId, messages: messagesForModel(conversation.messages), toolsEnabled: $('#tools-toggle').checked }) });
    typing.remove(); handleAgentResult(result, conversationId);
  } catch (error) {
    typing.remove();
    conversation.messages.push({ role: 'assistant', content: `Não foi possível concluir a solicitação: ${error.message}` });
    saveConversations(); renderChat();
    toast(error.message, true);
  } finally { isSending = false; setSendState(false); }
}
function setSendState(value) {
  const blocked = value || Boolean(pendingApproval);
  $('#send-button').disabled = blocked;
  $('#send-button').querySelector('span:first-child').textContent = value ? 'Aguarde' : pendingApproval ? 'Aprovação' : 'Enviar';
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
  }
  pendingApproval = null;
  pendingApprovalConversationId = '';
  renderChat();
}

function renderApproval(approval) {
  const host = $('#approval-panel');
  host.hidden = false;
  host.innerHTML = `<div class="approval-title">⛨ Aprovação necessária · ${escapeHtml(approval.tool)}</div><div class="approval-desc">${escapeHtml(approval.description || approval.message || 'A ferramenta solicitou uma ação que exige confirmação.')}</div><pre class="approval-code">${escapeHtml(JSON.stringify(approval.arguments || {}, null, 2))}</pre><div class="approval-actions"><button class="button approve" id="approve-action">Aprovar e continuar</button><button class="button reject" id="reject-action">Rejeitar ação</button></div>`;
  $('#approve-action').addEventListener('click', () => decideApproval(true));
  $('#reject-action').addEventListener('click', () => decideApproval(false));
  // Async diff preview — does not block panel display
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
  } catch (error) { toast(error.message, true); $$('.approval-actions button').forEach(button => { button.disabled = false; }); }
}
function autoResizeInput() {
  const input = $('#chat-input'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

// --- Anexos de imagem (arrastar e soltar, colar ou escolher arquivo) ---
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
// Reduz imagens grandes para no máximo ATTACHMENT_MAX_DIMENSION px antes de anexar,
// o que mantém a conversa salva no navegador pequena e o envio ao modelo rápido.
// GIFs são preservados como estão para não perder a animação.
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
    if (pendingAttachments.length >= MAX_ATTACHMENTS) { toast(`Você pode anexar no máximo ${MAX_ATTACHMENTS} imagens por mensagem.`, true); break; }
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) { toast(`Tipo de arquivo não suportado: ${file.name || file.type}. Use PNG, JPEG, WEBP ou GIF.`, true); continue; }
    if (file.size > MAX_ATTACHMENT_SOURCE_BYTES) { toast(`"${file.name}" é muito grande (máx. ${(MAX_ATTACHMENT_SOURCE_BYTES / 1024 / 1024).toFixed(0)}MB).`, true); continue; }
    try {
      const { dataUrl, mimeType } = await prepareAttachment(file);
      pendingAttachments.push({ name: file.name || 'imagem', mimeType, dataUrl });
    } catch (error) { toast(`Não foi possível anexar "${file.name}": ${error.message}`, true); }
  }
  renderAttachments();
}
function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderAttachments();
}
function renderAttachments() {
  const host = $('#attachment-list');
  host.hidden = !pendingAttachments.length;
  host.innerHTML = pendingAttachments.map((attachment, index) => `
    <div class="attachment-chip">
      <img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name)}">
      <span class="attachment-name">${escapeHtml(attachment.name)}</span>
      <button type="button" class="attachment-remove" data-remove-attachment="${index}" title="Remover anexo" aria-label="Remover anexo">×</button>
    </div>`).join('');
  $$('[data-remove-attachment]', host).forEach(button => button.addEventListener('click', () => removeAttachment(Number(button.dataset.removeAttachment))));
}
function setDragActive(active) {
  $('#chat-form').classList.toggle('drag-active', active);
  $('#drop-overlay').hidden = !active;
}
async function loadMcp() {
  try {
    const [serversResult, toolsResult, resourcesResult, promptsResult] = await Promise.all([
      api('/api/mcp/servers'), api('/api/mcp/tools'), api('/api/mcp/resources'), api('/api/mcp/prompts'),
    ]);
    servers = serversResult.servers || [];
    tools = toolsResult.tools || [];
    resources = resourcesResult.resources || [];
    prompts = promptsResult.prompts || [];
    renderServers(); renderTools(); renderMcpCapabilities();
  } catch (error) { toast(`Falha ao consultar MCP: ${error.message}`, true); }
}
function renderServers() {
  const host = $('#mcp-server-list'); if (!host) return;
  host.innerHTML = servers.map(server => `
    <article class="mcp-card">
      <div class="mcp-card-head"><div><div class="mcp-name">${escapeHtml(server.name)}</div><div class="mcp-subline">${escapeHtml(server.transport || (server.command ? 'stdio' : 'HTTP'))} · ${server.command ? escapeHtml(server.command) : escapeHtml(server.url || '')}</div>${server.args?.length ? `<div class="mcp-subline">Argumentos: ${escapeHtml(server.args.join(' '))}</div>` : ''}${server.cwd ? `<div class="mcp-subline">Pasta: ${escapeHtml(server.cwd)}</div>` : ''}</div><span class="status-pill ${server.connected ? '' : 'off'}">${server.connected ? 'Conectado' : server.enabled === false ? 'Desativado' : 'Desconectado'}</span></div>
      <div class="mcp-description">${escapeHtml(server.description || 'Servidor MCP configurado pelo usuário.')}</div>
      <div class="mcp-subline">${server.connected ? `${server.tools} ferramenta(s) disponíveis` : (server.error ? escapeHtml(server.error) : 'A conexão só inicia quando você solicitar.')}</div>
      <div class="card-actions">${server.connected ? `<button class="button secondary small" data-disconnect-mcp="${escapeHtml(server.name)}">Desconectar</button>` : `<button class="button primary small" data-connect-mcp="${escapeHtml(server.name)}" ${server.enabled === false ? 'disabled' : ''}>Conectar</button>`}<button class="button secondary small" data-remove-mcp="${escapeHtml(server.name)}">Remover</button></div>
    </article>`).join('') || '<div class="empty-inline">Nenhum servidor configurado. Importe um JSON do Claude Desktop ou de outro cliente MCP.</div>';
  $$('[data-connect-mcp]', host).forEach(button => button.addEventListener('click', () => connectMcp(button.dataset.connectMcp)));
  $$('[data-disconnect-mcp]', host).forEach(button => button.addEventListener('click', () => disconnectMcp(button.dataset.disconnectMcp)));
  $$('[data-remove-mcp]', host).forEach(button => button.addEventListener('click', () => removeMcp(button.dataset.removeMcp)));
}
function renderTools() {
  const host = $('#mcp-tools-list'); if (!host) return;
  $('#tools-count').textContent = `${tools.length} ferramenta(s)`;
  host.innerHTML = tools.map(tool => `<div class="tool-row"><div><strong>${escapeHtml(tool.server)} / ${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.description || 'Sem descrição fornecida pelo servidor.')}</small></div><span class="tool-approval">${tool.requiresApproval ? '◉ Aprovação' : '○ Leitura'}</span></div>`).join('') || '<div class="empty-inline">Conecte um servidor MCP para descobrir suas ferramentas.</div>';
}
function renderMcpCapabilities() {
  const resourceHost = $('#mcp-resources-list');
  const promptHost = $('#mcp-prompts-list');
  if (!resourceHost || !promptHost) return;
  $('#resources-count').textContent = `${resources.length} recurso(s)`;
  $('#prompts-count').textContent = `${prompts.length} prompt(s)`;
  resourceHost.innerHTML = resources.map(resource => `<article class="capability-row"><div><strong>${escapeHtml(resource.name || resource.uri)}</strong><small>${escapeHtml(resource.server)} · ${escapeHtml(resource.mimeType || 'tipo não informado')}</small><small>${escapeHtml(resource.description || resource.uri || '')}</small></div><button class="button secondary small" data-read-resource="${escapeHtml(resource.uri)}" data-resource-server="${escapeHtml(resource.server)}">Ler</button></article>`).join('') || '<div class="empty-inline">Nenhum recurso anunciado pelos servidores conectados.</div>';
  promptHost.innerHTML = prompts.map(promptItem => `<article class="capability-row"><div><strong>${escapeHtml(promptItem.name)}</strong><small>${escapeHtml(promptItem.server)} · ${(promptItem.arguments || []).length} argumento(s)</small><small>${escapeHtml(promptItem.description || 'Prompt oferecido pelo servidor.')}</small></div><button class="button secondary small" data-get-prompt="${escapeHtml(promptItem.name)}" data-prompt-server="${escapeHtml(promptItem.server)}">Abrir</button></article>`).join('') || '<div class="empty-inline">Nenhum prompt anunciado pelos servidores conectados.</div>';
  $$('[data-read-resource]', resourceHost).forEach(button => button.addEventListener('click', () => readMcpResource(button.dataset.resourceServer, button.dataset.readResource)));
  $$('[data-get-prompt]', promptHost).forEach(button => button.addEventListener('click', () => getMcpPrompt(button.dataset.promptServer, button.dataset.getPrompt)));
}
function showMcpOutput(title, payload) {
  $('#mcp-output-title').textContent = title;
  let serialized;
  try { serialized = JSON.stringify(payload, null, 2); } catch { serialized = String(payload); }
  $('#mcp-output-body').textContent = (serialized || String(payload)).slice(0, 50000);
  $('#mcp-output-panel').hidden = false;
  $('#mcp-output-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function readMcpResource(server, uri) {
  try {
    const result = await api('/api/mcp/resources/read', { method: 'POST', body: JSON.stringify({ server, uri }) });
    showMcpOutput(`Recurso: ${server} · ${uri}`, result.result);
  } catch (error) { toast(`Não foi possível ler o recurso: ${error.message}`, true); }
}
async function getMcpPrompt(server, name) {
  const spec = prompts.find(item => item.server === server && item.name === name);
  const declared = (spec?.arguments || []).filter(item => item.required).map(item => item.name);
  let raw = '{}';
  if ((spec?.arguments || []).length) {
    raw = window.prompt(`Argumentos JSON para ${name}${declared.length ? `\nObrigatórios: ${declared.join(', ')}` : ''}`, '{}');
    if (raw === null) return;
  }
  let args;
  try { args = JSON.parse(raw); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Informe um objeto JSON.'); }
  catch (error) { toast(`Argumentos inválidos: ${error.message}`, true); return; }
  try {
    const result = await api('/api/mcp/prompts/get', { method: 'POST', body: JSON.stringify({ server, name, arguments: args }) });
    showMcpOutput(`Prompt MCP: ${server} · ${name}`, result.result);
  } catch (error) { toast(`Não foi possível obter o prompt: ${error.message}`, true); }
}
async function importMcp() {
  const text = $('#mcp-config').value.trim();
  if (!text) { toast('Cole a configuração JSON antes de importar.', true); return; }
  let config;
  try { config = JSON.parse(text); } catch (error) { toast(`JSON inválido: ${error.message}`, true); return; }
  try {
    const result = await api('/api/mcp/import', { method: 'POST', body: JSON.stringify(config) });
    servers = result.servers || [];
    await loadMcp();
    $('#mcp-import-feedback').textContent = `${result.imported} servidor(es) importado(s). Nenhum servidor foi iniciado automaticamente.`;
    $('#mcp-import-feedback').classList.remove('error');
    toast('Configuração MCP importada.');
  } catch (error) { $('#mcp-import-feedback').textContent = error.message; $('#mcp-import-feedback').classList.add('error'); toast(error.message, true); }
}
async function connectMcp(name) {
  const server = servers.find(item => item.name === name);
  if (server?.command && !confirm(`Isso iniciará um processo local:\n\n${server.command} ${(server.args || []).join(' ')}\n\nRevise o comando e os argumentos antes de continuar. Deseja conectar?`)) return;
  try { const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/connect`, { method: 'POST', body: '{}' }); servers = result.servers || []; await loadMcp(); toast(`Servidor ${name} conectado.`); }
  catch (error) { await loadMcp(); toast(error.message, true); }
}
async function disconnectMcp(name) {
  try { const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/disconnect`, { method: 'POST', body: '{}' }); servers = result.servers || []; await loadMcp(); toast(`Servidor ${name} desconectado.`); }
  catch (error) { toast(error.message, true); }
}
async function removeMcp(name) {
  if (!confirm(`Remover a configuração MCP "${name}"?`)) return;
  try { const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }); servers = result.servers || []; await loadMcp(); toast('Configuração removida.'); }
  catch (error) { toast(error.message, true); }
}
// --- Gerenciador de Projetos ---
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
  if (!sel) return;
  sel.innerHTML = projects.map(p => `
    <option value="${escapeHtml(p.id)}" ${p.id === activeProjectId ? 'selected' : ''}>
      ${escapeHtml(p.name)}
    </option>
  `).join('');
}

async function selectProject(id) {
  if (!id || id === activeProjectId) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    projects = data.projects || [];
    activeProjectId = data.activeId || id;
    renderProjectSelector();
    renderProjects();
    await Promise.all([refreshSystem(), refreshHealth(), loadMemories()]);
    toast(`Projeto ativo alterado para: ${projects.find(p => p.id === activeProjectId)?.name || id}`);
  } catch (error) {
    toast(error.message, true);
  }
}

async function submitProject(event) {
  event.preventDefault();
  const name = $('#proj-name')?.value.trim();
  const pathVal = $('#proj-path')?.value.trim();
  const desc = $('#proj-desc')?.value.trim();
  if (!name || !pathVal) {
    toast('Preencha nome e caminho da pasta.', true);
    return;
  }
  try {
    const res = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name, path: pathVal, description: desc }),
    });
    projects = res.projects || [];
    activeProjectId = res.activeId || activeProjectId;
    $('#project-form')?.reset();
    renderProjectSelector();
    renderProjects();
    toast('Projeto cadastrado com sucesso!');
  } catch (error) {
    toast(error.message, true);
  }
}

async function deleteProject(id) {
  const proj = projects.find(p => p.id === id);
  if (!confirm(`Excluir o projeto "${proj?.name || id}"? Os arquivos no disco NÃO serão apagados.`)) return;
  try {
    const res = await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    projects = res.projects || [];
    activeProjectId = res.activeId || projects[0]?.id || '';
    renderProjectSelector();
    renderProjects();
    toast('Projeto removido.');
  } catch (error) {
    toast(error.message, true);
  }
}

function renderProjects() {
  const host = $('#project-list');
  if (!host) return;
  const countEl = $('#projects-count');
  if (countEl) countEl.textContent = `${projects.length} projeto(s) cadastrado(s)`;

  host.innerHTML = projects.map(p => {
    const isActive = p.id === activeProjectId;
    return `
      <article class="server-card" style="border-left: 3px solid ${isActive ? '#3fb950' : '#30363d'}">
        <div class="server-card-head">
          <div>
            <h4>${escapeHtml(p.name)}</h4>
            <small style="color:var(--text-muted);word-break:break-all;">${escapeHtml(p.path)}</small>
          </div>
          ${isActive ? '<span class="status-pill status-connected">ATIVO</span>' : ''}
        </div>
        <p style="margin: 8px 0; font-size: 13px; color: var(--text-muted);">${escapeHtml(p.description || 'Sem descrição.')}</p>
        <div class="card-actions" style="margin-top: 10px; display: flex; gap: 8px;">
          ${!isActive ? `<button class="button primary small" data-activate-project="${escapeHtml(p.id)}">Ativar</button>` : ''}
          ${projects.length > 1 ? `<button class="button secondary small" data-delete-project="${escapeHtml(p.id)}">Remover</button>` : ''}
        </div>
      </article>
    `;
  }).join('') || '<div class="empty-inline">Nenhum projeto cadastrado.</div>';

  $$('[data-activate-project]', host).forEach(btn => {
    btn.addEventListener('click', () => selectProject(btn.dataset.activateProject));
  });
  $$('[data-delete-project]', host).forEach(btn => {
    btn.addEventListener('click', () => deleteProject(btn.dataset.deleteProject));
  });
}

// --- Memória Multi-Nível ---
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
  const host = $('#memory-list'); if (!host) return;
  $('#memory-count').textContent = `${memories.length} memória(s) encontrada(s)`;
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
  }).join('') || '<div class="empty-inline">Nenhuma memória encontrada para o filtro selecionado.</div>';

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
    toast('Memória salva no perfil local.');
  } catch (error) { toast(error.message, true); }
}

async function deleteMemory(id) {
  if (!confirm('Excluir esta memória permanentemente?')) return;
  try { await api(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadMemories(); toast('Memória excluída.'); }
  catch (error) { toast(error.message, true); }
}
async function refreshSystem() {
  try {
    const result = await api('/api/health');
    $('#system-overview').innerHTML = [
      ['NÚCLEO', result.name], ['VERSÃO', result.version], ['PORTA LOCAL', `${result.host}:${result.port}`], ['TEMPO ATIVO', `${result.uptimeSeconds}s`], ['WORKSPACE', result.workspace], ['SEGURANÇA', 'Loopback apenas'],
    ].map(([label, value]) => `<div class="system-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
    $('#openai-endpoint').textContent = `${location.origin}/v1`;
  } catch (error) { $('#system-overview').innerHTML = `<div class="empty-inline">Não foi possível consultar o núcleo: ${escapeHtml(error.message)}</div>`; }
}

// --- Monitor SSE ---
function initMonitorIfNeeded() {
  if (monitorSSE) return;
  // Replay stored events first
  api('/api/monitor/events').then(data => {
    const events = Array.isArray(data.events) ? data.events : (Array.isArray(data) ? data : []);
    events.forEach(ev => {
      monitorEvents.push(ev);
      if (monitorEvents.length > 200) monitorEvents.shift();
    });
    renderMonitorFeed();
    renderMonitorStats();
  }).catch(() => undefined);

  function connect() {
    const sse = new EventSource('/api/monitor/stream');
    monitorSSE = sse;
    sse.onopen = () => {
      monitorConnected = true;
      const dot = $('#monitor-status');
      if (dot) { dot.classList.add('online'); }
    };
    sse.onmessage = event => {
      let parsed;
      try { parsed = JSON.parse(event.data); } catch { return; }
      appendMonitorEvent(parsed);
    };
    sse.onerror = () => {
      monitorConnected = false;
      const dot = $('#monitor-status');
      if (dot) { dot.classList.remove('online'); }
      sse.close();
      monitorSSE = null;
      window.setTimeout(connect, 3000);
    };
  }
  connect();
}

function appendMonitorEvent(event) {
  monitorEvents.push(event);
  if (monitorEvents.length > 200) monitorEvents.shift();
  renderMonitorFeed();
  renderMonitorStats();
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderMonitorFeed() {
  const host = $('#monitor-feed');
  if (!host) return;
  if (!monitorEvents.length) { host.innerHTML = '<div style="color:var(--faint);font-size:11px;padding:12px;">Nenhum evento ainda.</div>'; return; }
  host.innerHTML = monitorEvents.map(ev => {
    const ts = formatRelativeTime(ev.timestamp || ev.ts || null);
    const tsSpan = ts ? `<span style="color:var(--faint);margin-left:8px;font-size:10px;">${escapeHtml(ts)}</span>` : '';
    let label = '';
    let extraClass = '';
    switch (ev.type) {
      case 'agent_start':
        label = `▶ Agente iniciado — modelo: ${escapeHtml(ev.model || '')}`;
        break;
      case 'tool_call':
        label = `⚙ ${escapeHtml(ev.tool || '')} chamada${ev.approvalRequired ? ' <em>(aprovação necessária)</em>' : ''}`;
        break;
      case 'tool_result':
        extraClass = ev.isError ? ' has-error' : '';
        label = `✓ ${escapeHtml(ev.tool || '')} — ${escapeHtml(String(ev.durationMs ?? ''))}ms${ev.isError ? ' ❌ ERRO' : ''}`;
        break;
      case 'token_usage':
        label = `◈ Tokens: ${escapeHtml(String(ev.promptTokens ?? 0))}p + ${escapeHtml(String(ev.completionTokens ?? 0))}c`;
        break;
      case 'agent_done':
        label = `■ Concluído em ${escapeHtml(String(ev.totalMs ?? ''))}ms, ${escapeHtml(String(ev.steps ?? ''))} passos`;
        break;
      case 'error':
        label = `✗ ERRO: ${escapeHtml(ev.message || '')}`;
        break;
      default:
        label = escapeHtml(JSON.stringify(ev));
    }
    return `<div class="monitor-event monitor-event-${escapeHtml(ev.type || 'unknown')}${extraClass}">${label}${tsSpan}</div>`;
  }).join('');
  host.scrollTop = host.scrollHeight;
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
    ['Tempo médio (ms)', avgMs || '—'],
    ['Erros', errors],
  ].map(([label, val]) => `<div class="monitor-stat"><strong>${escapeHtml(String(val))}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

// --- Diff visual no modal de aprovação ---
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
    ? `<span class="risk-badge risk-${escapeHtml(diffData.risk)}">${escapeHtml(diffData.risk)}</span> `
    : '';
  const details = document.createElement('details');
  details.className = 'diff-details';
  details.innerHTML = `<summary style="cursor:pointer;font-size:11px;color:#b9d7cf;margin-top:10px;">${riskHtml}Diff das alterações (clique para expandir)</summary><pre class="diff-block">${colorDiff(diffData.diff)}</pre>`;
  host.appendChild(details);
}

// Wire up UI events
$$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
// Monitor clear — delegate since the view may render after script boot
document.addEventListener('click', event => {
  if (event.target && event.target.id === 'monitor-clear') {
    monitorEvents = [];
    renderMonitorFeed();
    renderMonitorStats();
  }
});
$('#new-chat-side').addEventListener('click', createConversation);
$('#new-chat-top').addEventListener('click', createConversation);
$('#chat-form').addEventListener('submit', sendMessage);
$('#chat-input').addEventListener('input', autoResizeInput);
$('#chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event); } });
$('#chat-attach').addEventListener('change', event => { void addAttachmentFiles(event.target.files); event.target.value = ''; });
$('#chat-input').addEventListener('paste', event => {
  const items = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && ALLOWED_ATTACHMENT_TYPES.has(item.type));
  if (!items.length) return;
  event.preventDefault();
  void addAttachmentFiles(items.map(item => item.getAsFile()).filter(Boolean));
});
let dragDepth = 0;
const composerForm = $('#chat-form');
composerForm.addEventListener('dragenter', event => { event.preventDefault(); dragDepth += 1; setDragActive(true); });
composerForm.addEventListener('dragover', event => event.preventDefault());
composerForm.addEventListener('dragleave', event => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) setDragActive(false); });
composerForm.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0; setDragActive(false);
  void addAttachmentFiles(event.dataTransfer?.files);
});
$('#chat-provider').addEventListener('change', event => { activeProviderId = event.target.value; });
$$('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('#chat-input').value = button.dataset.prompt; autoResizeInput(); $('#chat-input').focus(); }));
$('#add-provider').addEventListener('click', () => openProviderForm());
$('#close-provider-form').addEventListener('click', () => { $('#provider-form-wrap').hidden = true; });
$('#provider-form').addEventListener('submit', submitProvider);
$('#discover-models').addEventListener('click', async () => {
  const id = $('#provider-id').value.trim().toLowerCase();
  if (!providers.some(item => item.id === id)) { toast('Salve o provedor primeiro; depois busque os modelos.', true); return; }
  await discoverProvider(id);
});
$('#import-mcp').addEventListener('click', importMcp);
$('#close-mcp-output').addEventListener('click', () => { $('#mcp-output-panel').hidden = true; });
$('#mcp-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  $('#mcp-config').value = await file.text();
  event.target.value = '';
});
$('#connect-all-mcp').addEventListener('click', async () => {
  const stdioCount = servers.filter(item => item.command && item.enabled !== false && !item.connected).length;
  if (!confirm(`Conectar todos os servidores MCP habilitados?\n\nIsso pode iniciar ${stdioCount} processo(s) local(is) por stdio. Conecte apenas configurações confiáveis.`)) return;
  try { const result = await api('/api/mcp/servers/connect-all', { method: 'POST', body: '{}' }); await loadMcp(); const failed = result.results.filter(item => !item.ok); toast(failed.length ? `${failed.length} servidor(es) não conectaram.` : 'Todos os servidores habilitados conectaram.'); }
  catch (error) { toast(error.message, true); }
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
$('#memory-form').addEventListener('submit', saveMemory);
$('#refresh-system').addEventListener('click', refreshSystem);
$('#copy-endpoint').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/v1`); toast('Endpoint copiado.'); } catch { toast('Não foi possível copiar o endpoint.', true); } });

async function init() {
  if (!conversations.length) createConversation(); else if (!conversations.some(item => item.id === activeConversationId)) activeConversationId = conversations[0].id;
  renderConversationList(); renderChat();
  try { await Promise.all([loadProjects(), loadProviders(), loadMcp(), loadMemories(), refreshSystem(), refreshHealth()]); }
  catch (error) { toast(error.message, true); }
  window.setInterval(refreshHealth, 15000);
}
init();
