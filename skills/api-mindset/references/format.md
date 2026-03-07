# Conceptual API Document Format

A Conceptual API doc uses **progressive disclosure**: two levels of detail in separate files.

## File Structure

```
docs/api/
├── overview.md     # Level 1: entities, operations, invariants — the whole system at a glance
└── entities.md     # Level 2: entity and value object details — zoom in when needed
```

When the system grows into distinct modules:

```
docs/api/
├── overview.md              # System-wide index linking to modules
├── accounts/
│   ├── overview.md
│   └── entities.md
└── payments/
    ├── overview.md
    └── entities.md
```

## Level 1 Template — overview.md

```markdown
# [System Name] — Conceptual API

> One-line description of what this system does.

## Entities

| Entity      | Description                              |
|-------------|------------------------------------------|
| EntityName  | What this entity represents              |

## Value Objects

| Name            | Used by              | Description                          |
|-----------------|----------------------|--------------------------------------|
| ObjectName      | operation.that.uses  | What this object encapsulates        |

## Operations

| Operation              | Input                          | Output      | Description                  |
|------------------------|--------------------------------|-------------|------------------------------|
| domain.operationName   | param: type, param: type       | ReturnType  | What this does               |

## Invariants

- Business rule that must always hold true
- Another invariant

## Side Effects

| Trigger              | Effect                                    |
|----------------------|-------------------------------------------|
| domain.operationName | What else happens beyond the return value |
```

**Conventions:**
- Entities are persistent (they have an implicit ID — never list ID as an attribute)
- Value Objects are non-persistent structures used as operation inputs/outputs
- Operations are grouped by entity prefix: `users.create`, `accounts.deposit`
- Types are natural: `string`, `decimal`, `enum`, `datetime` — not language-specific
- Optional params use `?`: `filter?: TransactionFilter`

## Level 2 Template — entities.md

```markdown
# [System Name] — Entity Details

## EntityName

Brief description.

| Attribute | Type   | Description                |
|-----------|--------|----------------------------|
| attr      | type   | What it represents         |

**Relationships:** belongs to X, has many Y
```

**Conventions:**
- No ID attribute (implicit for all entities)
- No infrastructure attributes (created_at, updated_at, cache columns)
- Only conceptual attributes — things that matter to the business
- Value Objects are also detailed here with their attributes

## Example: Banking System

### Level 1 — overview.md

```markdown
# SimpleBank — Conceptual API

> Personal banking system with accounts, transfers, and transaction history.

## Entities

| Entity      | Description                              |
|-------------|------------------------------------------|
| User        | A person who holds one or more accounts  |
| Account     | A financial account belonging to a user  |
| Transaction | A record of money movement               |

## Value Objects

| Name              | Used by          | Description                              |
|-------------------|------------------|------------------------------------------|
| TransactionFilter | accounts.history | Criteria for filtering transaction lists |

## Operations

| Operation          | Input                                      | Output        | Description                        |
|--------------------|--------------------------------------------|---------------|------------------------------------|
| users.create       | name: string, email: string                | User          | Register a new user                |
| users.suspend      | userId: ID                                 | User          | Suspend user, block all operations |
| accounts.create    | userId: ID, label: string, currency: enum  | Account       | Open a new account                 |
| accounts.deposit   | accountId: ID, amount: decimal             | Transaction   | Add funds to an account            |
| accounts.withdraw  | accountId: ID, amount: decimal             | Transaction   | Remove funds from an account       |
| accounts.transfer  | fromId: ID, toId: ID, amount: decimal      | Transaction   | Move funds between accounts        |
| accounts.history   | accountId: ID, filter?: TransactionFilter  | Transaction[] | List transactions for an account   |

## Invariants

- Account balance is always >= 0
- Every transaction is immutable once created
- Suspended users cannot perform any write operation

## Side Effects

| Trigger             | Effect                                       |
|---------------------|----------------------------------------------|
| accounts.transfer   | Notify both users                            |
| accounts.withdraw   | Notify user if balance drops below threshold |
| users.suspend       | Notify user, cancel pending operations       |
```

### Level 2 — entities.md

```markdown
# SimpleBank — Entity Details

## User

A person who holds one or more accounts.

| Attribute | Type   | Description              |
|-----------|--------|--------------------------|
| name      | string | Full name                |
| email     | string | Contact email (unique)   |
| status    | enum   | active, suspended        |

**Relationships:** has many Account

## Account

A financial account belonging to a user.

| Attribute | Type    | Description            |
|-----------|---------|------------------------|
| owner     | User    | The user who owns this |
| label     | string  | User-defined name      |
| balance   | decimal | Current balance        |
| currency  | enum    | BRL, USD, EUR          |

**Relationships:** belongs to User, has many Transaction

## Transaction

A record of money movement.

| Attribute | Type     | Description                        |
|-----------|----------|------------------------------------|
| type      | enum     | deposit, withdrawal, transfer      |
| amount    | decimal  | Positive value                     |
| from      | Account? | Source (null for deposits)         |
| to        | Account? | Destination (null for withdrawals) |
| timestamp | datetime | When it happened                   |

---

## Value Objects

### TransactionFilter

Criteria for filtering transaction lists.

| Attribute | Type      | Description                |
|-----------|-----------|----------------------------|
| type      | enum?     | Filter by transaction type |
| dateFrom  | datetime? | Start of date range        |
| dateTo    | datetime? | End of date range          |
```
