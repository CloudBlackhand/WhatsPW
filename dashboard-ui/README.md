# WhatsPW — dashboard-ui

Painel estático (Vite + React + **TanStack Table**), integrado no repositório **WhatsPW** (`dashboard-ui/`).

O `vite build` gera ficheiros em **`../src/dashboard`** (consumido pelo Nest e pelo Docker).

## Desenvolvimento

```bash
npm install
# WAHA a correr localmente; ajusta a porta se precisares
npm run dev
```

Abre `http://localhost:5173/dashboard/` (sufixo `/dashboard/` alinhado com `base` do Vite).

Opcional: copia `.env.example` para `.env` e define `VITE_WAHA_API_KEY` se o WAHA exigir chave.

## Build

```bash
npm run build
```

Na raiz do WhatsPW também podes usar: `yarn dashboard:build`.
