# Planning Guide

How to break down objectives into baby-step PRs.

## The Art of Decomposition

### Think in Layers

Break work into these layers (in order):

1. **Foundation** - Shared utilities, types, interfaces
2. **Core Logic** - Business logic, services, models
3. **Integration** - Wiring things together, API endpoints
4. **Polish** - Error handling, logging, edge cases
5. **Cleanup** - Remove old code, update docs

Each layer typically depends on the previous one.

### Identify Natural Boundaries

Look for:
- **File boundaries** - Each file is often a natural PR
- **Function boundaries** - Major functions can be separate PRs
- **Feature flags** - New code can be added disabled, then enabled in final PR
- **Test boundaries** - Tests can be added alongside or after implementation

### Questions to Ask

1. What's the smallest useful change?
2. Can this be split by file/module?
3. What can be done in parallel?
4. What's the critical path?

## Sizing Guidelines

### Ideal PR Size

| Metric | Target | Max |
|--------|--------|-----|
| Files changed | 1-3 | 7 |
| Lines added | 50-150 | 400 |
| Review time | 5-10 min | 20 min |

### Signs a Step is Too Big

- Touches more than 3 directories
- Changes more than 5 files
- Requires reading unrelated code to understand
- Has more than 3 distinct "things" happening

### Signs a Step is Too Small

- Just moves code without any logic change
- Only adds comments or formatting
- Could be combined with the next step without increasing complexity

## Dependency Patterns

### Linear Chain
```
1 → 2 → 3 → 4
```
Use when: Each step builds directly on the previous.
Example: Adding a new API endpoint with validation, storage, response.

### Fan-Out
```
    ┌→ 2
1 → ├→ 3
    └→ 4
```
Use when: Step 1 enables multiple independent features.
Example: Creating a base class, then implementing variants.

### Fan-In
```
1 →┐
2 →├→ 4
3 →┘
```
Use when: Multiple pieces must exist before integration.
Example: Building components, then assembling them.

### Diamond
```
    ┌→ 2 →┐
1 → │     ├→ 4
    └→ 3 →┘
```
Use when: Parallel work converges at integration point.
Example: Frontend and backend features that must work together.

## Common Decomposition Patterns

### Extract-and-Replace
1. Extract code to new location (copy)
2. Add tests for new location
3. Update callers to use new location
4. Remove old code

### Feature Flag Pattern
1. Add feature flag infrastructure
2. Add new implementation (behind flag)
3. Add tests for new implementation
4. Enable flag / remove flag + old code

### Strangler Pattern
1. Create new interface alongside old
2. Migrate consumers one by one
3. Remove old interface

### Test-First Pattern
1. Add tests that fail (skip/pending)
2. Implement feature to pass tests
3. Enable tests

## Red Flags

### Avoid These Patterns

❌ **Big Bang** - "Rewrite everything in one PR"
❌ **Partial State** - PR leaves code in broken state
❌ **Hidden Dependencies** - Step N actually needs step M but not declared
❌ **Over-Parallelism** - Too many steps with same dependencies (merge conflicts)

### Watch For

⚠️ Database migrations - Often can't be parallelized
⚠️ Config changes - May affect multiple steps
⚠️ Breaking changes - Require coordination with consumers
⚠️ Shared state - Files that multiple steps need to modify

## Example Decomposition

### Objective: "Add user avatar support"

**Analysis:**
- Need database field
- Need file upload handling
- Need UI component
- Need API endpoint

**Plan:**
```
1. Add avatar_url field to User model (migration)
2. Add file upload utility (Foundation)
3. Add avatar storage service (Core Logic)
4. Add avatar upload API endpoint (Integration) [depends: 1, 3]
5. Add avatar display component (Integration) [depends: 1]
6. Add avatar upload UI (Integration) [depends: 4, 5]
7. Add avatar tests (Polish) [depends: 4, 5, 6]
```

**Parallelism:**
- Steps 2-3 can run after 1
- Steps 4-5 can run in parallel after 3
- Step 6 needs both 4 and 5
- Step 7 needs all UI/API done
