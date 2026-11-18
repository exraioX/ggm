# GODMODE CORE — plataforma independente

O GODMODE CORE é o núcleo independente de orquestração. Ele não depende do G0DM0D3 para iniciar nem para conversar com modelos. O G0DM0D3 continua preservado como interface opcional e pode continuar usando as rotas de compatibilidade `/api/lab/*` deste núcleo.

## O que está incluído

- Interface web própria, em português, servida pelo próprio núcleo.
- Conversas por navegador com histórico local nesse navegador.
- Provedores locais e externos por API compatível com OpenAI (Ollama, llama.cpp, LM Studio e OpenRouter, conforme o endpoint oferecido pelo provedor).
- Credenciais de provedores mantidas apenas na memória do processo; não são gravadas pelo GODMODE CORE nos arquivos de provedor. Se o processo reiniciar, chaves inseridas na interface precisam ser inseridas novamente, salvo se forem fornecidas pelo ambiente por meio de `apiKeyEnv`.
- Receptor MCP genérico que importa `mcpServers` do Claude Desktop e também aceita `servers`.
- Transportes MCP: `stdio`, Streamable HTTP e SSE legado (o modo `auto` tenta Streamable HTTP e depois SSE).
- Descoberta de ferramentas MCP para o agente, além de recursos e prompts apresentados na interface (leitura/obtenção sob demanda).
- Aprovação individual antes de chamadas potencialmente mutáveis, comandos e caminhos fora do workspace.
- Memórias de texto persistentes em `~/.godmode/memory.json` (não é um banco vetorial).
- API REST e fachada OpenAI-compatible em `/v1` para outros clientes locais, com respostas normais e streaming SSE em `chat/completions`.
- Rotas de compatibilidade `/api/lab/*` para a página `/lab` do G0DM0D3 existente.

## Requisitos

- Node.js 22.16.0 ou superior e npm.
- Para servidores MCP `stdio`, instale os executáveis que declarar na configuração (por exemplo, `npx`, `uvx`, Python, Java ou outros runtimes exigidos por cada servidor).
- Modelos locais: Ollama, LM Studio ou llama.cpp em execução e com endpoint compatível. O endpoint precisa aceitar chamadas do núcleo.
- O núcleo usa `127.0.0.1` por padrão e não deve ser exposto à rede pública.

> O pacote MCP SDK está fixado na linha 1.x existente no projeto-base. A conexão HTTP usa Streamable HTTP como preferencial e mantém SSE para servidores legados. O SDK oficial descreve `stdio`, Streamable HTTP e SSE como os transportes disponíveis no cliente. Consulte https://ts.sdk.modelcontextprotocol.io/client.

## Instalação no Windows

Abra PowerShell na raiz do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GODMODE-CORE\install.ps1
.\GODMODE-CORE\start.ps1
```

Abra `http://127.0.0.1:8765`.

Ou manualmente:

```powershell
cd .\GODMODE-CORE
Copy-Item .env.example .env
npm install
npm run dev
```

## Workspace e arquivos persistentes

O workspace padrão é a pasta pai de `GODMODE-CORE` (raiz do repositório). Caminhos `cwd` relativos importados para servidores MCP são resolvidos a partir desse workspace. Ajuste `GODMODE_WORKSPACE` no `.env` caso queira outro projeto.

Os arquivos de estado ficam fora do repositório em `~/.godmode` (no Windows: `%USERPROFILE%\.godmode`):

- `mcp-servers.json` — servidores MCP importados/cadastrados.
- `providers.json` — nome, endpoint, modelo e tipo de provedor; não contém chaves inseridas pela interface.
- `memory.json` — memórias de texto persistentes.

A pasta recebe permissões restritas quando o sistema de arquivos permite. Em Windows, use ACLs da própria conta para controlar o acesso ao perfil.

## Provedores de IA

Na aba **Provedores de IA**, cadastre:

| Tipo | Endpoint de exemplo |
|---|---|
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp | endpoint OpenAI-compatible `/v1` configurado na sua instância |
| OpenRouter | `https://openrouter.ai/api/v1` |

O modelo deve ser o identificador que o servidor realmente fornece. Use **Buscar modelos** quando o endpoint implementar `/models`; se não listar, informe o modelo manualmente. Para provedores externos, a chave é mantida somente em memória durante a execução do núcleo. Alternativamente, configure uma variável de ambiente e indique seu nome em `apiKeyEnv` no arquivo local de provedores.

