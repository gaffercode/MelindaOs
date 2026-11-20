<p align="center">
  <img src="./docs/assets/readme/hero.svg" width="100%" alt="MelindaOS: governed hospital knowledge, Director dashboard, human authority. A heartbeat trace becomes a digital signal; a six-level truth stack ranks live state first and external reference last." />
</p>

<p align="center">
  <b>Institutional intelligence for RSIA Melinda DHAI Kediri.</b><br />
  <sub>AI may structure the knowledge. Authority never moves to the AI.</sub>
</p>

<p align="center">
  <a href="#01--telemetry">01 Telemetry</a> ·
  <a href="#02--system-map">02 Map</a> ·
  <a href="#03--truth-engine">03 Truth</a> ·
  <a href="#04--knowledge-pipeline">04 Pipeline</a> ·
  <a href="#06--request-path">06 Request</a> ·
  <a href="#09--runtime">09 Runtime</a> ·
  <a href="#12--verify">12 Verify</a> ·
  <a href="#14--index">14 Index</a>
</p>

## 01 · Telemetry

<img src="./docs/assets/readme/telemetry.svg" width="100%" alt="Telemetry on 2026-11-13: 487 of 487 documents pass the checker; pytest 217 passed; Vitest 1,960 passed and 3 skipped; 33 migrations; 56 API routes and 22 pages; 13 MAAF tools, all deny-all." />

> [!WARNING]
> **Green documents do not mean a green runtime.** The checker measures format and governance, not clinical accuracy or freshness. This README does not claim production readiness.

## 02 · System map

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart TB
  DIR(("DIRECTOR<br/>+ staff accounts"))
  subgraph EDGE["VERCEL · NEXT.JS 16"]
    PROXY["proxy.ts<br/>session gate"] --> APP["22 pages · 56 API routes"]
    APP --> LIB["dashboard/lib<br/>all logic"]
  end
  subgraph CORE["KNOWLEDGE CORE · git"]
    KB["knowledge/00–12<br/>governed library"] --> CHK{{"validate_frontmatter.py"}}
    CHK -->|APPROVED only| IDX["build-time index"]
  end
  subgraph STORE["SUPABASE"]
    PG[("Postgres<br/>33 migrations")]
    OBJ[("Storage")]
  end
  subgraph BIZNET["BIZNET GIO · 06:00 / 18:00"]
    PULL["medify-pull.mjs"]
  end
  MED["MEDIFY SIMRS"] --> PULL
  PULL -->|bearer + idempotency key| APP
  DIR --> PROXY
  IDX --> LIB
  LIB <-->|named functions only| PG
  LIB <--> OBJ
  LIB -->|PHI-guarded| CL["CLAUDE API"]
  LIB -->|read-only| GD["GOOGLE DRIVE<br/>STARKES evidence"]
  AG(("AI AGENT<br/>one shared identity"))
  AG -->|HTTP + bearer| MCPD["/api/mcp<br/>dashboard MCP"]
  AG -->|stdio| MCPA["agent MCP<br/>runtime"]
  MCPD --> LIB
  MCPA --> KB
  MCPA -->|maaf_call| MAAF["MAAF gateway"]
  MAAF -.->|open circuit| X["no backend"]

  classDef human fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  classDef core fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef gate fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef ext fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef off fill:#0D1117,stroke:#484F58,stroke-width:1px,stroke-dasharray:3 3,color:#8C959F;
  class DIR,AG human;
  class PROXY,APP,LIB,KB,IDX,MCPD,MCPA core;
  class CHK gate;
  class PG,OBJ,PULL,MED,CL,GD ext;
  class MAAF,X off;
```

## 03 · Truth engine

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart TB
  Q(["QUESTION / EVENT"]) --> T{"what kind<br/>of truth?"}
  T -->|FACT| F["01_HOSPITAL · 03_INSURANCE<br/>04_BPJS · 07_LEGAL"]
  T -->|RULE| R["06_CLINICAL_SAFETY<br/>08_AGENT_POLICY"]
  T -->|ACTION| A["10_TOOL_CONTRACTS"]
  T -->|DYNAMIC| D["live system only"]
  T -->|HISTORY| H["99_ARCHIVE<br/>context only"]
  F & R & A & D & H --> P
  subgraph P["SOURCE PRECEDENCE"]
    direction LR
    P1["01 LIVE SYSTEM"] --> P2["02 CURRENT REGULATION"] --> P3["03 CANONICAL KB"] --> P4["04 PLAYBOOK"] --> P5["05 ARCHIVE"]
  end
  P --> C{"conflict<br/>resolved by<br/>freshness?"}
  C -->|yes| OUT["ANSWER + EVIDENCE<br/>+ UNCERTAINTY"]
  C -->|no| ESC["ESCALATE<br/>to a human"]

  classDef hot fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  classDef safe fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef cold fill:#0D1117,stroke:#484F58,stroke-width:1px,stroke-dasharray:3 3,color:#8C959F;
  classDef red fill:#161B22,stroke:#D0694F,stroke-width:1.5px,stroke-dasharray:4 3,color:#E89A84;
  class P1,D hot;
  class OUT safe;
  class P5,P6,H cold;
  class ESC red;
```

