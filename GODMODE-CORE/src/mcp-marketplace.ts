// mcp-marketplace.ts — Catálogo curado e gerenciador de ferramentas MCP
import { mcpRegistry, type McpServerDefinition } from './mcp-registry.js';

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  category: 'Sistema' | 'Desenvolvimento' | 'Dados' | 'Web' | 'Produtividade';
  command: string;
  args: string[];
  envTemplate?: Record<string, string>;
  permissions: string[];
  risk: 'low' | 'medium' | 'high';
  author: string;
  documentationUrl?: string;
}

const CURATED_CATALOG: MarketplaceEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    description: 'Acesso seguro a leitura e edição de arquivos no sistema de arquivos local.',
    category: 'Sistema',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    permissions: ['filesystem:read', 'filesystem:write'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'git',
    name: 'Git MCP',
    description: 'Operações de controle de versão: status, log, diff, commit, checkout e branches.',
    category: 'Desenvolvimento',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    permissions: ['git:read', 'git:commit'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'memory',
    name: 'Knowledge Graph Memory',
    description: 'Memória persistente estruturada em grafo de conhecimento e relações semânticas.',
    category: 'Dados',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    permissions: ['memory:read', 'memory:write'],
    risk: 'low',
    author: 'Anthropic',
  },
  {
    id: 'fetch',
    name: 'Web Fetch MCP',
    description: 'Requisições HTTP, conversão de HTML para Markdown e leitura de APIs externas.',
    category: 'Web',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    permissions: ['network:http-get'],
    risk: 'low',
    author: 'Anthropic',
  },
  {
    id: 'sqlite',
    name: 'SQLite Explorer',
    description: 'Inspeção, consultas SQL e análise de esquemas de bancos de dados SQLite locais.',
    category: 'Dados',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    permissions: ['database:query'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer Browser Automation',
    description: 'Navegação web automatizada, renderização de páginas JavaScript e capturas de tela.',
    category: 'Web',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    permissions: ['browser:navigate', 'browser:click', 'browser:screenshot'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'github',
    name: 'GitHub Integration',
    description: 'Gerenciamento de issues, pull requests, repositórios e buscas na API do GitHub.',
    category: 'Desenvolvimento',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envTemplate: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    permissions: ['github:read', 'github:write'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'everything-windows',
    name: 'Everything Windows Search',
    description: 'Busca instantânea de arquivos no disco via motor Voidtools Everything para Windows.',
    category: 'Sistema',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    permissions: ['system:search-files'],
    risk: 'low',
    author: 'Comunidade',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL Inspector',
    description: 'Consultas seguras em modo somente leitura e inspeção de schemas PostgreSQL.',
    category: 'Dados',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    envTemplate: { DATABASE_URL: 'postgresql://user:password@localhost:5432/mydb' },
    permissions: ['database:read'],
    risk: 'medium',
    author: 'Anthropic',
  },
  {
    id: 'brave-search',
    name: 'Brave Search API',
    description: 'Pesquisas na web aberta via API oficial do Brave Search com privacidade.',
    category: 'Web',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envTemplate: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    permissions: ['web:search'],
    risk: 'low',
    author: 'Anthropic',
  },
];

export class McpMarketplace {
  listCatalog(category?: string, query?: string): MarketplaceEntry[] {
    let result = [...CURATED_CATALOG];
    if (category) {
      result = result.filter(item => item.category.toLowerCase() === category.toLowerCase());
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(item => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
    }
    return result;
  }

  getEntry(id: string): MarketplaceEntry | undefined {
    return CURATED_CATALOG.find(item => item.id === id);
  }

  async install(id: string, customEnv?: Record<string, string>): Promise<McpServerDefinition> {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Servidor MCP "${id}" não encontrado no catálogo.`);

    const serverDef: McpServerDefinition = {
      name: entry.id,
      description: entry.description,
      enabled: true,
      command: entry.command,
      args: entry.args,
      env: { ...(entry.envTemplate || {}), ...(customEnv || {}) },
      transport: 'stdio',
    };

    const currentConfig = mcpRegistry.getConfigForExport();
    currentConfig.mcpServers[serverDef.name] = {
      command: serverDef.command,
      args: serverDef.args,
      env: serverDef.env,
      description: serverDef.description,
    };

    await mcpRegistry.saveConfig(currentConfig);
    return serverDef;
  }

  async toggleServer(name: string, enabled: boolean): Promise<void> {
    const currentConfig = mcpRegistry.getConfigForExport();
    const serverObj = currentConfig.mcpServers[name] as Record<string, unknown> | undefined;
    if (!serverObj) throw new Error(`Servidor "${name}" não está configurado.`);

    serverObj.disabled = !enabled;
    await mcpRegistry.saveConfig(currentConfig);

    if (!enabled) {
      await mcpRegistry.disconnect(name).catch(() => undefined);
    }
  }

  getInstallationStatus(): Array<{ id: string; installed: boolean; enabled: boolean; connected: boolean }> {
    const configured = mcpRegistry.listConfigured();
    return CURATED_CATALOG.map(entry => {
      const found = configured.find(c => c.name === entry.id);
      return {
        id: entry.id,
        installed: Boolean(found),
        enabled: found ? found.enabled !== false : false,
        connected: found ? Boolean(found.connected) : false,
      };
    });
  }
}

export const mcpMarketplace = new McpMarketplace();
