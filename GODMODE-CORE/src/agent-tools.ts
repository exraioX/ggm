// agent-tools.ts — Ferramentas nativas do agente no estilo Antigravity & Claude Code
import fs from 'node:fs';
import path from 'node:path';
import { processSandbox } from './sandbox.js';
import { checkpointManager } from './checkpoints.js';
import { generateUnifiedDiff, readFileSafe } from './diff-engine.js';

export interface NativeToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  requiresApproval: boolean;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const NATIVE_TOOLS: NativeToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Lê o conteúdo de um arquivo do projeto. Permite especificar linhas de início e fim.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo ou absoluto do arquivo dentro do projeto.' },
        start_line: { type: 'number', description: 'Linha inicial (base 1, opcional).' },
        end_line: { type: 'number', description: 'Linha final (inclusiva, opcional).' },
      },
      required: ['path'],
    },
    requiresApproval: false,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_file',
    description: 'Cria um novo arquivo ou sobrescreve um arquivo existente com o conteúdo fornecido. Cria diretórios pais automaticamente.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo a ser criado ou substituído.' },
        content: { type: 'string', description: 'Conteúdo completo do arquivo.' },
      },
      required: ['path', 'content'],
    },
    requiresApproval: true,
    annotations: { destructiveHint: true },
  },
  {
    name: 'edit_file',
    description: 'Substitui exatamente um trecho de texto no arquivo por outro (estilo edit_file do Claude Code e Antigravity).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo a ser modificado.' },
        target: { type: 'string', description: 'O texto exato a ser substituído (incluindo quebras de linha e indentação).' },
        replacement: { type: 'string', description: 'O novo texto que entrará no lugar do alvo.' },
      },
      required: ['path', 'target', 'replacement'],
    },
    requiresApproval: true,
    annotations: { destructiveHint: true },
  },
  {
    name: 'run_command',
    description: 'Executa um comando no terminal/PowerShell dentro do ambiente sandbox seguro do projeto.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Comando a ser executado (ex: npm test, git status, dir, tsc).' },
        args: { type: 'array', items: { type: 'string' }, description: 'Argumentos adicionais para o comando.' },
        timeout_seconds: { type: 'number', description: 'Tempo limite em segundos (padrão: 30s).' },
      },
      required: ['command'],
    },
    requiresApproval: true,
    annotations: { destructiveHint: true },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e diretórios dentro de um caminho no workspace do projeto.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho relativo da pasta a listar (deixe vazio para a raiz do projeto).' },
        depth: { type: 'number', description: 'Profundidade máxima de busca (padrão: 2).' },
      },
    },
    requiresApproval: false,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_files',
    description: 'Pesquisa arquivos por padrão de nome ou busca texto dentro dos arquivos do projeto (grep).',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Termo de busca ou regex.' },
        path: { type: 'string', description: 'Pasta onde buscar (opcional, padrão: raiz do projeto).' },
      },
      required: ['pattern'],
    },
    requiresApproval: false,
    annotations: { readOnlyHint: true },
  },
];

