# GODMODE CORE — plataforma independente

O GODMODE CORE é um núcleo de orquestração autônomo: interface própria, API própria e armazenamento próprio. Ele não depende de nenhuma outra interface para iniciar ou para conversar com modelos.

## O que está incluído

- Interface web própria, em português, servida pelo núcleo, com barra de atividades, painel de workspace, Explorer, editor em abas, paleta de comandos, painel inferior de execução e barra de status.
- Conversas por navegador com histórico local nesse navegador, incluindo anexos de imagem (arraste e solte, colar da área de transferência ou selecionar arquivo) para modelos com suporte a visão.
- Provedores locais e externos por API compatível com OpenAI (Ollama, llama.cpp, LM Studio e OpenRouter, conforme o endpoint oferecido pelo provedor).
- Credenciais de provedores mantidas apenas na memória do processo; não são gravadas pelo GODMODE CORE nos arquivos de provedor. Se o processo reiniciar, chaves inseridas na interface precisam ser inseridas novamente, salvo se forem fornecidas pelo ambiente por meio de `apiKeyEnv`.
- Receptor MCP genérico que importa `mcpServers` do Claude Desktop e também aceita `servers`.
- Transportes MCP: `stdio`, Streamable HTTP e SSE legado (o modo `auto` tenta Streamable HTTP e depois SSE).
- Descoberta de ferramentas MCP para o agente, além de recursos e prompts apresentados na interface (leitura/obtenção sob demanda).
- Aprovação individual antes de chamadas potencialmente mutáveis, comandos e caminhos fora do workspace — incluindo caminhos disfarçados como URIs `file://`.
- Memórias de texto persistentes em `~/.godmode/memory.json` (não é um banco vetorial).
- Centro de Missões que reúne execução imediata, fila persistente, histórico de resultados, repetição de tarefas com falha e validação de projeto (testes, lint e build/typecheck).
- Painel de Execução que reúne timeline SSE e saída real das ferramentas; a limpeza do histórico é compartilhada entre as abas abertas.
- Consulta de resources e prompts MCP anunciados por servidores conectados.
- API REST e fachada OpenAI-compatible em `/v1` para outros clientes locais, com respostas normais e streaming SSE em `chat/completions`.

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

No exemplo acima, `npx.cmd` é usado para Windows; em macOS/Linux, use `npx`. O importador **mescla** os servidores: nomes novos são adicionados e nomes iguais são atualizados; os demais não são apagados. Importar apenas registra a configuração. Um servidor `stdio` só é iniciado quando você clicar em **Conectar**. Nunca importe configurações de origem desconhecida sem conferir `command`, `args`, `cwd`, `url` e os cabeçalhos.

Para servidores HTTP, o núcleo aceita apenas HTTPS ou HTTP em loopback. URLs com usuário/senha embutidos ou fragmento são rejeitadas; query strings são aceitas, mas removidas da URL exibida na interface. Prefira `headers` para autenticação. Para não gravar segredos no arquivo `mcp-servers.json`, prefira placeholders como `${MCP_TOKEN}` e defina a variável no ambiente que inicia o processo GODMODE CORE.

Formato e diretório padrão do arquivo do Claude Desktop variam por sistema e instalação. O importador aceita o conteúdo JSON `mcpServers`; não lê automaticamente nem modifica a configuração do Claude Desktop.

### Limite de compatibilidade

O receptor integra **servidores que implementam o Model Context Protocol (MCP)**. Isso não significa que todo plugin, skill, extensão, comando ou integração exclusiva do Claude seja automaticamente compatível. Recursos que não falam MCP precisam de um adaptador específico. OAuth interativo não foi implementado nesta primeira versão; autenticação HTTP usa cabeçalhos estáticos/variáveis de ambiente. A primeira versão expõe tools, resources e prompts; sampling, elicitation, roots, notificações/subscrições de recursos e tasks não foram implementados como fluxos completos do cliente.

## Segurança e aprovações

