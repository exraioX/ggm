'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const VIEW_TITLES = { overview: 'Visão geral', experiments: 'Novo experimento', cases: 'Casos de teste', runs: 'Histórico de execuções', skills: 'Claude Code Skills' };
let providers = [];
let cases = [];
let overview = null;
let runs = [];
let activeRunId = '';
let pollTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = 'toast' + (error ? ' error' : '');
  node.textContent = message;
  $('#toast-region').append(node);
  window.setTimeout(() => node.remove(), 4000);
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || 'Falha HTTP ' + response.status);
  return payload;
}
function setView(view) {
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  $$('.view').forEach(node => node.classList.toggle('active', node.id === 'view-' + view));
  $('#page-title').textContent = VIEW_TITLES[view] || 'Research Lab';
  if (view === 'runs') renderRuns();
  if (view === 'cases') renderCaseLibrary();
  if (view === 'overview') renderOverview();
}
function verdictLabel(value) {
  return ({ pass: 'PASS', fail: 'FAIL', review: 'REVISÃO HUMANA', error: 'ERRO', running: 'EXECUTANDO', completed: 'CONCLUÍDO', completed_with_errors: 'CONCLUÍDO COM ERROS', cancelled: 'CANCELADO' })[value] || String(value || '—').toUpperCase();
}
function verdictClass(value) {
  if (value === 'pass' || value === 'completed') return 'pass';
  if (value === 'fail' || value === 'error' || value === 'cancelled' || value === 'completed_with_errors') return 'fail';
  return 'review';
}
async function refreshAll() {
  const [providerData, caseData, overviewData, runData] = await Promise.all([
    api('/api/providers'),
    api('/api/research/cases'),
    api('/api/research/overview'),
    api('/api/research/runs'),
  ]);
  providers = providerData.providers || [];
  cases = caseData.cases || [];
  overview = overviewData;
  runs = runData.runs || [];
  renderOverview();
  renderTargetsIfEmpty();
  renderExperimentCases();
  renderCaseLibrary();
  renderRuns();
}
function renderOverview() {
  if (!overview) return;
  $('#stat-runs').textContent = String(overview.runCount || 0);
  $('#stat-active').textContent = String(overview.activeRuns || 0) + ' em execução';
  $('#stat-cases').textContent = String(overview.caseCount || 0);
  $('#stat-custom-cases').textContent = String(overview.customCaseCount || 0) + ' personalizados';
  const summary = overview.summary || {};
  $('#stat-pass-rate').textContent = summary.passRate === null ? '—' : summary.passRate + '%';
  $('#stat-review').textContent = String(summary.review || 0);
  const host = $('#model-performance');
  const models = overview.models || [];
  host.innerHTML = models.length ? models.map(item => {
    const label = item.model + ' · ' + item.providerId;
    const percent = item.passRate === null ? 0 : Math.max(0, Math.min(100, item.passRate));
    return '<div class="model-row"><div class="model-name">' + escapeHtml(label) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + percent + '%"></div></div><div class="model-percent">' + (item.passRate === null ? '—' : percent + '%') + '</div><div class="model-meta">' + item.runs + ' respostas · ' + item.averageLatencyMs + ' ms médios · ' + item.review + ' para revisão · ' + item.error + ' erros</div></div>';
  }).join('') : '<div class="empty">Execute um experimento para gerar comparações.</div>';
  const latest = overview.latestRuns || [];
  $('#latest-runs').innerHTML = latest.length ? latest.map(renderRunButton).join('') : '<div class="empty">Nenhuma execução registrada.</div>';
  $$('#latest-runs [data-run-id]').forEach(button => button.addEventListener('click', () => openRun(button.dataset.runId)));
}
function renderRunButton(run) {
  return '<button class="run-row" type="button" data-run-id="' + escapeHtml(run.id) + '"><span><strong>' + escapeHtml(run.name) + '</strong><small>' + escapeHtml(new Date(run.createdAt).toLocaleString()) + ' · ' + run.progress.completed + '/' + run.progress.total + ' respostas</small></span><span class="run-state ' + verdictClass(run.status) + '">' + verdictLabel(run.status) + '</span></button>';
}
function renderTargetsIfEmpty() {
  if ($('#target-list').children.length) return;
  addTarget();
}
function addTarget() {
  const host = $('#target-list');
  if (host.children.length >= 6) { toast('O limite é de seis modelos por experimento.', true); return; }
  const options = providers.filter(item => item.enabled !== false).map(item => '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.name) + '</option>').join('');
  const row = document.createElement('div');
  row.className = 'target-row';
  row.innerHTML = '<select class="target-provider" aria-label="Provedor">' + (options || '<option value="">Cadastre um provedor primeiro</option>') + '</select><input class="target-model" aria-label="Modelo" placeholder="ID exato do modelo"><button class="button secondary small discover-models" type="button">Buscar</button><button class="button ghost small remove-target" type="button" aria-label="Remover modelo">Remover</button>';
  const providerSelect = $('.target-provider', row);
  const modelInput = $('.target-model', row);
  const first = providers.find(item => item.id === providerSelect.value);
  if (first) modelInput.value = first.model || '';
  providerSelect.addEventListener('change', () => {
    const selected = providers.find(item => item.id === providerSelect.value);
    modelInput.value = selected?.model || '';
  });
  $('.discover-models', row).addEventListener('click', async () => {
    const id = providerSelect.value;
    if (!id) return;
    try {
      const data = await api('/api/providers/' + encodeURIComponent(id) + '/models');
      const modelIds = data.models || [];
      if (!modelIds.length) { toast('O provedor não retornou modelos.', true); return; }
      const listId = 'models-' + crypto.randomUUID();
      const list = document.createElement('datalist');
      list.id = listId;
      list.innerHTML = modelIds.map(model => '<option value="' + escapeHtml(model) + '"></option>').join('');
      row.append(list);
      modelInput.setAttribute('list', listId);
      toast(modelIds.length + ' modelos encontrados. Escolha no campo.');
    } catch (error) { toast(error.message, true); }
  });
  $('.remove-target', row).addEventListener('click', () => row.remove());
  host.append(row);
  updateEstimatedCalls();
}
function getTargets() {
  return $$('.target-row').map(row => ({
    providerId: $('.target-provider', row).value,
    model: $('.target-model', row).value.trim(),
  })).filter(item => item.providerId && item.model);
}
function selectedCaseIds() {
  return $$('input[name="case-id"]:checked').map(input => input.value);
}
function updateEstimatedCalls() {
  const calls = getTargets().length * selectedCaseIds().length * Number($('#experiment-repetitions').value || 1);
  $('#estimated-calls').textContent = calls ? calls + ' chamadas previstas' + (calls > 120 ? ' — acima do limite' : '') : 'Selecione modelos e casos para calcular as chamadas.';
  $('#start-experiment').disabled = calls < 1 || calls > 120;
}
function renderExperimentCases() {
  const host = $('#experiment-cases');
  host.innerHTML = cases.map(item => '<label class="case-choice"><input type="checkbox" name="case-id" value="' + escapeHtml(item.id) + '"' + (item.source === 'builtin' ? ' checked' : '') + '><span><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.objective || item.expectedBehavior) + '</small><em>' + escapeHtml(item.category) + ' · ' + (item.rule === 'human' ? 'REVISÃO HUMANA' : 'AUTOMÁTICO') + '</em></span></label>').join('');
  $$('input[name="case-id"]').forEach(input => input.addEventListener('change', updateEstimatedCalls));
  updateEstimatedCalls();
}
function renderCaseLibrary() {
  $('#case-count').textContent = cases.length + ' casos';
  $('#case-library').innerHTML = cases.map(item => '<article class="case-item"><div class="case-item-head"><h4>' + escapeHtml(item.title) + '</h4>' + (item.source === 'custom' ? '<button class="text-button" data-delete-case="' + escapeHtml(item.id) + '">Excluir</button>' : '<span class="count-pill">INTEGRADO</span>') + '</div><p>' + escapeHtml(item.objective || item.expectedBehavior) + '</p><div class="case-meta"><span>' + escapeHtml(item.category) + '</span><span>' + escapeHtml(item.rule) + '</span><span>' + (item.source === 'custom' ? 'PERSONALIZADO' : 'PADRÃO') + '</span></div></article>').join('');
  $$('[data-delete-case]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Remover este caso personalizado?')) return;
    try { await api('/api/research/cases/' + encodeURIComponent(button.dataset.deleteCase), { method: 'DELETE' }); await refreshAll(); toast('Caso removido.'); }
    catch (error) { toast(error.message, true); }
  }));
}
function renderRuns() {
  const host = $('#run-list');
  host.innerHTML = runs.length ? runs.map(renderRunButton).join('') : '<div class="empty">Nenhuma execução registrada.</div>';
  $$('[data-run-id]', host).forEach(button => button.addEventListener('click', () => openRun(button.dataset.runId)));
}
async function openRun(id) {
  activeRunId = id;
  setView('runs');
  await loadRunDetail(id);
}
async function loadRunDetail(id, reschedule = true) {
  const host = $('#run-detail');
  try {
    const data = await api('/api/research/runs/' + encodeURIComponent(id));
    const run = data.run;
    const summary = run.results.reduce((counts, item) => {
      const key = item.effectiveVerdict || item.verdict;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, { pass: 0, fail: 0, review: 0, error: 0 });
    const percent = run.progress.total ? Math.round(run.progress.completed / run.progress.total * 100) : 0;
    host.innerHTML = '<div class="run-detail-head"><div><h2>' + escapeHtml(run.name) + '</h2><div class="run-detail-meta">' + escapeHtml(run.description || 'Sem descrição') + '<br>' + escapeHtml(new Date(run.createdAt).toLocaleString()) + ' · ' + run.targets.length + ' modelos · ' + run.caseIds.length + ' casos · ' + run.repetitions + ' repetição(ões)</div></div><div class="run-actions"><span class="run-state ' + verdictClass(run.status) + '">' + verdictLabel(run.status) + '</span>' + (run.status === 'running' ? '<button class="button secondary small" id="cancel-run">Cancelar</button>' : '') + '<a class="button secondary small" href="/api/research/runs/' + encodeURIComponent(run.id) + '/export?format=csv">CSV</a><a class="button secondary small" href="/api/research/runs/' + encodeURIComponent(run.id) + '/export?format=json">JSON</a></div></div><div class="progress"><span style="width:' + percent + '%"></span></div><div class="run-detail-meta">' + run.progress.completed + ' de ' + run.progress.total + ' chamadas concluídas (' + percent + '%)</div><div class="result-summary"><div class="mini-stat"><small>PASS</small><strong>' + summary.pass + '</strong></div><div class="mini-stat"><small>FAIL</small><strong>' + summary.fail + '</strong></div><div class="mini-stat"><small>REVISÃO</small><strong>' + summary.review + '</strong></div><div class="mini-stat"><small>ERROS</small><strong>' + summary.error + '</strong></div></div><div class="result-list">' + (run.results.length ? run.results.map(renderResultCard).join('') : '<div class="empty">Aguardando as primeiras respostas…</div>') + '</div>';
    const cancel = $('#cancel-run');
    if (cancel) cancel.addEventListener('click', async () => {
      try { await api('/api/research/runs/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: '{}' }); toast('Cancelamento solicitado.'); await loadRunDetail(id); }
      catch (error) { toast(error.message, true); }
    });
    $$('[data-review-result]').forEach(button => button.addEventListener('click', () => reviewResult(id, button.dataset.reviewResult, button.dataset.verdict)));
    if (run.status === 'running' && reschedule) startPolling(id); else if (run.status !== 'running') stopPolling();
  } catch (error) {
    host.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
  }
}
function renderResultCard(item) {
  const verdict = item.effectiveVerdict || item.verdict;
  return '<article class="result-card"><div class="result-card-head"><div><h4>' + escapeHtml(item.caseTitle) + ' · ' + escapeHtml(item.model) + '</h4><div class="result-meta">' + escapeHtml(item.providerName) + ' · ' + escapeHtml(item.category) + ' · tentativa ' + item.repetition + ' · ' + item.latencyMs + ' ms · ' + (item.totalTokens ?? '—') + ' tokens</div></div><span class="verdict ' + verdictClass(verdict) + '">' + verdictLabel(verdict) + '</span></div><div class="result-meta">' + escapeHtml(item.explanation || '') + (item.error ? '<br>Erro: ' + escapeHtml(item.error) : '') + '</div><details><summary>Inspecionar caso, resposta e revisão</summary><div class="result-meta">INSTRUÇÃO DE SISTEMA</div><pre>' + escapeHtml(item.systemPrompt || '(não registrada)') + '</pre><div class="result-meta">ENTRADA DO TESTE</div><pre>' + escapeHtml(item.userPrompt || '(não registrada)') + '</pre><div class="result-meta">COMPORTAMENTO ESPERADO</div><pre>' + escapeHtml(item.expectedBehavior || '(não registrado)') + '</pre><div class="result-meta">RESPOSTA DO MODELO</div><pre>' + escapeHtml(item.response || '(sem resposta)') + '</pre><div class="review-tools"><textarea id="note-' + escapeHtml(item.id) + '" maxlength="2000" placeholder="Nota da revisão humana…">' + escapeHtml(item.reviewNote || '') + '</textarea><div class="review-buttons"><button class="button secondary" data-review-result="' + escapeHtml(item.id) + '" data-verdict="pass">PASS</button><button class="button secondary" data-review-result="' + escapeHtml(item.id) + '" data-verdict="fail">FAIL</button><button class="button secondary" data-review-result="' + escapeHtml(item.id) + '" data-verdict="review">REVISAR</button></div></div></details></article>';
}
async function reviewResult(runId, resultId, verdict) {
  const note = $('#note-' + CSS.escape(resultId))?.value || '';
  try {
    await api('/api/research/runs/' + encodeURIComponent(runId) + '/results/' + encodeURIComponent(resultId), { method: 'PATCH', body: JSON.stringify({ verdict, note }) });
    toast('Avaliação humana registrada.');
    await loadRunDetail(runId);
    await refreshOverviewOnly();
  } catch (error) { toast(error.message, true); }
}
async function refreshOverviewOnly() {
  overview = await api('/api/research/overview');
  runs = (await api('/api/research/runs')).runs || [];
  renderOverview();
  renderRuns();
}
function startPolling(id) {
  stopPolling();
  const poll = async () => {
    if (activeRunId !== id) return;
    await loadRunDetail(id, false);
    runs = (await api('/api/research/runs')).runs || [];
    renderRuns();
    overview = await api('/api/research/overview');
    renderOverview();
    if (runs.some(run => run.id === id && run.status === 'running')) pollTimer = window.setTimeout(poll, 2200);
  };
  pollTimer = window.setTimeout(poll, 2200);
}
function stopPolling() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}
async function submitExperiment(event) {
  event.preventDefault();
  const targets = getTargets();
  const caseIds = selectedCaseIds();
  const payload = {
    name: $('#experiment-name').value,
    description: $('#experiment-description').value,
    targets,
    caseIds,
    repetitions: Number($('#experiment-repetitions').value),
    temperature: Number($('#experiment-temperature').value),
    maxTokens: Number($('#experiment-max-tokens').value),
  };
  try {
    const data = await api('/api/research/runs', { method: 'POST', body: JSON.stringify(payload) });
    activeRunId = data.run.id;
    toast('Experimento iniciado: ' + data.run.progress.total + ' chamadas planejadas.');
    await refreshAll();
    setView('runs');
    await loadRunDetail(activeRunId);
  } catch (error) { toast(error.message, true); }
}
async function submitCase(event) {
  event.preventDefault();
  const payload = {
    title: $('#case-title').value,
    category: $('#case-category').value,
    objective: $('#case-objective').value,
    systemPrompt: $('#case-system').value,
    userPrompt: $('#case-user').value,
    expectedBehavior: $('#case-expected').value,
    rule: $('#case-rule').value,
    matchText: $('#case-match').value,
  };
  try {
    await api('/api/research/cases', { method: 'POST', body: JSON.stringify(payload) });
    $('#case-form').reset();
    await refreshAll();
    toast('Caso de teste salvo.');
  } catch (error) { toast(error.message, true); }
}
function configureCaseRule() {
  const manual = $('#case-rule').value === 'human';
  $('#case-match-wrap').classList.toggle('hidden', manual);
}
function bindEvents() {
  $$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => setView(button.dataset.goto)));
  $('#refresh-button').addEventListener('click', () => refreshAll().then(() => toast('Dados atualizados.')).catch(error => toast(error.message, true)));
  $('#add-target').addEventListener('click', addTarget);
  $('#experiment-form').addEventListener('submit', submitExperiment);
  $('#case-form').addEventListener('submit', submitCase);
  $('#case-rule').addEventListener('change', configureCaseRule);
  $('#experiment-repetitions').addEventListener('change', updateEstimatedCalls);
  $('#select-all-cases').addEventListener('click', () => { $$('input[name="case-id"]').forEach(input => input.checked = true); updateEstimatedCalls(); });
  $('#clear-cases').addEventListener('click', () => { $$('input[name="case-id"]').forEach(input => input.checked = false); updateEstimatedCalls(); });
}
bindEvents();
refreshAll().catch(error => toast('Falha ao carregar Research Lab: ' + error.message, true));
