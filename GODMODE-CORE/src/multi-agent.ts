// multi-agent.ts — Sistema multiagente com especialistas e agente orquestrador
import { randomUUID } from 'node:crypto';
import { providerRegistry } from './providers.js';

export type SpecialistRole =
  | 'orchestrator'
  | 'coder'
  | 'researcher'
  | 'reviewer'
  | 'tester'
  | 'architect'
  | 'reverse_engineer';

export interface SpecialistProfile {
  role: SpecialistRole;
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
  recommendedTools: string[];
}

export interface WorkflowStep {
  id: string;
  specialist: SpecialistRole;
  instruction: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: string;
  durationMs?: number;
}

export interface WorkflowOptions {
  role?: SpecialistRole | 'auto';
  providerId?: string;
  projectName?: string;
  onStepUpdate?: (step: WorkflowStep, index: number, total: number, workflowId: string) => void;
}

export interface WorkflowResult {
  workflowId: string;
  task: string;
  providerId: string;
  executionMode: 'sequential-llm-specialists';
  steps: WorkflowStep[];
  finalSynthesis: string;
  completedSteps: number;
  failedSteps: number;
  success: boolean;
  totalDurationMs: number;
}

export const SPECIALISTS: Record<SpecialistRole, SpecialistProfile> = {
  orchestrator: {
    role: 'orchestrator',
    name: 'Orquestrador Principal',
    title: 'Lead Architect & Task Coordinator',
    description: 'Analisa o problema global, divide em subtarefas e delega para especialistas, sintetizando a entrega final.',
    systemPrompt: `Você é o Orquestrador Principal do GODMODE CORE.
Sua responsabilidade:
1. Decompor tarefas complexas em subtarefas atômicas para os especialistas.
2. Definir a ordem ótima de execução (pesquisa -> arquitetura -> codificação -> revisão -> teste).
3. Consolidar os resultados de cada especialista em uma resposta final coerente e acionável.`,
    recommendedTools: ['mcp-registry', 'project-indexer', 'memory-manager'],
  },
  coder: {
    role: 'coder',
    name: 'Programador Especialista',
    title: 'Senior Software Engineer',
    description: 'Focado em implementação de alta qualidade, refatoração, algoritmos eficientes e código limpo.',
    systemPrompt: `Você é o Programador Especialista do GODMODE CORE.
Sua responsabilidade:
1. Implementar código conciso, tipado, modular e seguindo os padrões do projeto.
2. Evitar complexidade desnecessária e respeitar convenções existentes.
3. Tratar erros de forma defensiva e nunca inventar importações inexistentes.`,
    recommendedTools: ['filesystem', 'diff-engine', 'checkpoints'],
  },
  researcher: {
    role: 'researcher',
    name: 'Pesquisador & Explorador',
    title: 'Codebase & Documentation Investigator',
    description: 'Investiga a base de código, mapeia arquivos, consulta documentação e esclarece dúvidas contextuais.',
    systemPrompt: `Você é o Pesquisador do GODMODE CORE.
Sua responsabilidade:
1. Investigar a base de código usando o índice de símbolos e leitura de arquivos.
2. Localizar referências, usos de funções, padrões de dependência e requisitos técnicos.
3. Fornecer resumos objetivos com caminhos exatos de arquivos e números de linha.`,
    recommendedTools: ['project-indexer', 'fetch', 'brave-search', 'filesystem:read'],
  },
  reviewer: {
    role: 'reviewer',
    name: 'Revisor de Código & Segurança',
    title: 'Code Reviewer & Security Auditor',
    description: 'Analisa diffs, aponta potenciais vulnerabilidades, regressões, vazamento de memória e boas práticas.',
    systemPrompt: `Você é o Revisor de Código e Segurança do GODMODE CORE.
Sua responsabilidade:
1. Auditar diffs de código linha a linha antes da aprovação.
2. Identificar bugs, quebra de contratos de API, falhas de segurança e anti-patterns.
3. Propor correções objetivas quando encontrar falhas.`,
    recommendedTools: ['diff-engine', 'security-scanner'],
  },
  tester: {
    role: 'tester',
    name: 'Especialista em Testes (QA)',
    title: 'Test & Quality Assurance Engineer',
    description: 'Projeta suítes de teste unitário, integração, valida regressões e analisa falhas de execução.',
    systemPrompt: `Você é o Especialista em Testes do GODMODE CORE.
Sua responsabilidade:
1. Elaborar casos de teste cobrindo casos de sucesso, falhas e edge cases.
2. Avaliar a integridade após modificações de código.
3. Diagnosticar falhas de suítes de teste e propor testes de regressão.`,
    recommendedTools: ['test-runner', 'sandbox'],
  },
  architect: {
    role: 'architect',
    name: 'Arquiteto de Sistemas',
    title: 'System & Software Architect',
    description: 'Modela contratos de API, padrões de projeto, separação de responsabilidades e diagramas estruturais.',
    systemPrompt: `Você é o Arquiteto de Sistemas do GODMODE CORE.
Sua responsabilidade:
1. Desenhar a arquitetura geral, fluxo de dados e limites entre módulos.
2. Garantir coesão alta e acoplamento fraco nos componentes.
3. Produzir diagramas conceituais claros e estruturados.`,
    recommendedTools: ['project-indexer', 'memory-manager'],
  },
  reverse_engineer: {
    role: 'reverse_engineer',
    name: 'Especialista em Engenharia Reversa',
    title: 'Reverse Engineer & Binary Analyst',
    description: 'Descompilação, análise de formatos de dados, reconstrução de protocolos e contratos de código legado.',
    systemPrompt: `Você é o Especialista em Engenharia Reversa do GODMODE CORE.
Sua responsabilidade:
1. Analisar binários, dumps de memória, código compilado ou ofuscado.
2. Reconstruir interfaces, assinaturas de métodos e protocolos de comunicação.
3. Explicar estruturas de dados e comportamento interno com clareza.`,
    recommendedTools: ['decompiler', 'disassembler', 'strings', 'hex-dump'],
  },
};