- O servidor escuta em `127.0.0.1` (não use `0.0.0.0`).
- A configuração MCP importada não é executada automaticamente.
- Conexão `stdio` inicia o executável informado pelo usuário; a interface mostra comando/argumentos e solicita confirmação antes de conectar. A conexão em lote também pede confirmação.
- Ferramentas com indicação destrutiva ou nomes de escrita/execução/instalação sempre exigem aprovação. Ferramentas sem indicação confiável de leitura também exigem aprovação.
- Caminhos fora de `GODMODE_WORKSPACE` exigem aprovação adicional.
- Aprovações são de uso único e expiram após 15 minutos; sessões de agente ficam na memória do processo.
- Chaves de provedor inseridas na UI ficam em memória no backend; não são retornadas pela API nem persistidas pelo núcleo.
- Os arquivos de configuração MCP podem conter credenciais se você as escrever diretamente. Prefira variáveis de ambiente.
- O CORS aceita, por padrão, somente a própria origem do Core. Outras páginas locais só são aceitas se listadas explicitamente em `GODMODE_ALLOWED_ORIGINS`. O endpoint OpenAI-compatible local `/v1` não tem autenticação própria. Não o exponha em rede, túnel ou proxy público.
- Anexos de imagem enviados pela interface são validados no servidor (tipo MIME, tamanho e formato de `data URL`) antes de seguir para o provedor de IA; o limite de corpo da requisição HTTP foi ajustado para comportar esses anexos sem abrir mão da validação.

A proteção de aprovação é uma camada de controle do núcleo, não um sandbox. Um servidor MCP conectado pode executar as capacidades que ele próprio oferece. Use somente servidores confiáveis e mantenha o workspace apropriado. Ao atualizar a configuração de um servidor já conectado, o núcleo encerra a conexão antiga para não continuar usando parâmetros desatualizados.

## API

- `GET /api/health` — saúde do núcleo.
- `npm test` — testes locais de validação de endpoint, CORS, permissões e configuração MCP.
- `GET /api/providers` — provedores (credenciais redigidas).
- `GET /api/mcp/servers` — servidores configurados e estado das conexões.
- `POST /api/mcp/import` — importa/mescla um objeto com `mcpServers`.
- `GET /api/mcp/tools`, `/api/mcp/resources` e `/api/mcp/prompts` — capacidades anunciadas pelos servidores conectados.
- `POST /api/mcp/resources/read` e `/api/mcp/prompts/get` — leitura de recurso e obtenção de prompt sob demanda.
- `POST /api/chat` — conversa/agente com ferramentas MCP e aprovação.
- `POST /api/approvals/:id` — aprovar ou rejeitar uma ação pendente.
- `GET|POST /api/memory` — listar/criar memórias.
- `GET /v1/models` e `POST /v1/chat/completions` — fachada OpenAI-compatible.

Para clientes OpenAI-compatible, use a base `http://127.0.0.1:8765/v1` e um modelo listado em `/v1/models`, por exemplo `godmode/ollama/qwen3:8b`. Esse modelo é um identificador do núcleo, que encaminha a chamada ao provedor configurado.

## Operação independente

O GODMODE CORE mantém suas próprias conversas, provedores, servidores MCP e memórias, sem depender de nenhuma outra interface para funcionar. O histórico da interface web fica no `localStorage` do navegador; as memórias e configurações ficam no perfil local (`~/.godmode`).

## O que ainda não está incluso

- Banco vetorial embutido. Goldie pode ser conectado como servidor MCP; a memória interna atual é texto persistente.
- Compressão automática do contexto em cada chamada. Headroom pode ser conectado como MCP, mas o pipeline de chat ainda não injeta um compressor de contexto automaticamente.
- Fluxos OAuth interativos para servidores MCP remotos.
- Sincronização de histórico entre navegadores/dispositivos.
- Sandbox forte de processos MCP.

Esses itens ficam explícitos para não confundir configuração ou descoberta de ferramentas com integração funcional já validada.