## 04 · Knowledge pipeline

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart LR
  RAW[("sources/raw<br/>local scans")] --> IN["intake_pdf.py<br/>text layer · OCR"]
  IN -->|OCR page = anomaly| REV["HUMAN READ<br/>--recheck"]
  REV --> TR
  IN -->|clean| TR["transform_documents.py<br/>frontmatter · naming"]
  TR --> RD["readiness<br/>registry fills"]
  RD -->|Director-only gap| QQ[["Director queue"]]
  RD --> CK{{"CHECKER<br/>A · B · C"}}
  CK -->|fail| REV
  CK -->|pass| OK["APPROVED<br/>governance block"]
  OK --> IX["knowledge index"] --> UI["dashboard<br/>shows APPROVED only"]
  RD -.->|every fill| PV[("provenance.jsonl")]

  classDef gate fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef human fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  classDef core fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  class CK,OK gate;
  class REV,QQ human;
  class IN,TR,RD,IX,UI core;
```

## 05 · Director loop

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
sequenceDiagram
  autonumber
  participant Q as readiness --queue
  participant D as Dashboard · Isian dokumen
  actor G as Director
  participant A as readiness --answers
  participant K as Knowledge library
  Q->>D: queue.json (id = path + line + occurrence)
  Note over Q,D: locked: headings · numbers · dates · signatures · clinical
  D->>G: open placeholders
  G-->>D: values · confirmations · notes
  D-->>A: answers.json (download)
  A->>A: report only (stale · already_applied · side_effect refused)
  A->>K: --apply → [ISI] replaced, [CEK] cleared
  A->>K: provenance method = director
  Note over K: draft status never changes on apply
```

## 06 · Request path

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
sequenceDiagram
  actor U as Director / account
  participant P as proxy.ts
  participant R as route.ts (thin)
  participant L as dashboard/lib
  participant S as Supabase
  participant G as phi-guard
  participant C as Claude
  U->>P: request + session cookie (30 min)
  P-->>U: redirect if signed out or no page permission
  P->>R: allowed
  R->>R: re-check permission · CSRF on writes
  R->>L: one function call
  L->>S: named database function (HTTPS)
  S-->>L: rows
  opt AI feature
    L->>G: text
    G-->>L: refused if patient identifiers
    L->>C: prompt (bounded tools · daily token budget)
    C-->>L: answer (refusal / truncation = no answer)
  end
  L-->>U: response
```

## 07 · Medify feed

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
sequenceDiagram
  participant T as systemd timer 06:00 · 18:00
  participant P as medify-pull.mjs
  participant M as Medify SIMRS
  participant D as Dashboard API
  participant S as Supabase
  T->>P: run
  P->>M: one login (failure stops the run)
  P->>M: MEDIFY_PATHS only
  M-->>P: data
  P->>P: keep counts and totals only
  P->>D: medify_snapshot · bearer · Idempotency-Key
  D->>D: token hash → contract → patient-identifier scan
  D->>S: store
  P->>D: medify_run_status
```

## 08 · Access matrix

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart LR
  DIR["DIRECTOR"] --> DO["studio · instructions · Melinda chat<br/>users.manage · director.only"]
  DIR --> VP
  VD["VICE_DIRECTOR"] --> VP["executive · credentials · pharmacy decide<br/>casemix · hrd · pharmacy · starkes · crm · news"]
  SF["STAFF_FINANCE"] --> P1["casemix"]
  SH["STAFF_HR"] --> P2["hrd"]
  SO["STAFF_OPS"] --> P3["pharmacy view + upload · starkes"]
  SS["STAFF_SUPPORT"] --> P4["crm · news"]
  VP & P1 & P2 & P3 & P4 --> ALL["EVERYONE<br/>knowledge.ask · account.self"]
  NL["route not in matrix"] --> DO

  classDef top fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  classDef mid fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef staff fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef base fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef warn fill:#161B22,stroke:#D0694F,stroke-width:1.5px,stroke-dasharray:4 3,color:#E89A84;
  class DIR,DO top;
  class VD,VP mid;
  class SF,SH,SO,SS,P1,P2,P3,P4 staff;
  class ALL base;
  class NL warn;
