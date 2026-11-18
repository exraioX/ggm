// monitor.ts — SSE event bus para eventos do agente em tempo real
import { EventEmitter } from 'node:events';
import type { Response } from 'express';

// ============================================================
// Tipos de evento
// ============================================================

interface BaseEvent {
  agentId: string;
  sessionId: string;
  timestamp?: number;
}

interface AgentStartEvent extends BaseEvent {
  type: 'agent_start';
  model: string;
  task: string;
}

interface ToolCallEvent extends BaseEvent {
  type: 'tool_call';
  tool: string;
  args: object;
  approvalRequired: boolean;
}

interface ToolResultEvent extends BaseEvent {
  type: 'tool_result';
  tool: string;
  durationMs: number;
  isError: boolean;
  output?: string;
  exitCode?: number | null;
}

interface TokenUsageEvent extends BaseEvent {
  type: 'token_usage';
  promptTokens: number;
  completionTokens: number;
}

interface AgentDoneEvent extends BaseEvent {
  type: 'agent_done';
  totalMs: number;
  steps: number;
}

interface ErrorEvent extends BaseEvent {
  type: 'error';
  message: string;
}

interface WorkflowStepEvent extends BaseEvent {
  type: 'workflow_step';
  workflowId: string;
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  specialist: string;
  status: 'running' | 'completed' | 'failed';
  instruction: string;
  output?: string;
  durationMs?: number;
}

export type MonitorEvent =
  | AgentStartEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenUsageEvent
  | AgentDoneEvent
  | ErrorEvent
  | WorkflowStepEvent;

// ============================================================
// Classe Monitor
// ============================================================

const MAX_RING_SIZE = 100;
const HEARTBEAT_INTERVAL_MS = 25_000;

export class Monitor extends EventEmitter {
  // Ring buffer dos últimos 100 eventos para replay
  private ringBuffer: MonitorEvent[] = [];
  // Mapa de clientes SSE ativos: res → intervalo de heartbeat
  private clients: Map<Response, NodeJS.Timeout> = new Map();

  /**
   * Emite um evento tipado para todos os clientes SSE conectados
   * e o armazena no ring buffer.
   */
  override emit(event: MonitorEvent): boolean;
  override emit(eventName: string | symbol, ...args: any[]): boolean;
  override emit(eventOrName: MonitorEvent | string | symbol, ...args: any[]): boolean {
    if (typeof eventOrName === 'object' && eventOrName !== null && 'type' in eventOrName) {
      const event = eventOrName as MonitorEvent;
      // Adicionar timestamp se ausente
      if (!event.timestamp) {
        (event as BaseEvent).timestamp = Date.now();
      }

      // Armazenar no ring buffer (purge dos mais antigos)
      this.ringBuffer.push(event);
      if (this.ringBuffer.length > MAX_RING_SIZE) {
        this.ringBuffer.shift();
      }

      // Transmitir para todos os clientes SSE
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const [res] of this.clients) {
        try {
          res.write(payload);
        } catch {
          // Cliente desconectado; será removido pelo handler de 'close'
        }
      }

      super.emit(event.type, event);
      return true;
    }

    return super.emit(eventOrName as string | symbol, ...args);
  }

  /**
   * Adiciona um cliente SSE. Envia heartbeat a cada 25s e remove ao fechar.
   */
  addClient(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Replay dos eventos em buffer para o novo cliente
    for (const event of this.ringBuffer) {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Ignorar erros no replay inicial
      }
    }

    // Heartbeat periódico para manter a conexão viva
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        this.removeClient(res);
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.clients.set(res, heartbeat);

    // Remover cliente quando a conexão fechar
    res.on('close', () => this.removeClient(res));
    res.on('error', () => this.removeClient(res));
  }

  /**
   * Remove um cliente SSE e cancela seu heartbeat.
   */
  private removeClient(res: Response): void {
    const heartbeat = this.clients.get(res);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.clients.delete(res);
    }
  }

  /**
   * Retorna os últimos N eventos do ring buffer.
   */
  getEvents(limit = MAX_RING_SIZE): MonitorEvent[] {
    return this.ringBuffer.slice(-limit);
  }

  /**
   * Número de clientes SSE ativos.
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

// Singleton exportado
export const monitor = new Monitor();
