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