```

<sub>Source: <code>dashboard/lib/access/access-control.ts</code>. Accounts use scrypt hashes, their own session and CSRF token, and a forced password change after creation or reset.</sub>

## 09 · Runtime

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart LR
  REQ(["tool call<br/>as ALL_ACCESS"]) --> G1["1 known actor"] --> G2["2 allow-list"] --> G3{{"3 grant in<br/>tool-contracts.yaml"}}
  G3 -->|"ALL_ACCESS only × 13"| G4["4 risk class<br/>L0–L5"] --> G5{{"5 policy"}}
  G5 -->|"all-access: allow all, L4/L5 included"| G6["6 dispatch"]
  G6 -.-> NB["backend: none<br/>configuration_required"]

  classDef ok fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef gate fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef off fill:#0D1117,stroke:#484F58,stroke-width:1px,stroke-dasharray:3 3,color:#8C959F;
  classDef red fill:#161B22,stroke:#D0694F,stroke-width:1.5px,stroke-dasharray:4 3,color:#E89A84;
  class G1,G2,G4,G6 ok;
  class G3,G5 gate;
  class NB off;
```

| MCP server | Code | Transport | Tools |
|---|---|---|---|
| Dashboard MCP | `dashboard/app/api/mcp/` | HTTP at `/api/mcp`, bearer token in protected mode | 17 on live dashboard data, 6 of them write |
| Agent MCP | `runtime/src/melinda_agent_mcp/` | stdio (Claude Code via `.mcp.json`) or Streamable HTTP | 9: knowledge, repo files, bridges to the dashboard MCP and MAAF |
| MAAF MCP | `runtime/src/melinda_maaf/mcp_server.py` | Streamable HTTP at `/mcp` | 13 hospital tools behind the gates above |

<sub>Every MCP caller runs as one shared identity, <code>ALL_ACCESS</code>, the only actor MAAF recognizes; the agent roster was removed on 2026-11-20. No backend is configured, so nothing reaches a hospital system. All-access mode skips the L4 and L5 human gates. The REST agent gateway and the bot webhook stay removed (2026-11-12). Setup: <a href="./docs/guides/mcp-install-prompt.md">MCP install prompts</a>.</sub>

## 10 · Authority

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart LR
  MAY["<b>AI MAY</b><br/>retrieve approved knowledge<br/>route intent to a domain<br/>check provenance and freshness<br/>show uncertainty · ask to escalate"]
  HUMAN(["<b>HUMAN AUTHORITY</b><br/>clinical · legal · licensing<br/>financial · canonical promotion"])
  NEVER["<b>AI MAY NOT</b><br/>invent hospital or regulatory facts<br/>treat archive as active truth<br/>treat static schedules as live<br/>diagnose or prescribe for patients"]
  MAY ==>|evidence + uncertainty| HUMAN
  NEVER -.-x|blocked| HUMAN

  classDef may fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef hum fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  classDef no fill:#161B22,stroke:#D0694F,stroke-width:1.5px,stroke-dasharray:4 3,color:#E89A84;
  class MAY may;
  class HUMAN hum;
  class NEVER no;
```

> [!CAUTION]
> **Clinical output is decision support, never clinical authority.** Emergency and high-risk signals follow the safety and escalation rules in `knowledge/06_CLINICAL_SAFETY` and stay under review by a qualified professional.

## 11 · Knowledge domains

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
mindmap
  root((knowledge))
    00 INDEX
      router · source priority · freshness
    FACT
      01 HOSPITAL
      02 PATIENT ACCESS
      03 INSURANCE
      04 BPJS
      05 REFERRAL
      07 LEGAL REGULATORY
    RULE
      06 CLINICAL SAFETY
      08 AGENT POLICY
    AGENTS
      09 AGENT ARCHITECTURE
      10 TOOL CONTRACTS
    MACHINE
      11 MACHINE READABLE
      12 GOVERNANCE
    99 ARCHIVE
      context only
```

