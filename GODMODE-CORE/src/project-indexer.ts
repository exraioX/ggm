// project-indexer.ts — Índice inteligente de arquivos, símbolos e dependências de projetos
import fs from 'node:fs';
import path from 'node:path';
import { GODMODE_HOME, readJson, safeWriteJson } from './config.js';

export interface SymbolItem {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'export';
  file: string;
  line: number;
  signature?: string;
}

export interface FileIndexItem {
  path: string;       // relativo à raiz do projeto
  size: number;
  mtime: number;
  lines: number;
  symbols: SymbolItem[];
  imports: string[];
}

export interface ProjectIndex {
  projectId: string;
  projectPath: string;
  indexedAt: string;
  totalFiles: number;
  totalSymbols: number;
  files: Record<string, FileIndexItem>; // chave: path relativo
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
  '.godmode', '.gemini', '.turbo', '.cache', 'target', '__pycache__', 'venv', '.env',
]);

const SUPPORTED_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.json', '.html', '.css', '.md',
]);

export class ProjectIndexer {
  private cache = new Map<string, ProjectIndex>();

  private getIndexPath(projectId: string): string {
    return path.join(GODMODE_HOME, 'indexes', `${projectId}.json`);
  }

  /**
   * Constrói ou atualiza o índice do projeto de forma incremental.
   */
  async buildIndex(projectId: string, projectPath: string, force = false): Promise<ProjectIndex> {
    const indexPath = this.getIndexPath(projectId);
    let existingIndex: ProjectIndex | null = force ? null : (this.cache.get(projectId) || readJson<ProjectIndex | null>(indexPath, null));

    if (!fs.existsSync(projectPath)) {
      throw new Error(`Pasta do projeto não existe: ${projectPath}`);
    }

    const filesMap: Record<string, FileIndexItem> = {};
    const allProjectFiles = this.scanDir(projectPath, projectPath);

    let totalSymbols = 0;

    for (const relPath of allProjectFiles) {
      const fullPath = path.join(projectPath, relPath);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const existingFile = existingIndex?.files[relPath];

      // Reutiliza cache se o arquivo não tiver sido alterado (mesmo mtime e tamanho)
      if (existingFile && existingFile.mtime === stat.mtimeMs && existingFile.size === stat.size) {
        filesMap[relPath] = existingFile;
        totalSymbols += existingFile.symbols.length;
        continue;
      }

      // Parse incremental do arquivo modificado ou novo
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const parsed = this.parseFile(relPath, content);
        filesMap[relPath] = {
          path: relPath,
          size: stat.size,
          mtime: stat.mtimeMs,
          lines: content.split('\n').length,
          symbols: parsed.symbols,
          imports: parsed.imports,
        };
        totalSymbols += parsed.symbols.length;
      } catch {
        // Se falhar a leitura de um arquivo, segue para os demais
      }
    }

    const newIndex: ProjectIndex = {
      projectId,
      projectPath,
      indexedAt: new Date().toISOString(),
      totalFiles: Object.keys(filesMap).length,
      totalSymbols,
      files: filesMap,
    };

    this.cache.set(projectId, newIndex);
    try {
      safeWriteJson(indexPath, newIndex);
    } catch {
      // Ignorar falha de gravação de cache em disco
    }

    return newIndex;
  }

  /**
   * Varre recursivamente diretórios respeitando lista de ignorados.
   */
  private scanDir(baseDir: string, currentDir: string): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        results.push(...this.scanDir(baseDir, path.join(currentDir, entry.name)));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          const rel = path.relative(baseDir, path.join(currentDir, entry.name)).replace(/\\/g, '/');
          results.push(rel);
        }
      }
    }

    return results;
  }

  /**
   * Extrai símbolos e imports usando expressões regulares eficientes.
   */
  private parseFile(relPath: string, content: string): { symbols: SymbolItem[]; imports: string[] } {
    const symbols: SymbolItem[] = [];
    const imports: string[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Imports em JS/TS/Python
      const tsImport = /from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\)/.exec(line);
      if (tsImport) {
        const imp = tsImport[1] || tsImport[2];
        if (imp && !imports.includes(imp)) imports.push(imp);
      }
      const pyImport = /(?:from\s+([a-zA-Z0-9_.]+)\s+import|import\s+([a-zA-Z0-9_.]+))/.exec(line);
      if (pyImport && !tsImport) {
        const imp = pyImport[1] || pyImport[2];
        if (imp && !imports.includes(imp)) imports.push(imp);
      }

      // Classes
      const classMatch = /(?:export\s+)?class\s+([A-Za-z0-9_$]+)/.exec(line);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: 'class', file: relPath, line: lineNum, signature: line.trim() });
        continue;
      }

      // Interfaces (TS)
      const ifaceMatch = /(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/.exec(line);
      if (ifaceMatch) {
        symbols.push({ name: ifaceMatch[1], kind: 'interface', file: relPath, line: lineNum, signature: line.trim() });
        continue;
      }

      // Types (TS)
      const typeMatch = /(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/.exec(line);
      if (typeMatch) {
        symbols.push({ name: typeMatch[1], kind: 'type', file: relPath, line: lineNum, signature: line.trim() });
        continue;
      }

      // Funções
      const fnMatch = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|def\s+([A-Za-z0-9_]+)\s*\(/.exec(line);
      if (fnMatch) {
        const name = fnMatch[1] || fnMatch[2];
        symbols.push({ name, kind: 'function', file: relPath, line: lineNum, signature: line.trim() });
        continue;
      }

      // Arrow functions / Const exports
      const constFnMatch = /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(line);
      if (constFnMatch) {
        symbols.push({ name: constFnMatch[1], kind: 'function', file: relPath, line: lineNum, signature: line.trim() });
        continue;
      }
    }

    return { symbols, imports };
  }

  /**
   * Busca símbolos pelo nome em todo o projeto.
   */
  searchSymbols(projectId: string, query: string): SymbolItem[] {
    const index = this.cache.get(projectId);
    if (!index) return [];
    const q = query.toLowerCase();
    const matches: SymbolItem[] = [];

    for (const file of Object.values(index.files)) {
      for (const sym of file.symbols) {
        if (sym.name.toLowerCase().includes(q)) {
          matches.push(sym);
        }
      }
    }
    return matches.slice(0, 50);
  }

  /**
   * Retorna resumo estruturado do projeto para injeção rápida no agente.
   */
  getSummary(projectId: string): string {
    const index = this.cache.get(projectId);
    if (!index) return '';

    const fileList = Object.keys(index.files);
    if (fileList.length === 0) return '';

    const lines: string[] = [
      `Índice do Projeto (${index.totalFiles} arquivos, ${index.totalSymbols} símbolos extraídos):`,
    ];

    // Listar principais arquivos e classes/funções
    for (const [relPath, file] of Object.entries(index.files).slice(0, 40)) {
      if (file.symbols.length > 0) {
        const topSymbols = file.symbols.slice(0, 6).map(s => `${s.kind} ${s.name}`).join(', ');
        lines.push(`- ${relPath} (${file.lines}L) -> [${topSymbols}]`);
      } else {
        lines.push(`- ${relPath} (${file.lines}L)`);
      }
    }

    if (fileList.length > 40) {
      lines.push(`... e mais ${fileList.length - 40} arquivo(s).`);
    }

    return lines.join('\n');
  }
}

export const projectIndexer = new ProjectIndexer();