## Receptor MCP: importação Claude Desktop

Na aba **Integrações MCP**, cole ou selecione um JSON como este:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx.cmd",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Projetos"],
      "env": {}
    },
    "remote": {
      "url": "https://servidor.exemplo.com/mcp",
      "transport": "streamable-http",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

No exemplo acima, `npx.cmd` é usado para Windows; em macOS/Linux, use `npx`. O importador **mescla** os servidores: nomes novos são adicionados e nomes iguais são atualizados; os demais não são apagados. Depois da importação, o backend inicia automaticamente servidores habilitados, exceto os identificados como pesados (Playwright, Crawl4AI, ZAP, Ghidra, Trivy, Grype, Nmap, Nuclei e Amass) ou aqueles com `"autoStart": false`. Esses servidores ficam disponíveis para a IA por meio da ferramenta interna `start_mcp_server`, que exige aprovação antes de iniciar um processo local. A tela não possui botões de conectar/desconectar. Nunca importe configurações de origem desconhecida sem conferir `command`, `args`, `cwd`, `url` e os cabeçalhos; a importação solicita confirmação porque pode iniciar processos locais.

Para servidores HTTP, o núcleo aceita apenas HTTPS ou HTTP em loopback. URLs com usuário/senha embutidos ou fragmento são rejeitadas; query strings são aceitas, mas removidas da URL exibida na interface. Prefira `headers` para autenticação. Para não gravar segredos no arquivo `mcp-servers.json`, prefira placeholders como `${MCP_TOKEN}` e defina a variável no ambiente que inicia o processo GODMODE CORE.

Formato e diretório padrão do arquivo do Claude Desktop variam por sistema e instalação. O importador aceita o conteúdo JSON `mcpServers`; não lê automaticamente nem modifica a configuração do Claude Desktop.

### Limite de compatibilidade

O receptor integra **servidores que implementam o Model Context Protocol (MCP)**. Isso não significa que todo plugin, skill, extensão, comando ou integração exclusiva do Claude seja automaticamente compatível. Recursos que não falam MCP precisam de um adaptador específico. OAuth interativo não foi implementado nesta primeira versão; autenticação HTTP usa cabeçalhos estáticos/variáveis de ambiente. A primeira versão expõe tools, resources e prompts; sampling, elicitation, roots, notificações/subscrições de recursos e tasks não foram implementados como fluxos completos do cliente.

Consulte [docs/MCP-AUTO-START.md](docs/MCP-AUTO-START.md) para a configuração de inicialização automática, servidores sob demanda e a ferramenta interna de carregamento de MCP.

## Segurança e aprovações

- O servidor escuta em `127.0.0.1` (não use `0.0.0.0`).
- Na primeira inicialização, se ainda não existir `~/.godmode/mcp-servers.json`, o Core cria uma configuração com Filesystem, Memory e Sequential Thinking e inicia esses três servidores automaticamente.
- A inicialização automática é controlada por `GODMODE_MCP_AUTOSTART=false`; `GODMODE_MCP_DEFAULTS=false` impede a criação dos servidores padrão.
- Importar configurações solicita confirmação e inicia os servidores autorizados pela política `autoStart`; servidores pesados ficam sob demanda e só são iniciados pela IA após aprovação.
- Processos MCP são executáveis locais confiáveis, não sandboxes. A aprovação do GODMODE não substitui ACLs do Windows, isolamento de contêineres ou revisão da origem do pacote.
- Ferramentas com indicação destrutiva ou nomes de escrita/execução/instalação sempre exigem aprovação. Ferramentas sem indicação confiável de leitura também exigem aprovação.
- Caminhos fora de `GODMODE_WORKSPACE` exigem aprovação adicional.
- Aprovações são de uso único e expiram após 15 minutos; sessões de agente ficam na memória do processo.
- Chaves de provedor inseridas na UI ficam em memória no backend; não são retornadas pela API nem persistidas pelo núcleo.
- Os arquivos de configuração MCP podem conter credenciais se você as escrever diretamente. Prefira variáveis de ambiente.
- O CORS aceita a própria origem do Core e as origens locais explicitamente listadas em `GODMODE_ALLOWED_ORIGINS` (por padrão, as duas origens do G0DM0D3 na porta 3000). Outras páginas locais devem ser adicionadas explicitamente. O endpoint OpenAI-compatible local `/v1` não tem autenticação própria. Não o exponha em rede, túnel ou proxy público.

A proteção de aprovação é uma camada de controle do núcleo, não um sandbox. Um servidor MCP conectado pode executar as capacidades que ele próprio oferece. Use somente servidores confiáveis e mantenha o workspace apropriado. Ao atualizar a configuração de um servidor já conectado, o núcleo encerra a conexão antiga para não continuar usando parâmetros desatualizados.

## API

- `GET /api/health` — saúde do núcleo.
- `npm test` — testes locais de validação de endpoint, CORS, permissões e configuração MCP.
- `GET /api/providers` — provedores (credenciais redigidas).
- `GET /api/mcp/servers` — servidores configurados e estado das conexões.
- `GET /api/mcp/startup` — estado e resultado da inicialização automática.
- `autoStart: true|false` — controla a inicialização; ferramentas pesadas podem ser solicitadas pela IA via `start_mcp_server`.
- `POST /api/mcp/import` — importa/mescla um objeto com `mcpServers`.
- `GET /api/mcp/tools`, `/api/mcp/resources` e `/api/mcp/prompts` — capacidades anunciadas pelos servidores conectados.
- `POST /api/mcp/resources/read` e `/api/mcp/prompts/get` — leitura de recurso e obtenção de prompt sob demanda.
- `POST /api/chat` — conversa/agente com ferramentas MCP e aprovação.
- `POST /api/approvals/:id` — aprovar ou rejeitar uma ação pendente.
- `GET|POST /api/memory` — listar/criar memórias.
- `GET /v1/models` e `POST /v1/chat/completions` — fachada OpenAI-compatible.

Para clientes OpenAI-compatible, use a base `http://127.0.0.1:8765/v1` e um modelo listado em `/v1/models`, por exemplo `godmode/ollama/qwen3:8b`. Esse modelo é um identificador do núcleo, que encaminha a chamada ao provedor configurado.

## Relação com o G0DM0D3

O projeto original não é substituído. O G0DM0D3 permanece em `G0DM0D3/`. Inicie-o como antes, em outra porta (geralmente 3000), se desejar continuar usando a interface original. A página `/lab` existente pode continuar apontando para `http://127.0.0.1:8765`; o GODMODE CORE fornece rotas de compatibilidade para os endpoints antigos do laboratório.

O GODMODE CORE funciona sem iniciar o G0DM0D3 e mantém suas próprias conversas, provedores, servidores MCP e memórias. O histórico da interface web independente fica no `localStorage` do navegador; as memórias e configurações ficam no perfil local.

## O que ainda não está incluso

- Banco vetorial embutido. Goldie pode ser conectado como servidor MCP; a memória interna atual é texto persistente.
- Compressão automática do contexto em cada chamada. Headroom pode ser conectado como MCP, mas o pipeline de chat ainda não injeta um compressor de contexto automaticamente.
- Fluxos OAuth interativos para servidores MCP remotos.
- Sincronização de histórico entre navegadores/dispositivos.
- Sandbox forte de processos MCP.

Esses itens ficam explícitos para não confundir configuração ou descoberta de ferramentas com integração funcional já validada.


## Research Lab e Skills do Claude Code

O Research Lab fica em \`http://127.0.0.1:8765/research.html\` e reutiliza os provedores configurados na aba **Provedores de IA**. Ele executa testes controlados em até seis modelos, com até três repetições por caso e limite de 120 chamadas por execução. Resultados, prompts usados, respostas, latência, uso de tokens e avaliações humanas ficam em \`~/.godmode/research.json\`.

Consulte [docs/RESEARCH-LAB.md](docs/RESEARCH-LAB.md) para escopo, API, limites e privacidade.

O repositório também inclui Skills nativas do Claude Code em \`.claude/skills/\`:
- \`/research-design\`
- \`/red-team-evaluation\`
- \`/benchmark-authoring\`
- \`/analyze-model-results\`
- \`/research-report\`

Inicie Claude Code na raiz do repositório com \`claude\`. Consulte [docs/CLAUDE-CODE-SKILLS.md](docs/CLAUDE-CODE-SKILLS.md). Essa integração é compatibilidade de Skills em nível de projeto; não é uma cópia completa do ECC e não injeta Skills no runtime do GODMODE CORE.
