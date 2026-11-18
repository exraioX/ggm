// claude-plugins.ts — Integração com plugins e configurações do Claude Code
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson } from './config.js';
import { mcpRegistry } from './mcp-registry.js';

export interface ClaudePluginInfo {
  name: string;
  version?: string;
  description?: string;
  source: 'claude-desktop' | 'claude-code' | 'custom';
  tools: string[];
  enabled: boolean;
}

export class ClaudePluginsManager {
  private getClaudeHome(): string {
    return path.join(os.homedir(), '.claude');
  }

  /**
   * Descobre configurações e plugins existentes do Claude Code / Claude Desktop.
   */
  discoverInstalled(): ClaudePluginInfo[] {
    const list: ClaudePluginInfo[] = [];
    const claudeHome = this.getClaudeHome();

    // 1. Verificar plugins e tools no mcpRegistry com source Claude
    for (const server of mcpRegistry.listConfigured()) {
      list.push({
        name: server.name,
        description: server.description || 'Servidor MCP compatível com Claude Code',
        source: 'claude-desktop',
        tools: mcpRegistry.listTools().filter(t => t.server === server.name).map(t => t.name),
        enabled: server.enabled !== false,
      });
    }

    // 2. Verificar pasta ~/.claude se existir
    try {
      if (fs.existsSync(claudeHome)) {
        const configFile = path.join(claudeHome, 'config.json');
        if (fs.existsSync(configFile)) {
          const cfg = readJson<Record<string, any>>(configFile, {});
          if (cfg.plugins && typeof cfg.plugins === 'object') {
            for (const [pName, pVal] of Object.entries(cfg.plugins)) {
              list.push({
                name: pName,
                description: 'Plugin nativo do Claude Code',
                source: 'claude-code',
                tools: [],
                enabled: (pVal as any)?.enabled !== false,
              });
            }
          }
        }
      }
    } catch {
      // Falha silenciosa na leitura do diretório do Claude
    }

    return list;
  }

  /**
   * Sincroniza e importa plugins e servidores do Claude Code para o GODMODE CORE.
   */
  async importFromClaudeDesktop(customPath?: string): Promise<{ imported: number; plugins: ClaudePluginInfo[] }> {
    const candidatePaths = [
      customPath,
      path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
      path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
      path.join(os.homedir(), '.claude', 'mcp.json'),
    ].filter(Boolean) as string[];

    let importedCount = 0;

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const content = readJson<any>(p, null);
          if (content && (content.mcpServers || content.servers)) {
            const res = await mcpRegistry.mergeConfig(content);
            importedCount += res.length;
            break;
          }
        } catch {
          // Tenta o próximo caminho
        }
      }
    }

    return {
      imported: importedCount,
      plugins: this.discoverInstalled(),
    };
  }
}

export const claudePluginsManager = new ClaudePluginsManager();
