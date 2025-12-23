# PR Review Guidelines Reference

Comprehensive guidelines for conducting high-quality pull request reviews.

## Core Review Principles

### 1. Architectural Integrity First

**Check layer separation** - Ensure plumbing and intelligence aren't mixed:
- **Surface layer**: Routing, validation, security only
- **Business logic**: Services handle domain operations (stateless, focused)
- **Adapters**: External resource communication isolation

**Verify proper placement**:
- Is code in the right layer?
- Is it in the right problem domain folder?
- Are dependencies flowing in the correct direction?

**Look for DRY violations**:
- Especially in error handling
- Logging patterns
- External API call patterns
- Validation logic

### 2. Quality as Investment, Not Obstacle

**Pay tech debt while it's cheap** - If touching code with debt, improve it

**Every improvement counts** - Celebrate incremental progress

**Balance perfectionism** - Don't fall into "rewrite trap", improve what exists

**Think compound interest** - Both debt and quality improvements compound over time

### 3. Review for Three Purposes

1. **Catch bugs** - Does it work correctly?
2. **Share knowledge** - Learn patterns, spread good practices
3. **Converge standards** - Ensure consistency across codebase

## Practical Checklist

### Code Organization

- [ ] Business vocabulary > tech vocabulary in naming
- [ ] Services are stateless and focused on specific business operations
- [ ] Adapters isolate external dependencies
- [ ] No global variables or DOM as data source
- [ ] Request handlers are thin - just plumbing

### Error Handling & Observability

- [ ] Unexpected errors bubble up to catch-all handlers
- [ ] Expected business errors are handled gracefully
- [ ] Proper logging with loggingAdapter (not console.log)
- [ ] Observability baked in, not added as afterthought

### JavaScript/Node Specifics

