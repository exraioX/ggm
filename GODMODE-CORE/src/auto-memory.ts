// auto-memory.ts — Extração automática de memórias e detecção de complexidade para o LUPID
import { memoryManager } from './memory-manager.js';

interface Message {
  role: string;
  content: string;
}

const MEMORY_PATTERNS = [
  { regex: /(?:não use|evite|nunca use|prefira não)\s+([^.\n]+)/gi, category: 'Preferência', prefix: 'Restrição' },
  { regex: /(?:use sempre|prefira|utilizamos|padrão do projeto é)\s+([^.\n]+)/gi, category: 'Preferência', prefix: 'Padrão' },
  { regex: /(?:a arquitetura|estrutura do projeto|decisão arquitetural)\s+([^.\n]+)/gi, category: 'Decisão', prefix: 'Arquitetura' },
  { regex: /(?:o usuário prefere|o time usa|convenção:\s*)\s*([^.\n]+)/gi, category: 'Preferência', prefix: 'Convenção' },
  { regex: /(?:lembre-se que|importante:|nota:|obs:)\s+([^.\n]+)/gi, category: 'Referência', prefix: 'Nota' },
];

/**
 * Analisa as respostas recentes do agente e extrai automaticamente
 * regras, decisões e preferências sem exigir ação do usuário.
 */
export function extractMemoriesFromConversation(
  messages: Message[],
  projectId: string,
  sessionId: string,
): number {
  let extracted = 0;
  const assistantMessages = messages
    .filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 40)
    .slice(-6);

  for (const msg of assistantMessages) {
    for (const pattern of MEMORY_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(msg.content)) !== null) {
        const snippet = match[0].trim().slice(0, 400);
        if (snippet.length < 15) continue;

        // Evitar duplicatas óbvias no mesmo projeto
        const existing = memoryManager.list({ projectId, category: pattern.category });
        const isDuplicate = existing.some(m =>
          m.content.toLowerCase().includes(snippet.toLowerCase().slice(0, 35)),
        );

        if (!isDuplicate) {
          memoryManager.create({
            level: 'project',
            projectId,
            sessionId,
            title: `${pattern.prefix}: ${snippet.slice(0, 50)}...`,
            content: snippet,
            category: pattern.category,
            source: 'inference',
          });
          extracted++;
        }
      }
    }
  }

  return extracted;
}

/**
 * Calcula score de complexidade de uma mensagem (0 a 10).
 * Se >= 5, indica que a tarefa se beneficia do Orquestrador Multiagente.
 */
export function detectComplexity(text: string): number {
  if (!text) return 0;
  let score = 0;
  const lower = text.toLowerCase();

  const complexKeywords = ['implemente', 'crie', 'refatore', 'construa', 'desenvolva', 'adicione', 'integre', 'configure', 'instale'];
  const compoundIndicators = ['e também', 'além disso', 'depois', 'em seguida', 'adicionalmente', 'junto com'];
  const architecturalKeywords = ['sistema', 'módulo', 'arquitetura', 'estrutura', 'banco de dados', 'api', 'multiagente'];

  for (const w of complexKeywords) if (lower.includes(w)) score += 2;
  for (const w of compoundIndicators) if (lower.includes(w)) score += 1.5;
  for (const w of architecturalKeywords) if (lower.includes(w)) score += 1;
  if (text.length > 200) score += 1;
  if (text.split('\n').length > 3) score += 1;

  return Math.min(10, Math.round(score));
}