## Interface Workbench (IDE)

A interface do Core usa um layout de IDE inspirado no fluxo de trabalho do VS Code e do Antigravity: barra de atividades, painel Explorer, abas de arquivos, editor local, chat do agente, monitor e áreas de ferramentas. O tema é integrado à interface original do Core, sem substituir a API, os provedores, as integrações MCP ou o sistema de aprovações.

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl/Cmd + Shift + P` | Abrir a paleta de comandos |
| `Ctrl/Cmd + 1` | Ir para o Chat do Agente |
| `Ctrl/Cmd + 2` | Ir para Arquivos e Editor |
| `Ctrl/Cmd + S` | Salvar o arquivo ativo no editor |

O editor mantém várias abas abertas, sinaliza alterações não salvas, permite alternar e fechar abas, exibe numeração de linhas e posição do cursor e oferece filtro da árvore de arquivos. Ao trocar de projeto, alterações pendentes são confirmadas antes de fechar o workspace atual. O salvamento continua passando pela API local e pelo mecanismo de checkpoint do Core.

## Missões, fila e validação

A tela **Orquestrador de Missões** é a entrada única para o trabalho planejado:

- **Automático** cria um plano sequencial com os especialistas aplicáveis.
- Selecionar um especialista executa somente aquele perfil.
- **Executar agora** e **Adicionar à fila** usam o mesmo executor do backend. A fila mantém estado, resultado e erro; tarefas com falha podem ser reenfileiradas.
- A execução multiagente atual faz chamadas sequenciais ao mesmo provedor configurado e compartilha contexto entre os perfis. Ela não executa ferramentas nativas ou MCP por conta própria e não aplica alterações ao repositório. Para ler/editar arquivos, executar comandos ou acionar ferramentas MCP com aprovações, use o **Chat do Agente**.

Na mesma tela, o **Validador do Projeto** executa os comandos configurados para testes, lint e build/typecheck pelo ProcessSandbox, dentro da pasta do projeto. Os comandos e o limite de tempo são configuráveis por projeto. No Windows, os comandos comuns `npm`, `npx`, `pnpm` e `yarn` são resolvidos por seus shims `.cmd`.

A tela **Painel de Execução** combina timeline de eventos e terminal. As saídas de ferramentas são limitadas a 6.000 caracteres por evento no monitor; a limpeza apaga o buffer compartilhado em memória e sincroniza as abas SSE conectadas. O histórico não é persistido após reiniciar o processo.

As permissões de segurança continuam no backend. O seletor visual de “autonomia” foi removido por não controlar permissões reais: o toggle de ferramentas no Chat controla se o modelo recebe ferramentas, e operações mutáveis continuam sujeitas às aprovações do núcleo.

### API de missões e validação

- `POST /api/agents/workflow/plan` — planejar uma missão.
- `POST /api/agents/workflow/run` — executar uma missão imediata pelo executor compartilhado com a fila.
- `GET /api/tasks` — consultar tarefas e estatísticas do projeto.
- `POST /api/tasks` — adicionar tarefa à fila.
- `POST /api/tasks/run` — processar as tarefas pendentes do projeto sequencialmente.
- `POST /api/tasks/:id/retry` — reenfileirar tarefa com falha.
- `POST /api/projects/:id/tests/run` e `GET|POST /api/projects/:id/tests/config` — executar/configurar testes, lint e build.
- `GET /api/monitor/events`, `GET /api/monitor/stream` e `POST /api/monitor/clear` — ler, acompanhar e limpar eventos.
- `POST /api/mcp/resources/read` e `POST /api/mcp/prompts/get` — consultar capacidades MCP anunciadas.

### Validação contínua

O workflow do GitHub Actions em `.github/workflows/validate-core.yml` instala dependências com `npm ci`, executa `npm run typecheck` e `npm test` no diretório `GODMODE-CORE` para pushes e pull requests em `claude` e `main`.