- [ ] Named function declarations preferred
- [ ] async/await > Promises > callbacks
- [ ] Integration tests for new/modified services
- [ ] Error handling standardized (don't handle unexpected errors locally)

### Frontend Considerations

- [ ] Components are presentation-focused, services handle business logic
- [ ] Backend access isolated in adapter-like objects
- [ ] Standardized error handling (ErrorModal pattern)

## Architecture Deep Dive

### Three-Layer Architecture

```
┌─────────────────────────────────┐
│    SURFACE LAYER (Endpoints)    │  ← WHAT to do (routing, validation, security)
├─────────────────────────────────┤
│   BUSINESS LOGIC (Services)     │  ← WHAT outcome (domain operations, stateless)
├─────────────────────────────────┤
│    ADAPTERS (External APIs)     │  ← HOW to communicate (external resources)
└─────────────────────────────────┘
```

**Surface Layer (Endpoints/Routes)**
```javascript
// GOOD - Thin, just plumbing
async function handleCreateUser(req, res) {
  const validated = validateUserInput(req.body);
  const user = await userService.createUser(validated);
  res.json(user);
}

// BAD - Business logic in endpoint
async function handleCreateUser(req, res) {
  const user = req.body;
  // Calculating role, checking permissions, etc. - WRONG LAYER
  if (user.email.endsWith('@company.com')) {
    user.role = 'admin';
  }
  await db.users.insert(user);
  res.json(user);
}
```

**Business Logic (Services)**
```javascript
// GOOD - Stateless, focused domain operations
async function createUser(userData) {
  const role = determineUserRole(userData);
  const user = { ...userData, role };
  return await userAdapter.save(user);
}

// BAD - Direct external calls (should use adapter)
async function createUser(userData) {
  await fetch('https://api.external.com/users', {
    method: 'POST',
    body: JSON.stringify(userData)
  });
}
```

**Adapters**
```javascript
// GOOD - Knows HOW to talk to external resource
const userAdapter = {
  async save(user) {
    return await db.users.insert(user);
  },
  async findById(id) {
    return await db.users.findOne({ id });
  }
};

// BAD - Contains business logic (should be in service)
const userAdapter = {
  async save(user) {
    // Determining role is business logic - WRONG LAYER
    if (user.email.endsWith('@company.com')) {
      user.role = 'admin';
    }
    return await db.users.insert(user);
  }
};
```

## Error Handling Patterns

### Expected vs Unexpected Errors

**Expected errors** (business logic):
- User not found
- Validation failures
- Permission denied
- Handle gracefully, return to user

**Unexpected errors** (system failures):
- Database connection lost
- External API timeout
- Out of memory
- Let bubble up to catch-all middleware

### Pattern Examples

```javascript
// GOOD - Let unexpected errors bubble
async function getUser(id) {
  const user = await userAdapter.findById(id);
  if (!user) {
    throw new NotFoundError('User not found'); // Expected error
  }
  return user;
}

// BAD - Catching everything locally
async function getUser(id) {
  try {
    const user = await userAdapter.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  } catch (error) {
    // Wrong - handling both expected and unexpected errors
    console.error('Error getting user:', error);
    return null;
  }
}
```

## JavaScript Best Practices

### Function Style

```javascript
// GOOD - Named function declaration
async function calculateRevenue(orders) {
  return orders.reduce((sum, order) => sum + order.total, 0);
}

// AVOID - Anonymous functions for complex logic
const calculateRevenue = async (orders) => {
  return orders.reduce((sum, order) => sum + order.total, 0);
};
```

### Async Patterns

```javascript
// GOOD - async/await
async function processOrders() {
  const orders = await orderAdapter.getAll();
  const processed = await Promise.all(
    orders.map(order => processOrder(order))
  );
  return processed;
}

// AVOID - Promise chains
function processOrders() {
  return orderAdapter.getAll()
    .then(orders => Promise.all(orders.map(processOrder)))
    .then(processed => processed);
}
```

## Red Flags to Watch For

1. **Business logic in endpoints or adapters**
   - Calculation, validation, decision-making outside services
   
2. **Duplicate error handling/logging code**
   - Same try-catch pattern repeated
   - Multiple places calling logger the same way
   
3. **Direct database/external API calls outside adapters**
   - Services shouldn't know HOW to talk to external systems
   
4. **Complex try-catch blocks that should be middleware**
   - Error handling that wraps entire endpoints
   
5. **Code that increases cognitive load without clear benefit**
   - Clever code that's hard to understand
   - Premature abstractions
   
6. **Solutions looking for problems (YAGNI violations)**
   - Building for future scenarios that may never happen

## Review Process Tips

### Be Specific

**Good feedback**:
```
In auth.js:47-52, business logic (user role calculation) is in the 
endpoint handler. Move to authService.calculateUserRole():

// auth.js (endpoint)
const role = await authService.calculateUserRole(user);

// authService.js (service)
async function calculateUserRole(user) {
  return user.email.endsWith('@company.com') ? 'admin' : 'user';
}
```

**Bad feedback**:
```
Consider moving some logic to a service layer for better separation of concerns.
```

### Prioritize Issues

1. **Critical** - Bugs, security issues, data loss risks
2. **High** - Architecture violations, poor error handling
3. **Medium** - DRY violations, naming issues
4. **Low** - Style preferences, minor optimizations

### Think About Change

Ask: "Will this be easy to change when requirements evolve?"

**Good** - Easy to change:
```javascript
// New requirements? Just add a service function
async function createUser(userData) {
  const role = determineUserRole(userData);
  const permissions = determinePermissions(role);
  return { ...userData, role, permissions };
}
```

**Bad** - Hard to change:
```javascript
// New requirements? Have to modify endpoint, adapter, tests...
async function handleCreateUser(req, res) {
  const user = req.body;
  if (user.email.endsWith('@company.com')) user.role = 'admin';
  else user.role = 'user';
  await db.users.insert(user);
  res.json(user);
}
```

## Final Thought

Good architecture makes change **inexpensive and painless**. Every PR is an opportunity to move in that direction. Be an agent of order in the face of entropy, but remember: we're building a product customers love, not a perfect codebase. The code serves the business, and quality enables velocity.
