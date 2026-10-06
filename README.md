# expense_server

Codename **denarii**. Turns phone payment notifications into categorized expenses, asking via Telegram when it can't decide. See [SPEC.md](SPEC.md).

## Architecture

```mermaid
flowchart LR
  subgraph Phone
    N[Bank / wallet notification] --> MD[MacroDroid]
  end

  subgraph External
    TG[Telegram Bot API]
    LLM[LLM provider<br/>Anthropic / OpenAI / Workers AI]
    G[Google OAuth]
  end

  subgraph Runtime["denarii runtime (Cloudflare Worker | Node container)"]
    API[Hono API]
    subgraph Core["packages/core"]
      CL[Classifier<br/>regex rules]
      DD[Dedupe]
      CAT[Categorizer]
      FL[Telegram flows]
    end
    RP[(Rule packs<br/>YAML, bundled)]
    CRON[Scheduler<br/>daily digest]
    SPA[React SPA<br/>static assets]
  end

  DB[(SQLite<br/>D1 | better-sqlite3)]
  U((User))

  MD -- "POST /api/ingest" --> API
  API --> CL
  RP --> CL
  CL -- "purchase / transfer" --> DD --> CAT
  CL -- "unmatched" --> FL
  CAT -- "no merchant rule" --> FL
  CAT -. suggest / extract / propose rule .-> LLM
  FL <--> TG
  TG <--> U
  CRON --> FL
  Core <--> DB
  U -- browser --> SPA -- "tRPC" --> API
  API -- "Better Auth" --> G
```
