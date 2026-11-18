# Validação — GODMODE CORE independente

## Verificações realizadas no ambiente de preparação

- [x] Reaberto e analisado o ZIP de origem mais recente, preservando os diretórios originais `G0DM0D3/` e `GODMODE-LAB/`.
- [x] Criado o núcleo independente `GODMODE-CORE/`, com interface própria em português, API REST e fachada OpenAI-compatible.
- [x] Criados adaptadores de provedores OpenAI-compatible para Ollama, llama.cpp, LM Studio e OpenRouter.
- [x] Criado registro MCP configurável por `mcpServers` (Claude Desktop) ou `servers`.
- [x] Implementados os transportes stdio, Streamable HTTP e SSE legado; o modo automático tenta Streamable HTTP e depois SSE.
- [x] Implementada descoberta de tools, resources e prompts; recursos e prompts podem ser consultados na interface.
- [x] Implementadas validações de endpoint, allowlist de CORS, placeholders de ambiente obrigatórios e política de aprovação para ferramentas potencialmente mutáveis.
- [x] Conexões stdio só iniciam após ação explícita e confirmação na interface.
- [x] Configuração MCP alterada encerra conexão antiga antes de aplicar a nova configuração.
- [x] Histórico de conversas do navegador, configurações e memórias do Core são independentes do estado interno do G0DM0D3.
- [x] `node --check GODMODE-CORE/ui/app.js` passou após as alterações.
- [x] Fontes TypeScript foram analisadas/transpiladas sintaticamente com o TypeScript disponível no ambiente de preparação.
- [x] Arquivos JSON do projeto e a configuração exemplo foram analisados como JSON válido.

## Não foi possível validar neste ambiente

- [ ] `npm install`/`npm ci` completo: o ambiente de preparação não conseguiu alcançar o registry npm (erro de rede/DNS `EAI_AGAIN`) e o cache local não continha todos os metadados/pacotes.
- [ ] `npm run typecheck` foi tentado, mas parou com `TS2688` porque `@types/node` não está instalado (`node_modules` ausente).
- [ ] `npm test` foi tentado, mas parou porque o executável `tsx` não está instalado (`node_modules` ausente).
- [ ] Inicialização real do servidor, build de produção, conexão com Ollama/OpenRouter e servidores MCP externos.
- [ ] Testes de recursos/prompts em servidores MCP reais e validação com configurações reais do Claude Desktop.

## Próxima validação no Windows

No PowerShell, a partir da raiz do projeto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GODMODE-CORE\install.ps1
.\GODMODE-CORE\start.ps1
```

Abra `http://127.0.0.1:8765`, configure um provedor local e, na aba Integrações MCP, importe primeiro um servidor confiável de teste. Em outro terminal pode executar `npm run typecheck` e `npm test` dentro de `GODMODE-CORE`.

## Limites conhecidos

O núcleo é independente do G0DM0D3, mas não declara compatibilidade com qualquer plugin proprietário do Claude. O plugin precisa implementar MCP ou exigir um adaptador. A configuração `mcpServers` é importada por conteúdo JSON; o Core não altera o arquivo privado do Claude Desktop. OAuth interativo, sampling, elicitation, roots, subscrições de recursos, tarefas MCP e sandbox forte de processos não estão implementados nesta entrega. Headroom ainda não está acoplado como compressor automático do pipeline de contexto; Goldie não está instalado. A memória integrada é JSON persistente, não vetorial.

## Auditoria de integração — 18 de novembro de 2026

A revisão de produto e código consolidou fluxos que antes estavam separados:

- Workflow imediato e fila passaram a usar o mesmo executor; a escolha de especialista é respeitada e os resultados deixam de ser apagados ao concluir.
- Tarefas podem ser reenfileiradas; a limpeza por projeto preserva tarefas globais e tarefas de outros projetos.
- O executor de testes existente passou a ser acessível pela interface para test, lint e build/typecheck, com configuração por projeto.
- Monitor e terminal passaram a compartilhar o mesmo stream de eventos; saídas de ferramentas são limitadas a 6.000 caracteres por evento.
- O monitor passou a limpar o buffer compartilhado e sincronizar a ação entre clientes SSE conectados.
- Resources e prompts MCP passaram a ter listas e ações de consulta na interface.
- O seletor cosmético de autonomia foi removido: ele não alterava permissões do backend. As aprovações continuam sendo aplicadas pelo núcleo.
- A seleção de especialista explícita executa um único perfil; o modo automático gera o plano sequencial com especialistas.
- O parser do TestRunner passou a preservar caminhos Windows e argumentos entre aspas; comandos npm/npx/pnpm/yarn usam os shims .cmd no Windows.

