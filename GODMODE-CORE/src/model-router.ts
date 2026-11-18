// model-router.ts — Roteador inteligente de modelos e provedores de IA
import OpenAI from 'openai';
import { providerRegistry, type ProviderDefinition } from './providers.js';

export type TaskType = 'code' | 'review' | 'research' | 'test' | 'summary' | 'chat';

export interface RouteDecision {
  taskType: TaskType;
  provider: ProviderDefinition;
  model: string;
  reason: string;
  fallbackChain: Array<{ providerId: string; model: string }>;
}

export class ModelRouter {
  /**
   * Identifica a intenção da tarefa baseada no texto das mensagens.
   */
  detectTaskType(messages: Array<{ role: string; content: string }>): TaskType {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content.toLowerCase() || '';

    if (/\b(teste|testar|tests|unit test|spec|smoke|coverage)\b/i.test(lastUserMessage)) {
      return 'test';
    }
    if (/\b(código|função|classe|implemente|escreva|crie o código|refatore|bug|fix|typescript|javascript|python)\b/i.test(lastUserMessage)) {
      return 'code';
    }
    if (/\b(revise|auditoria|analise o diff|code review|segurança|vulnerabilidade)\b/i.test(lastUserMessage)) {
      return 'review';
    }
    if (/\b(pesquise|busque|procure|onde fica|qual arquivo|encontre|como funciona)\b/i.test(lastUserMessage)) {
      return 'research';
    }
    if (/\b(resuma|resumo|explique resumidamente|tldr|sintetize)\b/i.test(lastUserMessage)) {
      return 'summary';
    }
    return 'chat';
  }

  /**
   * Seleciona o melhor provedor e modelo disponível com base na tarefa e contexto.
   */
  select(messages: Array<{ role: string; content: string }>, preferredProviderId?: string): RouteDecision {
    const taskType = this.detectTaskType(messages);
    let enabledProviders = providerRegistry.list().filter(p => p.enabled !== false && p.model.trim());

    // Se nenhum provedor tiver modelo explicitamente preenchido, usa os provedores habilitados disponíveis
    if (!enabledProviders.length) {
      enabledProviders = providerRegistry.list().filter(p => p.enabled !== false);
    }

    if (!enabledProviders.length) {
      throw new Error('Nenhum provedor de IA habilitado.');
    }

    // Se usuário especificou um provedor preferido e ele está configurado
    let chosen: ProviderDefinition | undefined;
    if (preferredProviderId) {
      chosen = enabledProviders.find(p => p.id === preferredProviderId);
    }

    // Se não há preferência ou o preferido não existe, priorizar provedores locais
    if (!chosen) {
      // Prioridade 1: Local (Ollama, LM Studio, llama.cpp)
      const localProvider = enabledProviders.find(p => p.kind === 'openai-compatible' && /127\.0\.0\.1|localhost/i.test(p.baseUrl));
      // Prioridade 2: Cloud / OpenRouter
      const cloudProvider = enabledProviders.find(p => p.kind === 'openrouter' || p.hasSecret);

      chosen = localProvider || cloudProvider || enabledProviders[0];
    }

    // Montar cadeia de fallback com todos os outros provedores habilitados
    const fallbackChain = enabledProviders
      .filter(p => p.id !== chosen!.id)
      .map(p => ({ providerId: p.id, model: p.model }));

    let reason = `Tarefa classificada como "${taskType}". `;
    if (chosen.id === preferredProviderId) {
      reason += `Usando provedor preferido "${chosen.name}".`;
    } else if (/127\.0\.0\.1|localhost/i.test(chosen.baseUrl)) {
      reason += `Priorizando execução local privada via "${chosen.name}".`;
    } else {
      reason += `Usando provedor "${chosen.name}".`;
    }

    return {
      taskType,
      provider: chosen,
      model: chosen.model.trim() || 'default-model',
      reason,
      fallbackChain,
    };
  }

  /**
   * Executa chamada com fallback automático: se o provedor principal falhar,
   * tenta os próximos da cadeia de fallback sequencialmente.
   */
  async executeChatCompletion<T>(
    decision: RouteDecision,
    fn: (client: OpenAI, model: string, providerId: string) => Promise<T>,
  ): Promise<{ result: T; usedProviderId: string; usedModel: string; fallbacksAttempted: string[] }> {
    const fallbacksAttempted: string[] = [];
    const candidates = [
      { providerId: decision.provider.id, model: decision.model },
      ...decision.fallbackChain,
    ];

    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        const client = providerRegistry.client(candidate.providerId);
        const result = await fn(client, candidate.model, candidate.providerId);
        return {
          result,
          usedProviderId: candidate.providerId,
          usedModel: candidate.model,
          fallbacksAttempted,
        };
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        fallbacksAttempted.push(`${candidate.providerId}: ${msg}`);
        // Se houver mais candidatos, continua o loop para tentar o próximo
      }
    }

    throw new Error(
      `Todos os provedores falharam. Tentados: ${candidates.map(c => c.providerId).join(', ')}. Último erro: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }
}

export const modelRouter = new ModelRouter();