export class MultiAgentOrchestrator {
  listSpecialists(): SpecialistProfile[] {
    return Object.values(SPECIALISTS);
  }

  getSpecialist(role: SpecialistRole): SpecialistProfile {
    return SPECIALISTS[role] || SPECIALISTS.orchestrator;
  }

  /**
   * Planeja as etapas do workflow com base no objetivo da tarefa.
   */
  planWorkflow(task: string): WorkflowStep[] {
    const steps: WorkflowStep[] = [];

    // Sempre inicia com o orquestrador para análise
    steps.push({
      id: randomUUID(),
      specialist: 'orchestrator',
      instruction: `Analisar o objetivo e detalhar plano de execução para: "${task}"`,
      status: 'pending',
    });

    const isCoding = /\b(código|função|criar|implementar|fazer|refatorar|adicionar)\b/i.test(task);
    const isSecurityOrReview = /\b(revisar|auditoria|segurança|diff|vulnerabilidade)\b/i.test(task);
    const isReverse = /\b(reverso|binário|descompilar|protocolo|ofuscado)\b/i.test(task);

    if (isReverse) {
      steps.push({
        id: randomUUID(),
        specialist: 'reverse_engineer',
        instruction: 'Inspecionar a estrutura binária, fluxo de controle e assinaturas de funções.',
        status: 'pending',
      });
    } else {
      steps.push({
        id: randomUUID(),
        specialist: 'researcher',
        instruction: 'Mapear os arquivos relevantes e dependências do projeto para a tarefa.',
        status: 'pending',
      });
    }

    if (isCoding) {
      steps.push({
        id: randomUUID(),
        specialist: 'architect',
        instruction: 'Definir as interfaces, contratos e arquitetura da solução.',
        status: 'pending',
      });

      steps.push({
        id: randomUUID(),
        specialist: 'coder',
        instruction: 'Implementar a lógica necessária com código modular e tipado.',
        status: 'pending',
      });

      steps.push({
        id: randomUUID(),
        specialist: 'tester',
        instruction: 'Validar a implementação com testes unitários e verificar regressões.',
        status: 'pending',
      });
    }

    if (isSecurityOrReview || isCoding) {
      steps.push({
        id: randomUUID(),
        specialist: 'reviewer',
        instruction: 'Revisar a implementação, apontar vulnerabilidades e validar qualidade.',
        status: 'pending',
      });
    }

    // Etapa final de síntese do orquestrador
    steps.push({
      id: randomUUID(),
      specialist: 'orchestrator',
      instruction: 'Consolidar todos os resultados e produzir o relatório final.',
      status: 'pending',
    });

    return steps;
  }

