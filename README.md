# GGM — GODMODE CORE + G0DM0D3

Este repositório agora contém um **núcleo independente GODMODE CORE** e preserva o projeto original **G0DM0D3** como interface opcional. O núcleo não precisa iniciar o G0DM0D3 para conversar com modelos, administrar servidores MCP ou manter memória.

## Componentes

- `GODMODE-CORE/` — plataforma independente: interface web própria em português, API REST, fachada OpenAI-compatible, provedores de IA, agente com ferramentas MCP, aprovação de operações e memória persistente local.
- `G0DM0D3/` — código original preservado. Pode ser executado separadamente, normalmente na porta 3000.
- `GODMODE-LAB/` — extensão/implementação anterior mantida como referência e compatibilidade histórica. Para novas inicializações, use `GODMODE-CORE/`.
- `.gitmodules` — mantém a referência do submódulo original G0DM0D3.

## Início rápido (Windows)

Requisito: Node.js 22.16.0 ou superior e npm.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GODMODE-CORE\install.ps1
.\GODMODE-CORE\start.ps1
```

Abra `http://127.0.0.1:8765`.

Para iniciar também o G0DM0D3 original, abra outro PowerShell:

```powershell
cd .\G0DM0D3
npm install
npm run dev
```

Abra `http://localhost:3000`. O Core oferece rotas de compatibilidade para a página `/lab` antiga, mas a interface principal e independente é servida em `http://127.0.0.1:8765`.

## Receptor MCP

Na interface GODMODE CORE, abra **Integrações MCP** e importe o JSON com `mcpServers` que você usa no Claude Desktop. O núcleo aceita:

- `stdio` — executa um comando local explicitamente quando você clicar em Conectar;
- Streamable HTTP — transporte recomendado para MCP sobre HTTP;
- SSE — compatibilidade com servidores HTTP/SSE legados.

A importação mescla os nomes novos/atualizados sem apagar servidores que não estavam no JSON. Conexões não são iniciadas automaticamente. Consulte `GODMODE-CORE/README.md` e `GODMODE-CORE/config/mcp-servers.claude-example.json`.

## Provedores e memórias

Cadastre Ollama, LM Studio, llama.cpp ou OpenRouter em **Provedores de IA**. Chaves inseridas na interface permanecem na memória do processo do Core; o Core não as grava nos arquivos de provedores. Reiniciar o processo elimina chaves inseridas manualmente; variáveis de ambiente podem ser usadas para carregamento automático.

As memórias próprias do Core ficam em `%USERPROFILE%\.godmode\memory.json`; são notas persistentes em JSON, não uma base vetorial. Goldie pode ser conectado como um servidor MCP compatível. Headroom pode ser conectado como ferramenta MCP, mas a compressão automática em todo o pipeline de chat ainda não está pronta.

## Preservação

O G0DM0D3 original não foi substituído nem removido. O GODMODE CORE é um componente novo, independente, que expõe API para clientes locais e mantém o G0DM0D3 como interface opcional. Nenhuma integração externa foi declarada funcional sem conexão/teste no computador de destino.