export class AgentToolsHandler {
  /**
   * Executa uma ferramenta nativa garantindo proteção de workspace e checkpoints.
   */
  async executeTool(
    name: string,
    args: Record<string, unknown>,
    workspace: string,
    sessionId: string,
  ): Promise<any> {
    const resolvedWorkspace = path.resolve(workspace);

    switch (name) {
      case 'read_file': {
        const filePath = String(args.path || '');
        const content = await readFileSafe(filePath, resolvedWorkspace);
        if (content === null) throw new Error(`Arquivo não encontrado ou fora do workspace: ${filePath}`);

        const lines = content.split('\n');
        const start = typeof args.start_line === 'number' && args.start_line > 0 ? args.start_line : 1;
        const end = typeof args.end_line === 'number' && args.end_line >= start ? args.end_line : lines.length;

        const slice = lines.slice(start - 1, end).join('\n');
        return {
          path: filePath,
          totalLines: lines.length,
          startLine: start,
          endLine: Math.min(end, lines.length),
          content: slice,
        };
      }

      case 'write_file': {
        const filePath = String(args.path || '');
        const content = String(args.content ?? '');
        const fullPath = path.resolve(resolvedWorkspace, filePath);

        // Validação estrita de workspace
        const rel = path.relative(resolvedWorkspace, fullPath);
        if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
          throw new Error(`Caminho fora do workspace: ${filePath}`);
        }

        // Checkpoint antes de modificar
        await checkpointManager.createCheckpoint(sessionId, [fullPath]);

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');

        return {
          ok: true,
          path: filePath,
          bytesWritten: Buffer.byteLength(content, 'utf8'),
          message: `Arquivo ${filePath} salvo com sucesso.`,
        };
      }

      case 'edit_file': {
        const filePath = String(args.path || '');
        const target = String(args.target || '');
        const replacement = String(args.replacement ?? '');
        const fullPath = path.resolve(resolvedWorkspace, filePath);

        const currentContent = await readFileSafe(filePath, resolvedWorkspace);
        if (currentContent === null) throw new Error(`Arquivo não encontrado: ${filePath}`);

        if (!currentContent.includes(target)) {
          throw new Error(`O texto de busca (target) não foi encontrado no arquivo ${filePath}. Verifique se caracteres e quebras de linha conferem exatamente.`);
        }

        // Checkpoint antes de modificar
        await checkpointManager.createCheckpoint(sessionId, [fullPath]);

        const updatedContent = currentContent.replace(target, replacement);
        fs.writeFileSync(fullPath, updatedContent, 'utf8');

        const diff = generateUnifiedDiff(currentContent, updatedContent, path.basename(filePath));

        return {
          ok: true,
          path: filePath,
          diff,
          message: `Arquivo ${filePath} modificado com sucesso.`,
        };
      }

      case 'run_command': {
        const cmdStr = String(args.command || '');
        const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
        const timeoutMs = (typeof args.timeout_seconds === 'number' ? args.timeout_seconds : 30) * 1000;

        const parts = cmdStr.trim().split(/\s+/);
        const mainCmd = parts[0];
        const allArgs = [...parts.slice(1), ...cmdArgs];

        const execResult = await processSandbox.execute(mainCmd, allArgs, {
          cwd: resolvedWorkspace,
          projectWorkspace: resolvedWorkspace,
          timeoutMs,
        });

        return {
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          durationMs: execResult.durationMs,
          timedOut: execResult.timedOut,
        };
      }

      case 'list_dir': {
        const subPath = String(args.path || '');
        const targetDir = path.resolve(resolvedWorkspace, subPath);
        const rel = path.relative(resolvedWorkspace, targetDir);
        if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
          throw new Error('Diretório fora do workspace.');
        }

        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
          throw new Error(`Pasta não encontrada: ${subPath}`);
        }

        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        const list = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: path.relative(resolvedWorkspace, path.join(targetDir, e.name)).replace(/\\/g, '/'),
        }));

        return { path: subPath || '.', totalEntries: list.length, entries: list };
      }

      case 'search_files': {
        const pattern = String(args.pattern || '').toLowerCase();
        const results: Array<{ file: string; line: number; match: string }> = [];

        function walk(dir: string) {
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const f of files) {
            if (f.name === 'node_modules' || f.name === '.git' || f.name === 'dist' || f.name.startsWith('.')) continue;
            const full = path.join(dir, f.name);
            if (f.isDirectory()) {
              walk(full);
            } else if (f.isFile()) {
              try {
                const text = fs.readFileSync(full, 'utf8');
                const lines = text.split('\n');
                lines.forEach((l, idx) => {
                  if (l.toLowerCase().includes(pattern)) {
                    if (results.length < 50) {
                      results.push({
                        file: path.relative(resolvedWorkspace, full).replace(/\\/g, '/'),
                        line: idx + 1,
                        match: l.trim().slice(0, 150),
                      });
                    }
                  }
                });
              } catch {
                // Arquivo binário ou ilegível
              }
            }
          }
        }

        walk(resolvedWorkspace);
        return { pattern, totalMatches: results.length, matches: results };
      }

      default:
        throw new Error(`Ferramenta nativa desconhecida: ${name}`);
    }
  }
}

export const agentToolsHandler = new AgentToolsHandler();