  createWorkflowStepsForRole(task: string, role: SpecialistRole | 'auto' = 'auto'): WorkflowStep[] {
    const instruction = task.trim();
    if (!instruction) throw new Error('Informe uma tarefa para o workflow.');
    if (role === 'auto') return this.planWorkflow(instruction);
    return [{
      id: randomUUID(),
      specialist: role,
      instruction,
      status: 'pending',
    }];
  }

  /**
   * Executa um workflow multiagente coordenado usando provedores configurados.
   */
  async runWorkflow(
    task: string,
    options: WorkflowOptions = {},
  ): Promise<WorkflowResult> {
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error('Informe uma tarefa para o workflow.');

    const enabledProviders = providerRegistry.list().filter(provider => provider.enabled !== false && provider.model.trim());
    const provider = options.providerId
      ? enabledProviders.find(item => item.id === options.providerId)
      : enabledProviders[0];

    if (!provider) {
      throw new Error(options.providerId
        ? 'O provedor selecionado não está ativo ou não possui um modelo configurado.'
        : 'Nenhum provedor de IA ativo. Configure um provedor antes de executar o workflow.');
    }

    const role = options.role || 'auto';
    const steps = this.createWorkflowStepsForRole(normalizedTask, role);

    const workflowId = randomUUID();
    const startTime = Date.now();
    let accumulatedContext = [
      `Tarefa principal: ${normalizedTask}`,
      options.projectName ? `Projeto ativo: ${options.projectName}` : '',
      'Modo de execução: especialistas sequenciais usando o mesmo provedor de IA. Esta modalidade não executa ferramentas nativas/MCP diretamente.',
      '',
    ].filter(Boolean).join('\n');

    const client = providerRegistry.client(provider.id);

    for (const [index, step] of steps.entries()) {
      step.status = 'running';
      options.onStepUpdate?.(step, index, steps.length, workflowId);

      const specialist = this.getSpecialist(step.specialist);
      const stepStart = Date.now();
      const prompt = [
        `Projeto: ${options.projectName || 'não especificado'}`,
        `Contexto acumulado:\n${accumulatedContext}`,
        `Missão como ${specialist.name} (${specialist.title}):\n${step.instruction}`,
        'Entregue conclusões concretas, explicite incertezas e não alegue ter executado ferramentas, testes ou alterações que não foram realmente executados.',
      ].join('\n\n');

      try {
        const response = await client.chat.completions.create({
          model: provider.model,
          messages: [
            { role: 'system', content: specialist.systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1800,
        });

        const output = response.choices[0]?.message?.content;
        if (typeof output !== 'string' || !output.trim()) {
          throw new Error('O provedor retornou uma resposta vazia.');
        }

        step.output = output.trim();
        step.status = 'completed';
        accumulatedContext += `\n### ${specialist.name}\n${step.output}\n`;
      } catch (error) {
        step.status = 'failed';
        step.output = `Falha na etapa: ${error instanceof Error ? error.message : String(error)}`;
        accumulatedContext += `\n### ${specialist.name} — falhou\n${step.output}\n`;
      } finally {
        step.durationMs = Date.now() - stepStart;
        options.onStepUpdate?.(step, index, steps.length, workflowId);
      }
    }

    const completedSteps = steps.filter(step => step.status === 'completed').length;
    const failedSteps = steps.filter(step => step.status === 'failed').length;
    const finalStep = [...steps].reverse().find(step => step.specialist === 'orchestrator' && step.status === 'completed');
    const finalSynthesis = finalStep?.output
      || (steps.length === 1 ? steps[0].output || '' : accumulatedContext.trim());

    return {
      workflowId,
      task: normalizedTask,
      providerId: provider.id,
      executionMode: 'sequential-llm-specialists',
      steps,
      finalSynthesis,
      completedSteps,
      failedSteps,
      success: failedSteps === 0 && completedSteps === steps.length,
      totalDurationMs: Date.now() - startTime,
    };
  }
}

export const multiAgentOrchestrator = new MultiAgentOrchestrator();
