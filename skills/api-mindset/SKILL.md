---
name: api-mindset
description: >
  Activate a development mindset where every software project is driven by its Conceptual API —
  a simple, human-readable document defining the system's core entities and operations.
  Use when: (1) starting work on any project that lacks a conceptual API doc, (2) the user says
  "api mindset" or "conceptual api", (3) implementing new features and wanting to ensure alignment
  with the system's core capabilities, (4) onboarding to an unfamiliar codebase and needing to
  understand what it fundamentally does. This skill shapes HOW you develop — not what you build.
---

# API Mindset

Every software system has a conceptual API — the essential entities and operations that define
what it does. This skill makes that API explicit and uses it as the north star for all development.

## Core Principle

Before implementing anything, ask: **"Where is the Conceptual API doc for this project?"**

- If it exists: read it, align your work to it.
- If it doesn't exist: help the user create it from the existing codebase.

The Conceptual API is NOT an OpenAPI/Swagger spec. It's a simple, concise document in Markdown
that a product manager can read and understand. It captures entities, their relationships, and
operations — like method signatures for the system's brain.

## The Conceptual API Document

Location: look for `CONCEPTUAL_API.md` (or similar) at the project root. If absent, propose creating one.

See [references/format.md](references/format.md) for the template and a concrete example.

### What It Contains

1. **Entities** — the core nouns of the system, their key attributes, and relationships
2. **Operations** — the core verbs, expressed as method-like signatures with inputs and outputs
3. **Invariants** — business rules that must always hold true

### What It Does NOT Contain

- Implementation details (database schemas, HTTP routes, class hierarchies)
- Infrastructure concerns (deployment, scaling, caching)
- UI/UX specifics

## How It Shapes Development

Once the Conceptual API exists, every implementation surface is an **instantiation** of it:

| Layer | Instantiation |
|-------|--------------|
| Backend services | Service classes whose methods mirror the operations |
| REST/GraphQL endpoints | Routes that map 1:1 to operations |
| Frontend services | JS/TS modules exposing the same operations to UI code |
| CLI commands | Commands matching operations |
| Event handlers | Events that correspond to operation side-effects |

The codebase becomes predictable: if you know the Conceptual API, you can guess where code lives
and what it looks like at every layer.

## Workflow

### 1. Discovery

When entering a project:

```
1. Search for CONCEPTUAL_API.md (or similar) at the root
2. If found → read it, proceed with alignment
3. If not found → scan the codebase to understand core entities and operations
```

### 2. Creation (when the doc doesn't exist)

Analyze the codebase to extract:
- What are the main domain objects? (models, types, schemas)
- What operations exist? (service methods, API endpoints, commands)
- What business rules are enforced? (validations, invariants)

Draft the doc using the format in [references/format.md](references/format.md) and present it
to the user for review. Iterate until it feels right.

### 3. Alignment (during development)

When implementing a feature:

1. Check if the feature maps to existing operations or requires new ones
2. If new operations are needed, propose updating the Conceptual API doc first
3. Implement across layers following the same operation signature
4. Name things consistently — the operation name in the doc should appear in service methods,
   endpoint names, event names, and frontend calls

### 4. Evolution

The Conceptual API is a living document. When it changes:

1. Propose the change explicitly — don't let it drift silently
2. Update the doc before (or alongside) the implementation
3. Consider impact across all instantiation layers

## Anti-Patterns

- **Implementing without checking the doc** — always consult it first
- **Letting implementation details leak into the doc** — keep it conceptual
- **Divergent naming** — if the doc says `transfer`, don't call it `moveBalance` in code
- **Treating it as optional** — this IS the source of truth for what the system does
