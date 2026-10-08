# expense_server

Codename **denarii**. Turns phone payment notifications into categorized expenses, asking via Telegram when it can't decide. See [SPEC.md](SPEC.md).

## How it works

```mermaid
flowchart LR
  phone["Phone<br/>bank / wallet app"] -- notification --> macrodroid[MacroDroid]
  macrodroid -- HTTP POST --> denarii["denarii<br/>classify · dedupe · categorize"]
  denarii -- purchase, asks for category --> telegram[Telegram bot]
  telegram -- your answer --> denarii
  telegram <--> you((You))
  denarii --> db[(Expenses)]
```

## Architecture

![denarii architecture](docs/diagrams/architecture-light.png)
