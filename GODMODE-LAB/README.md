# GODMODE LAB — implementação anterior

Esta pasta mantém a primeira implementação do laboratório e sua página Next.js para referência e compatibilidade histórica. A nova plataforma principal é **`../GODMODE-CORE/`**.

Para iniciar o núcleo independente, siga `GODMODE-CORE/README.md` e execute `GODMODE-CORE/start.ps1` no Windows. Não inicie simultaneamente `GODMODE-LAB/src/server.ts` e `GODMODE-CORE/src/server.ts` usando a mesma porta 8765.

O núcleo independente fornece rotas de compatibilidade `/api/lab/*` para a página `/lab` ainda presente no G0DM0D3. Portanto, a interface original pode continuar sendo executada em sua porta própria e usar o Gateway do Core em `http://127.0.0.1:8765`.

A configuração anterior de servidores fixos nesta pasta foi substituída, para a operação nova, pelo receptor genérico MCP em `GODMODE-CORE`, que importa a propriedade `mcpServers` do Claude Desktop e aceita `stdio`, Streamable HTTP e SSE legado.