### Regressões adicionadas

- `test/ui-contract.test.ts` — destinos de navegação, IDs duplicados, consolidação das telas, contratos do centro de missões, capacidades MCP, terminal e presença de estilos.
- `test/phase4.test.ts` — parser de comandos com caminhos Windows/aspas e seleção explícita de especialista.
- `test/phase5-v2.test.ts` — retry limpa resultado/erro anterior e clear de projeto não remove tarefas globais ou de outros projetos.
- `.github/workflows/validate-core.yml` — CI para `npm ci`, typecheck e suite de testes.

### Resultado de validação desta auditoria

- [x] JavaScript da interface analisado sintaticamente após as mudanças.
- [x] Estrutura HTML revisada: IDs duplicados ausentes e todos os destinos `data-view` com uma tela correspondente.
- [x] Revisados os contratos de UI/API para missão, fila, TestRunner e resources/prompts MCP.
- [x] Conferida a presença dos estilos das novas áreas.
- [x] GitHub Actions run [#44328462285](https://github.com/exraioX/ggm/actions/runs/44328462285), no commit `883cde8`, concluiu com sucesso usando `actions/checkout@v7` e `actions/setup-node@v7`.
- [x] `npm ci` concluiu com sucesso no GitHub Actions.
- [x] `npm run typecheck` concluiu com sucesso no GitHub Actions.
- [x] `npm test` concluiu com **39 testes aprovados, 0 falhas, 0 cancelados e 0 ignorados** (duração aproximada: 1,6 s).
- [ ] Inicialização no Windows, conexão real com modelo, execução de comandos no projeto do usuário e consultas a servidores MCP externos ainda dependem de teste no computador de destino.

A aprovação acima corresponde ao commit `472fddc` e a todas as mudanças de código desta auditoria; o commit de documentação deste arquivo não altera o código testado. A validação do GitHub Actions cobre typecheck e testes automatizados, mas não substitui o teste visual no navegador nem a conexão com provedores e servidores MCP reais.

## Atualização de interface, modelos e OmniRoute — 18 de novembro de 2026

- [x] Barra lateral reorganizada em Chat, Arquivos, Agentes, Plugins, Modelos, Projetos e conversas recentes.
- [x] Telas de projetos e especialistas convertidas de grade de cartões para listas compactas.
- [x] Plugins reorganizados em Descobrir, Instalados, Marketplaces e Erros, com busca, lista e painel de detalhes.
- [x] Recursos MCP avançados mantidos em área expansível, incluindo importação JSON, servidores, tools, resources e prompts.
- [x] Campo de modelo no Chat com datalist, busca por prefixo e entrada manual.
- [x] Descoberta do Ollama usa `/v1/models` e, somente para endpoints Ollama em loopback, fallback para `/api/tags`.
- [x] Modelo selecionado é encaminhado às chamadas do Chat, workflows multiagente e execução da fila.
- [x] OmniRoute pode ser cadastrado como provedor OpenAI-compatible em `http://127.0.0.1:20128/v1`; a chave é mantida em memória no backend.
- [x] Documentados no README e na tela de provedores os passos de instalação/uso do OmniRoute.
- [ ] Integração de produto chamada “Rotaz AI” não foi incluída: a pesquisa não identificou com segurança qual projeto o nome representa. A tela/README não inventam compatibilidade com produtos diferentes.

### Regressões e CI

- GitHub Actions run [#44332964343](https://github.com/exraioX/ggm/actions/runs/44332964343), no commit de código `1abfcd1`: concluído com sucesso.
- `npm ci`: aprovado.
- `npm run typecheck`: aprovado.
- `npm test`: **44 testes aprovados, 0 falhas, 0 cancelados e 0 ignorados**.
- JavaScript da interface validado sintaticamente e HTML conferido para IDs duplicados e destinos de navegação ausentes.

### Ainda depende do computador de destino

- [ ] Teste visual/funcional no navegador do Windows (interações, responsividade e autocomplete real em Chromium).
- [ ] Conexão com uma instância real do Ollama e confirmação de modelos Qwen instalados.
- [ ] Conexão com o gateway OmniRoute, credencial real, provedor upstream e modelo roteado.
- [ ] Teste de conexão de servidores MCP externos e validação de recursos/prompts de servidores reais.

A aprovação do CI atesta instalação, typecheck e testes automatizados no runner Linux. Ela não substitui os testes de integração com os serviços locais do usuário.
