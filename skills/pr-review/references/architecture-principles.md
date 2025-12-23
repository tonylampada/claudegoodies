# Architecture Principles

Core architectural principles that inform PR reviews.

## The Three-Layer Mental Model

Software architecture should separate three concerns:

1. **WHAT to do** (Surface Layer)
2. **WHAT outcome** (Business Logic)
3. **HOW to do it** (Adapters)

### Surface Layer: WHAT to do

Handles the "plumbing" of requests:
- Routing (which handler to call)
- Validation (is the request well-formed?)
- Authentication (who is this?)
- Authorization (are they allowed?)
- Response formatting

**Key principle**: Surface layer should be thin and obvious. No business decisions.

### Business Logic: WHAT outcome

Implements domain operations and business rules:
- Calculate pricing
- Determine user permissions
- Apply business rules
- Coordinate between adapters
- Make decisions

**Key principle**: Services should be stateless and focused on specific business operations. They answer "what should happen" but don't care "how it happens."

### Adapters: HOW to do it

Knows how to communicate with external systems:
- Database queries
- External API calls
- File system operations
- Message queue operations

**Key principle**: Adapters isolate the HOW. They're the only layer that knows implementation details of external systems.

## Dependency Direction

Dependencies should flow downward:

```
Surface Layer (depends on ↓)
    ↓
Business Logic (depends on ↓)
    ↓
Adapters (depends on nothing internal)
```

Never reverse this:
- ❌ Adapters shouldn't depend on services
- ❌ Services shouldn't know about HTTP requests
- ❌ Business logic shouldn't be in endpoints

## DRY Principle in Practice

Don't Repeat Yourself, especially in:

### Error Handling

**Bad** - Repeated everywhere:
```javascript
try {
  const user = await db.users.find(id);
} catch (error) {
  logger.error('Database error', error);
  throw new Error('Failed to get user');
}
```

**Good** - Centralized:
```javascript
// In adapter
async findUser(id) {
  return await db.users.find(id); // Let errors bubble
}

// Catch-all error handler handles logging
```

### Logging

**Bad** - Repeated pattern:
```javascript
logger.info(`Creating user ${userData.email}`);
logger.info(`Updating user ${userData.email}`);
logger.info(`Deleting user ${userData.email}`);
```

**Good** - Standardized:
```javascript
logAdapter.userOperation('create', userData);
logAdapter.userOperation('update', userData);
logAdapter.userOperation('delete', userData);
```

### External API Calls

**Bad** - Repeated configuration:
```javascript
// In multiple services
await fetch('https://api.external.com/endpoint', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Good** - Centralized in adapter:
```javascript
// externalApiAdapter.js
async function call(endpoint, options) {
  return fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, ...options.headers }
  });
}
```

## Stateless Services

Services should not maintain state between calls:

**Bad** - Stateful:
```javascript
class UserService {
  constructor() {
    this.currentUser = null; // State!
  }
  
  setCurrentUser(user) {
    this.currentUser = user;
  }
  
  getCurrentUserRole() {
    return this.currentUser.role; // Depends on previous call
  }
}
```

**Good** - Stateless:
```javascript
async function getUserRole(userId) {
  const user = await userAdapter.findById(userId);
  return user.role;
}
```

## Business Vocabulary Over Tech Vocabulary

Code should speak the language of the business:

**Bad** - Tech vocabulary:
```javascript
function processData(input) {
  const result = transform(input);
  return normalize(result);
}
```

**Good** - Business vocabulary:
```javascript
function calculateMonthlyRevenue(orders) {
  const revenue = sumOrderTotals(orders);
  return applyDiscounts(revenue);
}
```

## Code Should Reveal Intention

Code should explain WHAT and WHY, not just HOW:

**Bad** - Reveals only implementation:
```javascript
function check(user) {
  return user.email.endsWith('@company.com') || user.created < Date.now() - 86400000;
}
```

**Good** - Reveals intention:
```javascript
function canAccessAdminPanel(user) {
  return isCompanyEmployee(user) || hasBeenMemberForOneDay(user);
}

function isCompanyEmployee(user) {
  return user.email.endsWith('@company.com');
}

function hasBeenMemberForOneDay(user) {
  const oneDayMs = 86400000;
  return user.created < Date.now() - oneDayMs;
}
```

## Optimize for Change

Design for the changes you'll need to make:

**Rigid** - Hard to change:
```javascript
async function createOrder(req, res) {
  const order = req.body;
  order.total = order.items.reduce((sum, item) => sum + item.price, 0);
  order.tax = order.total * 0.08;
  order.grandTotal = order.total + order.tax;
  await db.orders.insert(order);
  res.json(order);
}
```

**Flexible** - Easy to change:
```javascript
// Surface
async function handleCreateOrder(req, res) {
  const order = await orderService.createOrder(req.body);
  res.json(order);
}

// Business logic
async function createOrder(orderData) {
  const total = calculateTotal(orderData.items);
  const tax = calculateTax(total);
  const grandTotal = total + tax;
  return await orderAdapter.save({ ...orderData, total, tax, grandTotal });
}
```

Now changing tax rates, adding discounts, or modifying calculations only requires changing the service.

## Think About the Developer Experience

Code is a place we inhabit. Ask:
- Is this making our "home" cleaner or messier?
- Does it reduce or increase cognitive load?
- Will future developers thank us or curse us?

**High cognitive load**:
```javascript
const p = async (d) => {
  const r = await f(d);
  return r ? t(r) : null;
};
```

**Low cognitive load**:
```javascript
async function processPayment(paymentData) {
  const result = await fetchPaymentStatus(paymentData);
  return result ? transformToReceipt(result) : null;
}
```

## YAGNI: You Aren't Gonna Need It

Don't build for hypothetical future scenarios:

**Bad** - Building for unknown future:
```javascript
class UserManager {
  constructor(db, cache, queue, logger, metrics, tracer) {
    // Setting up for every possible need
  }
}
```

**Good** - Building for current needs:
```javascript
async function getUser(id) {
  return await userAdapter.findById(id);
}
```

Add complexity only when it's actually needed.
