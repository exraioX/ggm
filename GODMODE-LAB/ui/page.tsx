'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { useStore } from '@/store'
import {
  Activity, ArrowLeft, BrainCircuit, CheckCircle2, CircleAlert,
  Cpu, Loader2, Plug, RefreshCw, Send, ShieldCheck, Terminal,
  Wrench, XCircle,
} from 'lucide-react'

const API = process.env.NEXT_PUBLIC_GODMODE_LAB_API_URL || 'http://127.0.0.1:8765'

type ServerStatus = {
  name: string
  description: string
  enabled: boolean
  connected: boolean
  tools: number
  error?: string | null
}

type ApprovalRequest = {
  status: 'approval_required'
  sessionId: string
  pendingId: string
  tool: string
  description: string
  arguments: Record<string, unknown>
  message: string
}

type AgentResult =
  | ApprovalRequest
  | { status: 'complete'; answer: string; steps?: number; limitReached?: boolean }
  | { status: 'cancelled'; message: string }
  | { error: string }

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Gateway request failed (${response.status})`)
  return payload as T
}

export default function GODMODELabPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { theme, apiKey, defaultModel, memories, memoriesEnabled } = useStore()
  const [servers, setServers] = useState<ServerStatus[]>([])
  const [gatewayError, setGatewayError] = useState('')
  const [busyServer, setBusyServer] = useState('')
  const [provider, setProvider] = useState<'local' | 'openrouter'>('local')
  const [baseURL, setBaseURL] = useState('http://127.0.0.1:11434/v1')
  const [model, setModel] = useState('qwen3:8b')
  const [modelKey, setModelKey] = useState('ollama')
  const [goal, setGoal] = useState('Investigue a estrutura deste projeto, identifique os pontos principais e apresente um plano de melhorias sem modificar arquivos ainda.')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [history, setHistory] = useState<string[]>([])

  const connectedCount = useMemo(() => servers.filter(server => server.connected).length, [servers])
  const availableTools = useMemo(() => servers.reduce((total, server) => total + (server.connected ? server.tools : 0), 0), [servers])

  const refreshStatus = useCallback(async () => {
    try {
      const data = await apiRequest<{ servers: ServerStatus[] }>('/api/lab/status')
      setServers(data.servers || [])
      setGatewayError('')
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  useEffect(() => {
    if (provider === 'openrouter') {
      setBaseURL('https://openrouter.ai/api/v1')
      setModel(defaultModel || 'qwen/qwen3-coder')
      setModelKey(apiKey || '')
    } else {
      setBaseURL('http://127.0.0.1:11434/v1')
      setModel('qwen3:8b')
      setModelKey('ollama')
    }
  }, [provider, apiKey, defaultModel])

  const connectServer = async (name: string) => {
    setBusyServer(name)
    try {
      const data = await apiRequest<{ servers: ServerStatus[] }>(`/api/lab/servers/${name}/connect`, { method: 'POST', body: '{}' })
      setServers(data.servers || [])
      setGatewayError('')
      setHistory(previous => [`${name}: conexão iniciada.`, ...previous].slice(0, 12))
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
      await refreshStatus()
    } finally {
      setBusyServer('')
    }
  }

  const connectAll = async () => {
    setBusyServer('*')
    try {
      const data = await apiRequest<{ servers: ServerStatus[]; results: Array<{ name: string; ok: boolean; error?: string }> }>('/api/lab/servers/connect-all', { method: 'POST', body: '{}' })
      setServers(data.servers || [])
      setHistory(previous => [...(data.results || []).map(item => `${item.name}: ${item.ok ? 'conectado' : item.error || 'falhou'}`), ...previous].slice(0, 12))
      const failed = data.results?.filter(item => !item.ok) || []
      setGatewayError(failed.length ? `${failed.length} integração(ões) não conectaram. Verifique as dependências e os erros abaixo.` : '')
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusyServer('')
      await refreshStatus()
    }
  }

  const applyAgentResult = (next: AgentResult) => {
    setResult(next)
    if ('status' in next && next.status === 'complete') {
      setHistory(previous => [`Tarefa concluída em ${next.steps || 0} etapa(s).`, ...previous].slice(0, 12))
    }
  }

  const runAgent = async () => {
    if (!goal.trim() || !model.trim()) return
    setRunning(true)
    setResult(null)
    setGatewayError('')
    try {
      const data = await apiRequest<AgentResult>('/api/lab/agent/run', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          model,
          baseURL,
          apiKey: modelKey,
          memories: memoriesEnabled ? memories.filter(memory => memory.active).slice(0, 30) : [],
        }),
      })
      applyAgentResult(data)
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const approveTool = async (approved: boolean) => {
    if (!result || !('pendingId' in result)) return
    setRunning(true)
    try {
      const data = await apiRequest<AgentResult>('/api/lab/agent/approve', {
        method: 'POST',
        body: JSON.stringify({ sessionId: result.sessionId, pendingId: result.pendingId, approved }),
      })
      applyAgentResult(data)
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className={`theme-${theme} theme-bg theme-text min-h-screen flex relative overflow-hidden`}>
      {(theme === 'matrix' || theme === 'hacker') && <div className="scanlines pointer-events-none absolute inset-0 z-50" />}
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(value => !value)} />
      <section className="flex-1 min-w-0 h-screen overflow-y-auto p-4 md:p-7 relative z-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl border border-theme-primary bg-theme-dim"><BrainCircuit className="w-7 h-7 theme-primary" /></div>
              <div>
                <p className="text-xs theme-secondary tracking-[0.25em]">G0DM0D3 / EXTENSION</p>
                <h1 className="text-2xl md:text-3xl font-bold theme-primary">GODMODE LAB</h1>
                <p className="text-sm theme-secondary">Agentes locais · Engenharia reversa · Memória · MCP</p>
              </div>
            </div>
            <a href="/" className="inline-flex items-center gap-2 px-3 py-2 border border-theme-primary rounded-lg hover:bg-theme-accent text-sm"><ArrowLeft className="w-4 h-4" /> Voltar ao chat</a>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric icon={<Activity className="w-4 h-4" />} label="Gateway" value={gatewayError ? 'Atenção' : 'Local'} />
            <Metric icon={<Plug className="w-4 h-4" />} label="MCP conectados" value={`${connectedCount}/${servers.length || 4}`} />
            <Metric icon={<Wrench className="w-4 h-4" />} label="Ferramentas" value={String(availableTools)} />
            <Metric icon={<ShieldCheck className="w-4 h-4" />} label="Autonomia" value="Semiautônoma" />
          </div>

          {gatewayError && <div className="p-3 rounded-lg border border-amber-500/50 bg-amber-500/10 text-sm flex gap-2"><CircleAlert className="w-5 h-5 shrink-0" /><span>{gatewayError}<br /><span className="opacity-75">Confirme que o gateway GODMODE LAB está rodando em http://127.0.0.1:8765.</span></span></div>}

          <section className="border border-theme-primary rounded-xl bg-theme-dim/40 p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-bold text-lg flex items-center gap-2"><Plug className="w-5 h-5 theme-primary" /> Integrações MCP</h2><p className="text-xs theme-secondary mt-1">Conecte apenas as ferramentas instaladas neste computador.</p></div>
              <button onClick={connectAll} disabled={busyServer !== ''} className="px-3 py-2 rounded-lg border border-theme-primary text-sm hover:bg-theme-accent disabled:opacity-50">{busyServer === '*' ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : <RefreshCw className="w-4 h-4 inline mr-2" />}Conectar disponíveis</button>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {servers.map(server => <div key={server.name} className="border border-theme-primary/60 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2"><div className="font-semibold capitalize">{server.name}</div><span className={`text-xs px-2 py-1 rounded-full ${server.connected ? 'bg-emerald-500/15 text-emerald-400' : server.enabled ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 theme-secondary'}`}>{server.connected ? 'Conectado' : server.enabled ? 'Desconectado' : 'Não configurado'}</span></div>
                <p className="text-xs theme-secondary min-h-9">{server.description}</p>
                {server.error && <p className="text-xs text-rose-400">{server.error}</p>}
                <div className="flex items-center justify-between mt-auto"><span className="text-xs theme-secondary">{server.connected ? `${server.tools} ferramenta(s)` : server.enabled ? 'Pronto para conectar' : 'Configure o executável'}</span><button disabled={!server.enabled || server.connected || busyServer !== ''} onClick={() => connectServer(server.name)} className="px-3 py-1.5 rounded-md border border-theme-primary text-xs hover:bg-theme-accent disabled:opacity-40">{busyServer === server.name ? <Loader2 className="w-3 h-3 animate-spin" /> : server.connected ? 'Ativo' : 'Conectar'}</button></div>
              </div>)}
              {!servers.length && <p className="text-sm theme-secondary">Carregando estado do gateway...</p>}
            </div>
          </section>

          <section className="border border-theme-primary rounded-xl bg-theme-dim/40 p-4 md:p-5 space-y-4">
            <div><h2 className="font-bold text-lg flex items-center gap-2"><Cpu className="w-5 h-5 theme-primary" /> Agente GODMODE</h2><p className="text-xs theme-secondary mt-1">Use modelo local ou provedor externo. Ferramentas de escrita/execução exigem aprovação individual.</p></div>
            <div className="grid md:grid-cols-3 gap-3">
              <Field label="Provedor"><select value={provider} onChange={event => setProvider(event.target.value as 'local' | 'openrouter')} className="lab-input"><option value="local">Local (Ollama / llama.cpp / LM Studio)</option><option value="openrouter">OpenRouter</option></select></Field>
              <Field label="Base URL"><input value={baseURL} onChange={event => setBaseURL(event.target.value)} className="lab-input" placeholder="http://127.0.0.1:11434/v1" /></Field>
              <Field label="Modelo"><input value={model} onChange={event => setModel(event.target.value)} className="lab-input" placeholder="qwen3:8b" /></Field>
            </div>
            <Field label={provider === 'local' ? 'Chave local (geralmente qualquer texto)' : 'OpenRouter API key'}><input type="password" value={modelKey} onChange={event => setModelKey(event.target.value)} className="lab-input" placeholder={provider === 'local' ? 'ollama' : 'sk-or-v1-...'} autoComplete="off" /></Field>
            <Field label="Tarefa"><textarea value={goal} onChange={event => setGoal(event.target.value)} rows={5} className="lab-input resize-y" placeholder="Descreva o que o agente deve investigar ou implementar..." /></Field>
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs theme-secondary">Memórias locais ativas incluídas: {memoriesEnabled ? memories.filter(memory => memory.active).length : 0}</span><button onClick={runAgent} disabled={running || !goal.trim() || !model.trim()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-theme-primary hover:glow-box hacker-btn disabled:opacity-40">{running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Executar tarefa</button></div>
          </section>

          {result && <section className="border border-theme-primary rounded-xl bg-theme-dim/40 p-4 md:p-5 space-y-3">
            <h2 className="font-bold text-lg flex items-center gap-2"><Terminal className="w-5 h-5 theme-primary" /> Resultado do agente</h2>
            {'pendingId' in result ? <div className="border border-amber-500/60 bg-amber-500/10 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-300 font-semibold"><ShieldCheck className="w-5 h-5" /> Aprovação necessária</div>
              <p className="text-sm">Ferramenta: <code>{result.tool}</code></p><p className="text-sm theme-secondary">{result.description}</p><pre className="text-xs overflow-auto max-h-56 p-3 rounded bg-black/30">{JSON.stringify(result.arguments, null, 2)}</pre><p className="text-xs theme-secondary">{result.message}</p>
              <div className="flex flex-wrap gap-2"><button onClick={() => approveTool(true)} disabled={running} className="px-4 py-2 rounded border border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">Aprovar esta ação</button><button onClick={() => approveTool(false)} disabled={running} className="px-4 py-2 rounded border border-rose-500/60 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">Rejeitar e cancelar</button></div>
            </div> : 'answer' in result ? <div className="text-sm whitespace-pre-wrap leading-6">{result.answer}</div> : 'message' in result ? <p className="text-sm theme-secondary">{result.message}</p> : 'error' in result ? <p className="text-sm text-rose-400">{result.error}</p> : null}
          </section>}

          {!!history.length && <section className="border border-theme-primary/50 rounded-xl p-4"><h3 className="font-semibold text-sm mb-2">Atividade desta sessão</h3><ul className="space-y-1 text-xs theme-secondary">{history.map((item, index) => <li key={`${index}-${item}`} className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 shrink-0" />{item}</li>)}</ul></section>}
          <footer className="text-xs theme-secondary flex flex-wrap items-center gap-2"><ShieldCheck className="w-4 h-4" />Gateway restrito a loopback · Aprovação por ferramenta · Chaves não persistidas pelo gateway</footer>
        </div>
      </section>
      <style jsx>{`.lab-input{width:100%;margin-top:6px;padding:10px 12px;border:1px solid var(--theme-primary);border-radius:8px;background:var(--theme-dim);color:inherit;font-size:13px;outline:none}.lab-input:focus{box-shadow:0 0 0 1px var(--theme-primary)}.lab-input option{background:#111;color:#eee}`}</style>
    </main>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="border border-theme-primary rounded-lg bg-theme-dim/40 p-3"><div className="flex items-center gap-2 text-xs theme-secondary">{icon}{label}</div><div className="font-bold text-lg mt-1 theme-primary">{value}</div></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs theme-secondary">{label}{children}</label>
}
