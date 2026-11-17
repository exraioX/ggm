# Entrega — GODMODE independente do G0DM0D3

## Arquitetura resultante

`GODMODE-CORE/` é agora o ponto principal de execução. Ele reúne uma interface web própria, API REST, API de chat compatível com OpenAI, registro de provedores, receptor de servidores MCP, agente com gate de aprovação e memória persistente. Ele não importa componentes React nem executa a aplicação Next.js do G0DM0D3 para funcionar.

O G0DM0D3 foi mantido em sua pasta original e pode continuar sendo iniciado separadamente. A página antiga `/lab` ainda pode chamar o Core pelas rotas de compatibilidade `/api/lab/*`. `GODMODE-LAB/` continua no repositório para referência, mas não é o comando recomendado para iniciar o ambiente novo.

## Funcionalidades implementadas

1. Interface GODMODE CORE independente e em português.
2. Histórico de conversas por navegador, com seleção, criação e exclusão.
3. Proteção para que respostas e aprovações retornem à conversa que originou a solicitação, mesmo se o usuário trocar de chat durante a resposta.
4. Janela de contexto limitada a até 80 mensagens/90 mil caracteres para não ultrapassar o limite básico do endpoint.
5. Cadastro de provedores com endpoint e identificador de modelo, incluindo Ollama, llama.cpp, LM Studio e OpenRouter via API compatível com OpenAI.
6. Descoberta de modelos quando o servidor expõe `/models`.
7. Segredos de API inseridos na UI mantidos somente na memória do processo do Core.
8. Fachada `/v1/models` e `/v1/chat/completions`, com streaming SSE para clientes externos.
9. Importação de servidores MCP pelo formato `mcpServers` do Claude Desktop ou pelo alias `servers`.
10. Suporte a MCP stdio, Streamable HTTP e SSE legado; modo automático tenta HTTP moderno e depois SSE.
11. Placeholders de ambiente para tokens e autenticação por cabeçalho estático/variável de ambiente.
12. Descoberta de tools MCP para o agente e apresentação de resources/prompts MCP com leitura/obtenção sob demanda na interface.
13. Aprovação individual para ferramentas com efeitos colaterais, desconhecidas ou com caminhos fora do workspace.
14. Memórias persistentes simples em JSON no perfil do usuário.
15. Scripts PowerShell, documentação, configuração MCP de exemplo e testes de segurança/importação.

## Critérios de não conclusão declarados

Não foi possível instalar as dependências nem executar typecheck, build Next.js, testes de integração ou conectar serviços externos neste ambiente por indisponibilidade de rede/cache npm. Portanto, nenhum servidor MCP, modelo ou provedor externo está declarado como conectado/testado. Headroom pode entrar como servidor MCP, mas compressão automática do prompt ainda precisa ser ligada ao pipeline. Goldie não foi instalado; a memória interna atual é arquivo JSON, não vetor. OAuth interativo, sampling/elicitation/roots/subscrições/tasks e plugins/skills exclusivos que não implementem MCP exigem trabalho futuro.

## Como iniciar

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GODMODE-CORE\install.ps1
.\GODMODE-CORE\start.ps1
```

Abra `http://127.0.0.1:8765`. O G0DM0D3 original continua opcional em `http://localhost:3000`.
