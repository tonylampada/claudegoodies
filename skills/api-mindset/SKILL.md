---
name: api-mindset
description: >
  Development mindset driven by the system's Conceptual API — its DNA.
  Activate only when: (1) the user explicitly asks, or (2) the project's CLAUDE.md instructs it.
---

# API Mindset

Every software system has a Conceptual API — the DNA of the system. A simple, human-readable
document that captures the essential entities, operations, and side effects that define what the
software *is*. Like biological DNA, it's compact but contains the full blueprint; it replicates
across every layer of implementation; and any mutation is deliberate and propagated everywhere.

This skill makes that DNA explicit and uses it as the north star for all development. Once active,
it shapes how you think about every feature, every refactor, every new component — always aligned
to the system's core capabilities.

## Core Principle

Before implementing anything, ask: **"Where is the Conceptual API doc for this project?"**

- If it exists: read it, align your work to it.
- If it doesn't exist: help the user create it from the existing codebase.

**The coupling rule:** every functional component — a UI screen, a backend service, a CLI
command — must couple to an implementation surface that mirrors the DNA's operations. Never
build functionality that talks directly to the database, assembles business logic inline, or
invents its own path. If the surface you need doesn't exist yet, create it as an instantiation
of the DNA first, then couple to it. This is not passive documentation — it's the contract that
every implementation layer must honor.

The Conceptual API is NOT an OpenAPI/Swagger spec. It's a simple, concise document in Markdown
that a product manager can read and understand in under 2 minutes.

## Location and Structure

The Conceptual API lives at `docs/api/` in the project root, using progressive disclosure:

- **`docs/api/overview.md`** — Level 1: all entities, operations, and invariants at a glance
- **`docs/api/entities.md`** — Level 2: detailed attributes and relationships per entity

See [references/format.md](references/format.md) for templates and a complete example.

### Modularization

When the system grows, split into modules:

```
docs/api/
├── overview.md           # index linking to modules
├── accounts/
│   ├── overview.md
│   └── entities.md
└── payments/
    ├── overview.md
    └── entities.md
```

Proactively suggest splitting when operations and entities naturally cluster into distinct groups
with few cross-references. Use judgment — every system is different.

## What the Doc Contains

1. **Entities** — persistent domain objects (implicit ID, no infra attributes)
2. **Value Objects** — non-persistent structures used as operation inputs/outputs
3. **Operations** — system capabilities as `domain.verb` with typed signatures
4. **Invariants** — business rules that must always hold
5. **Side Effects** — what else happens when an operation executes (notifications, events, audit)

## What the Doc Does NOT Contain

- Implementation details (schemas, routes, class hierarchies)
- Infrastructure concerns (deployment, caching, scaling)
- UI/UX specifics
- ID fields or infra attributes (created_at, cache columns)

## How It Shapes Development

Every implementation surface is an **instantiation** of the Conceptual API:

| Layer | Instantiation |
|-------|--------------|
| Backend services | Service methods that mirror operations |
| REST/GraphQL | Routes that map 1:1 to operations |
| Frontend services | JS/TS modules exposing operations to UI code |
| CLI commands | Commands matching operations |
| Event handlers | Events corresponding to operation side-effects |

The codebase becomes predictable: knowing the Conceptual API lets you guess where code lives
and what it looks like at every layer. Name things consistently — if the doc says `transfer`,
the code says `transfer` everywhere.

## Workflow

### Discovery

When entering a project, search for `docs/api/overview.md`. If not found, propose creating it.

### Creation

Analyze the codebase to extract:
- Domain objects (models, types, schemas) → Entities and Value Objects
- Capabilities (service methods, endpoints, commands) → Operations
- Business rules (validations, constraints) → Invariants
- Reactions (notifications, events, triggers) → Side Effects

Draft using the format in [references/format.md](references/format.md). Present to the user.
Iterate until it captures the system's essence.

### Alignment

When implementing a feature:
1. Check if the feature maps to existing operations or needs new ones
2. If new operations needed, update the Conceptual API doc first
3. Implement across layers following the same operation names and signatures

### Evolution

The Conceptual API is a living document:
1. Propose changes explicitly — never let it drift silently
2. Update the doc before or alongside implementation
3. Consider impact across all instantiation layers

## Anti-Patterns

- **Implementing without checking the doc** — always consult it first
- **Implementation details leaking in** — keep it conceptual
- **Divergent naming** — if the doc says `transfer`, don't call it `moveBalance`
- **Treating it as optional** — this IS the source of truth for what the system does
- **Over-specifying** — this is not OpenAPI; keep it readable by non-engineers