```mermaid
%%{init: {"theme": "base", "themeVariables": {"pie1": "#57606A", "pie2": "#8C959F", "pie3": "#D0694F", "pieSectionTextColor": "#FFFFFF", "pieStrokeColor": "#0D1117", "pieOuterStrokeColor": "#30363D", "pieLegendTextColor": "#8C959F"}}}%%
pie showData
  "A · knowledge documents" : 454
  "B · agent rule files" : 20
  "C · JSON schemas" : 13
```

<sub>Checker scope on 2026-11-12: 487 documents, all passing.</sub>

## 12 · Verify

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
flowchart LR
  subgraph LOCAL["node tools/capsule.mjs &lt;stage&gt;"]
    direction LR
    I["install"] --> LI["lint"] --> TC["typecheck"] --> TE["test"] --> B["build"] --> DR["deploy-dry-run"]
  end
  subgraph CI[".github/workflows/quality.yml"]
    direction TB
    J1["python"] ~~~ J2["dashboard"] ~~~ J3["database"]
  end
  LOCAL ==> PR(["pull request"]) ==> CI ==> M(["main"])

  classDef stage fill:#161B22,stroke:#57606A,stroke-width:1px,color:#E6EDF3;
  classDef job fill:#161B22,stroke:#9DA7B3,stroke-width:2px,color:#E6EDF3;
  classDef end1 fill:#161B22,stroke:#D0694F,stroke-width:2px,color:#E6EDF3;
  class I,LI,TC,TE,B,DR stage;
  class J1,J2,J3 job;
  class PR,M end1;
```

```bash
node tools/capsule.mjs install                           # uv sync + npm ci · Python 3.12, Node 24
node tools/capsule.mjs test                              # pytest + vitest
uv run --locked python -X utf8 tools/governance/validate_frontmatter.py   # document checker
```

<sub>Setup, variables and the full stage list: <a href="./docs/engineering/DEVELOPMENT.md">DEVELOPMENT</a> · <a href="./docs/engineering/TESTING.md">TESTING</a> · <a href="./docs/engineering/VERIFICATION.md">VERIFICATION</a>. Never re-run the legacy extraction scripts; see <a href="./CONTRIBUTING.md">CONTRIBUTING</a>.</sub>

## 13 · Timeline

```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#161B22", "primaryTextColor": "#E6EDF3", "primaryBorderColor": "#57606A", "secondaryColor": "#1C2128", "tertiaryColor": "#1C2128", "lineColor": "#8C959F", "textColor": "#8C959F", "clusterBkg": "#0D1117", "clusterBorder": "#30363D", "edgeLabelBackground": "#161B22", "signalColor": "#8C959F", "signalTextColor": "#8C959F", "actorLineColor": "#57606A", "noteBkgColor": "#1C2128", "noteTextColor": "#E6EDF3", "noteBorderColor": "#57606A", "labelTextColor": "#8C959F", "loopTextColor": "#8C959F"}}}%%
timeline
  2026-11-02 : Director name official · dr. Ferdi Andriska
  2026-11-06 : Puskesmas Balowerti moves to its own repository
  2026-11-07 : KB target agents retagged to roster codes
  2026-11-11 : PDF intake with OCR anomaly gate
  2026-11-12 : Bot integration removed : Staff accounts and roles : Director answer queue
  2026-11-13 : SAFRS capsule healthcare/melindaos : Full SRDS documentation set : Published to gaffercode/MelindaOs
  2026-11-16 : Agent access by MCP returns : MAAF contracts open to the roster
  2026-11-20 : MCP callers share one identity : Agent roster removed
