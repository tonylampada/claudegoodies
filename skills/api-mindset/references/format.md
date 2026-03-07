# Conceptual API Document Format

## Template

```markdown
# [System Name] — Conceptual API

> One-line description of what this system does.

## Entities

### EntityName
Brief description of what this entity represents.

| Attribute    | Type           | Description              |
|-------------|----------------|--------------------------|
| id          | ID             | Unique identifier        |
| attribute1  | type           | What it represents       |
| attribute2  | type           | What it represents       |

**Relationships:**
- belongs to [OtherEntity]
- has many [AnotherEntity]

---

## Operations

### category.operationName

> Brief description of what this does.

**Signature:**
`(param1: Type, param2: Type) → ReturnType`

**Rules:**
- Business rule or constraint
- Another rule

---

## Invariants

- Rule that must always hold true
- Another invariant
```

## Example: Banking System

```markdown
# SimpleBank — Conceptual API

> Personal banking system with accounts, transfers, and transaction history.

## Entities

### User
A person who holds one or more accounts.

| Attribute | Type     | Description            |
|-----------|----------|------------------------|
| id        | ID       | Unique identifier      |
| name      | string   | Full name              |
| email     | string   | Contact email (unique) |
| status    | enum     | active, suspended      |

### Account
A financial account belonging to a user.

| Attribute | Type     | Description               |
|-----------|----------|---------------------------|
| id        | ID       | Unique identifier         |
| owner     | User     | The user who owns this    |
| label     | string   | User-defined name         |
| balance   | decimal  | Current balance           |
| currency  | enum     | BRL, USD, EUR             |

**Relationships:**
- belongs to User
- has many Transactions

### Transaction
A record of money movement.

| Attribute | Type     | Description                          |
|-----------|----------|--------------------------------------|
| id        | ID       | Unique identifier                    |
| type      | enum     | deposit, withdrawal, transfer        |
| amount    | decimal  | Positive value                       |
| from      | Account? | Source (null for deposits)            |
| to        | Account? | Destination (null for withdrawals)   |
| timestamp | datetime | When it happened                     |

## Operations

### users.create
> Register a new user.

`(name: string, email: string) → User`

**Rules:**
- Email must be unique

### users.suspend
> Suspend a user, blocking all account operations.

`(userId: ID) → User`

**Rules:**
- All accounts become read-only

### accounts.create
> Open a new account for a user.

`(userId: ID, label: string, currency: Currency) → Account`

**Rules:**
- User must be active
- Balance starts at 0

### accounts.deposit
> Add funds to an account.

`(accountId: ID, amount: decimal) → Transaction`

**Rules:**
- Amount must be positive
- Account must be active

### accounts.withdraw
> Remove funds from an account.

`(accountId: ID, amount: decimal) → Transaction`

**Rules:**
- Amount must be positive
- Balance must be sufficient (no overdraft)
- Account must be active

### accounts.transfer
> Move funds between two accounts.

`(fromAccountId: ID, toAccountId: ID, amount: decimal) → Transaction`

**Rules:**
- Both accounts must be active
- Same currency required (or specify conversion)
- Source must have sufficient balance

### accounts.history
> List transactions for an account.

`(accountId: ID, filters?: { type?, from?, to? }) → Transaction[]`

## Invariants

- Account balance is always >= 0
- Every transaction is immutable once created
- Sum of all deposits - withdrawals - transfers out + transfers in = current balance
- Suspended users cannot perform any write operation
```

## Guidelines

- **Keep it short** — if the doc exceeds 2 pages, the system might need decomposition
- **Use natural types** — `string`, `decimal`, `ID`, `enum`, `datetime` — not language-specific types
- **Group operations by entity** — `accounts.deposit`, `users.create`
- **Signatures are conceptual** — they show intent, not implementation
- **Invariants are gold** — they prevent bugs across every layer
