# Inicialização automática e ferramentas MCP

O GODMODE CORE atua como host MCP. Não é necessário clicar em "Conectar": os servidores habilitados são inicializados pelo backend e suas ferramentas são descobertas e entregues ao agente.

## Primeira execução

Se `~/.godmode/mcp-servers.json` ainda não existir, o Core cria uma configuração local com três servidores essenciais:

- Filesystem, limitado ao workspace configurado;
- Memory;
- Sequential Thinking.

Os três são executados por STDIO e iniciados em paralelo com concorrência máxima 2. Os pacotes são obtidos pelo `npx -y` na primeira execução, portanto a primeira inicialização precisa de conexão com o registro npm. Falhas de dependência não derrubam o servidor HTTP do GODMODE; aparecem no estado MCP.

A configuração gerada fica no perfil do usuário, fora do repositório. Uma configuração existente nunca é substituída.

## Importar servidores adicionais

A importação é uma ação explícita e pede confirmação porque um servidor STDIO executa um processo local. Após importar:

- Servidores normais iniciam automaticamente.
- Playwright, Crawl4AI, OWASP ZAP, Ghidra, Trivy, Grype, Nmap, Nuclei e Amass ficam sob demanda por padrão.
- `"autoStart": false` mantém qualquer servidor sob demanda.
- `"autoStart": true` solicita a inicialização durante o boot.
- `"enabled": false` mantém o servidor desativado.

Exemplo:

```json
{
  "mcpServers": {
    "my-local-tool": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "cwd": "C:/Audit/TargetSource",
      "autoStart": true
    },
    "heavy-tool": {
      "command": "npx.cmd",
      "args": ["-y", "some-mcp-package"],
      "autoStart": false,
      "resource_profile": "heavy"
    }
  }
}
```

Servidores sob demanda são anunciados à IA pela ferramenta interna `godmode_start_mcp_server`. Quando a IA solicitar um deles, o GODMODE apresenta a aprovação normal de ação local. Após a aprovação, conecta o servidor, descobre as ferramentas e atualiza o catálogo da conversa; não é necessário reconectar a interface.

## API

- `GET /api/mcp/servers`: lista estado, ferramentas, inicialização e erros.
- `GET /api/mcp/startup`: lista configuração e resultado do último ciclo de inicialização.
- `GET /api/mcp/tools`: ferramentas descobertas e prontas para uso.
- `POST /api/mcp/import`: importa e inicia servidores elegíveis.

A interface atualiza o estado MCP periodicamente e não oferece botões de conectar/desconectar. As rotas antigas de conexão continuam presentes por compatibilidade com clientes já existentes, mas não são usadas pela interface independente.

## Variáveis de ambiente

- `GODMODE_MCP_AUTOSTART=false`: não inicia automaticamente nenhum servidor; a IA ainda pode iniciar servidores sob demanda se houver configuração habilitada.
- `GODMODE_MCP_DEFAULTS=false`: não semeia a configuração inicial de Filesystem, Memory e Sequential Thinking.
- `GODMODE_MCP_CONFIG`: caminho alternativo para o arquivo de configuração.

## Segurança

A inicialização automática não transforma processos MCP em sandbox. Um servidor STDIO pode exercer as permissões da conta que executa o GODMODE. Use apenas pacotes confiáveis, fixe versões depois de validá-las e aplique ACLs do Windows. Ferramentas desconhecidas ou mutáveis continuam exigindo aprovação; operações de rede ativa e ações destrutivas continuam dentro do controle de autorização do laboratório.

A ferramenta interna de inicialização sob demanda também exige aprovação: iniciar um servidor pode baixar ou executar código local. O conteúdo retornado por ferramentas é sempre dado não confiável, nunca instruções de sistema.