```

## 14 · Index

| Orient | Build and run | Operate | Govern |
|---|---|---|---|
| [AGENTS](./AGENTS.md) | [ARCHITECTURE](./docs/architecture/ARCHITECTURE.md) | [DEPLOYMENT](./docs/operations/DEPLOYMENT.md) | [SECURITY](./SECURITY.md) |
| [Master Index](./knowledge/00_INDEX/MASTER_INDEX.md) | [DEVELOPMENT](./docs/engineering/DEVELOPMENT.md) | [RUNBOOK](./docs/operations/RUNBOOK.md) | [BOUNDARIES](./docs/governance/BOUNDARIES.md) |
| [Knowledge Router](./knowledge/00_INDEX/KNOWLEDGE_ROUTER.md) | [TESTING](./docs/engineering/TESTING.md) | [TROUBLESHOOTING](./docs/operations/TROUBLESHOOTING.md) | [REGULATORY SAFETY](./docs/security/REGULATORY_SAFETY.md) |
| [Source Priority](./knowledge/00_INDEX/SOURCE_PRIORITY.md) | [DATA](./docs/data/DATA.md) | [OBSERVABILITY](./docs/operations/OBSERVABILITY.md) | [DECISIONS](./docs/architecture/DECISIONS.md) |
| [PRODUCT SCOPE](./docs/product/PRODUCT_SCOPE.md) | [INTEGRATIONS](./docs/integrations/INTEGRATIONS.md) | [Dashboard](./dashboard/README.md) | [CONTRIBUTING](./CONTRIBUTING.md) · [CHANGELOG](./CHANGELOG.md) |

> [!IMPORTANT]
> **Public source, private data.** This repository holds code only: no patient or staff data, no hospital documents, no secrets, no `.env` contents. Report security issues as [SECURITY.md](./SECURITY.md) says, never in a public issue. **Proprietary · RSIA Melinda DHAI.**

## Team

| | dr Ferdi Andriska (The Gaffer) | dr Novia Dwi Anggraini | Joseph Arianto |
|---|:---:|:---:|:---:|
| **Role** | `Architect` | `Co-Architect` | `Liaison Officer` |
| **Focus** | architecture · authority design · product direction | institutional translation · domain alignment | stakeholders · implementation · technology representation |

<p align="center">
  <a href="https://ferdiiskandar.com" title="Website"><img src="https://cdn.simpleicons.org/vercel/8B949E" width="20" height="20" alt="Website" /></a>&nbsp;
  <a href="https://medium.com/@drferdiiskandar" title="Medium"><img src="https://cdn.simpleicons.org/medium/8B949E" width="20" height="20" alt="Medium" /></a>&nbsp;
  <a href="https://orcid.org/my-orcid?orcid=0009-0003-3788-1307" title="ORCID"><img src="https://cdn.simpleicons.org/orcid/8B949E" width="20" height="20" alt="ORCID" /></a>&nbsp;
  <a href="https://x.com/drferdiiskandar" title="X"><img src="https://cdn.simpleicons.org/x/8B949E" width="20" height="20" alt="X" /></a>&nbsp;
  <a href="https://substack.com/@drferdiiskandar" title="Substack"><img src="https://cdn.simpleicons.org/substack/8B949E" width="20" height="20" alt="Substack" /></a>&nbsp;
  <a href="https://kaggle.com/drferdiiskandar" title="Kaggle"><img src="https://cdn.simpleicons.org/kaggle/8B949E" width="20" height="20" alt="Kaggle" /></a>&nbsp;
  <a href="https://reddit.com/user/SixCupaCoffee" title="Reddit"><img src="https://cdn.simpleicons.org/reddit/8B949E" width="20" height="20" alt="Reddit" /></a>&nbsp;
  <a href="https://linkedin.com/in/dr-ferdi-iskandar-1b620a3b5" title="LinkedIn"><img src="https://upload.wikimedia.org/wikipedia/commons/8/81/LinkedIn_icon.svg" width="20" height="20" alt="LinkedIn" /></a>&nbsp;
  <a href="https://huggingface.co/dr-Ferdi" title="Hugging Face"><img src="https://cdn.simpleicons.org/huggingface/8B949E" width="20" height="20" alt="Hugging Face" /></a>&nbsp;
  <a href="https://www.tiktok.com/@ferdiiskandar.md" title="TikTok"><img src="https://cdn.simpleicons.org/tiktok/8B949E" width="20" height="20" alt="TikTok" /></a>&nbsp;
  <a href="https://www.instagram.com/drferdiiskandar" title="Instagram"><img src="https://cdn.simpleicons.org/instagram/8B949E" width="20" height="20" alt="Instagram" /></a>&nbsp;
  <a href="https://www.threads.com/@drferdiiskandar" title="Threads"><img src="https://cdn.simpleicons.org/threads/8B949E" width="20" height="20" alt="Threads" /></a>
</p>

<p align="center">
  <a href="https://melinda.co.id"><img src="https://i.ibb.co.com/LXy4jPvH/Melinda-OS-Agentic-Intelligence-Logo-4-removebg-preview.png" width="120" alt="Official MelindaOS logo" /></a><br />
  <b>Dedicated to Aldebaran, Aimee, Audrey, and Del — &amp; the Indonesia Healthcare Ecosystem.</b><br />
  <sub>Sentra Artificial Intelligence · Indonesia · <code>// knowledge is static only until reality changes</code></sub>
</p>
