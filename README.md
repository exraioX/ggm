# GGM — GODMODE CORE

Este repositório é centrado no **GODMODE CORE**, o núcleo independente: ele conversa com modelos, administra servidores MCP e mantém memória sozinho, sem depender de nenhuma outra interface para funcionar. `G0DM0D3/` e `GODMODE-LAB/` seguem presentes no histórico do repositório apenas como referência; para qualquer nova inicialização, use `GODMODE-CORE/`.

## Componentes

- `GODMODE-CORE/` — plataforma independente: interface web própria em português (com anexo de imagens por arrastar-e-soltar, colar ou seleção de arquivo), API REST, fachada OpenAI-compatible, provedores de IA, agente com ferramentas MCP, aprovação de operações e memória persistente local.
- `G0DM0D3/` e `GODMODE-LAB/` — mantidos no repositório como referência histórica; não são usados pelo Core.

## Início rápido (Windows)

Requisito: Node.js 22.16.0 ou superior e npm.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GODMODE-CORE\install.ps1
.\GODMODE-CORE\start.ps1
```

Abra `http://127.0.0.1:8765` — essa é a única interface necessária.

## Receptor MCP

Na interface GODMODE CORE, abra **Integrações MCP** e importe o JSON com `mcpServers` que você usa no Claude Desktop. O núcleo aceita:

- `stdio` — executa um comando local explicitamente quando você clicar em Conectar;
- Streamable HTTP — transporte recomendado para MCP sobre HTTP;
- SSE — compatibilidade com servidores HTTP/SSE legados.

A importação mescla os nomes novos/atualizados sem apagar servidores que não estavam no JSON. Conexões não são iniciadas automaticamente. Consulte `GODMODE-CORE/README.md` e `GODMODE-CORE/config/mcp-servers.claude-example.json`.

## Provedores e memórias

Cadastre Ollama, LM Studio, llama.cpp ou OpenRouter em **Provedores de IA**. Chaves inseridas na interface permanecem na memória do processo do Core; o Core não as grava nos arquivos de provedores. Reiniciar o processo elimina chaves inseridas manualmente; variáveis de ambiente podem ser usadas para carregamento automático.

As memórias próprias do Core ficam em `%USERPROFILE%\.godmode\memory.json`; são notas persistentes em JSON, não uma base vetorial. Goldie pode ser conectado como um servidor MCP compatível. Headroom pode ser conectado como ferramenta MCP, mas a compressão automática em todo o pipeline de chat ainda não está pronta.

## Observação

Nenhuma integração externa é declarada funcional sem conexão/teste no computador de destino.
