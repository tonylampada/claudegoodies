# Architecture guidelines manifesto

Use this document as input to a Wayfinder conversation that produces **project- and stack-specific architectural guidelines**. Its purpose is to minimize the chance that successive rounds of vibecoding turn a codebase into a mess.

The conversation must turn these principles into decisions about the actual application: where knowledge belongs, which boundaries matter, how parts communicate, and which constraints agents must follow as the software grows. This document supplies the architectural intent. The resulting project guidelines supply the concrete rules.

These principles grew out of Golem's architecture discussions. They apply to ordinary applications too. Using Golem, embedding an agent, adopting TypeScript, or building a reusable framework is optional.

## 1. Put knowledge in its proper home

Software represents knowledge. Before deciding where to put code, identify the knowledge it expresses and who owns it.

Apply this question at each scale: shared library versus application, module versus module, then files and functions. A module's business rules belong with that module. Application-specific knowledge belongs in the application; a reusable library must remain independent of its consumers' particular businesses.

Apply DRY to knowledge. Two implementations of the same business rule can drift even when their code looks different. Conversely, similar code can represent different rules that should evolve independently. Decide ownership before extracting a shared abstraction.

Generic knowledge can take the form of code, configuration, documentation, prompts, or skills. Give it an authoritative home in whichever form fits. Refer consumers to that home so fixes can reach them without maintaining scattered copies.

**Derive for the project:** a knowledge-ownership map, dependency directions, and examples of knowledge that belongs on each side of the important boundaries. Identify who owns each shared rule.

## 2. Design the seams with the user

Interfaces are architectural decisions: the contracts through which parts of a system communicate. Give their shape deliberate attention. Keep them small, meaningful, and documented as first-class artifacts.

Involve the user when defining or changing significant contracts. Explain what a part does, what information it needs, what it returns, and what promises its callers can rely on. Use domain language and concrete interactions so participation does not require reading implementation code.

A conceptual API document, domain model, or application “DNA” can support this conversation. Its value comes from helping the user shape those contracts. Completing a template alone does not achieve that.

**Derive for the project:** the important interfaces, their owners, their documentation, and the changes that require a design conversation. Distinguish contract changes from implementation work agents can perform within an agreed contract.

## 3. Separate plumbing from intelligence

Plumbing connects things: accepting requests, translating formats, invoking dependencies, and moving data. Intelligence decides what the application means and does: business rules, calculations, policies, and allowed transitions.

Keep business behavior understandable without tracing transport and database-client mechanics. Give expected business outcomes explicit representation; handle unexpected failures consistently at the appropriate execution boundary. A domain-specific permission rule remains business knowledge even when generic authentication happens at an entry point.

This distinction is independent of generic versus specific knowledge. An application has plumbing of its own; a reusable framework can contain decision logic.

For backend code, use this separation to decide responsibilities and dependencies. For frontend code, investigate the responsibilities that need separation in that project. The backend distinction does not establish a universal frontend layering scheme.

**Derive for the project:** where request handling, business decisions, integration code, and error translation live. Walk through one operation and show which part owns each decision. Choose the necessary boundaries before choosing a layer count or folder tree.

## 4. Keep implementations behind deliberate contracts

When the application needs alternative implementations of a capability, isolate their differences behind an interface callers can use without knowing the selected provider. Choose and wire the implementation in a defined place. Avoid distributing provider-selection branches throughout the application.

Favor composition at integration boundaries. For persistence, let an adapter save and retrieve ordinary domain values, rather than requiring those values to inherit storage behavior or know their database client. This keeps the domain's knowledge separate from storage mechanics.

Allow an explicit escape hatch when a real requirement needs provider-specific behavior. Keep that access at the integration boundary, and document the resulting dependency. An abstraction need not pretend all providers have identical capabilities.

**Derive for the project:** which dependencies warrant adapters, the minimum contracts callers need, where implementations are selected, and where native capabilities may be used. Existing framework mechanisms may already provide the required separation.

## 5. Constrain growth without prescribing everything

Architecture guidelines should restrict the ways a system can become disordered. For each restriction, name the failure it prevents and the freedom it removes. Keep restrictions whose benefit justifies that cost.

Choose recognizable defaults that agents can follow without inventing a new structure for each feature. Let the user and agent adapt those defaults when a project's needs justify it, recording the reason and the replacement rule.

Avoid making folder layouts, layer counts, package boundaries, or coding style universal requirements. Start with clear internal responsibilities; split packages when actual consumers or operational needs justify the split.

Build capabilities needed by the current application. Keep plausible future changes in mind when choosing boundaries, without implementing their machinery in advance. Use the first real workflows to discover what the design missed.

**Derive for the project:** a short set of constraints, their rationale, and an exception process. Evaluate them against concrete feature changes: what must an agent understand and edit, and why?

## 6. Encode mechanical rules in tools

Use deterministic scaffolding and commands for repeatable setup. Express architectural restrictions as dependency or lint checks where practical: for example, limiting database-driver imports to the persistence integration.

Use documentation for decisions that require judgment. Supply defaults through shared configuration when several projects should receive the same improvements. Keep agent entry instructions short, with clear pointers that say when to read deeper guidance.

Architecture checks can be adapted through an intentional project decision. Access-control enforcement has a different purpose and needs its own policy; disabling an architectural lint rule does not grant runtime permissions.

**Derive for the project:** the rule, the check that enforces it, and an actionable violation message. For rules that cannot be automated, give an example agents can use during implementation and review.

## 7. Choose technology for the actual operating context

Choose storage, dependencies, and deployment mechanisms from the application's users, workload, data, and operating environment. The word “production” does not settle those choices.

Files can be appropriate for a small application. A database can be necessary for another. Keeping data in Git can make sense in a suitable context. Discuss concurrency, access, recovery, and operational needs before deciding.

Reuse suitable libraries for generic work. Keep the application-specific rules recognizable as dependencies change. For shared packages, prefer compatible evolution while permitting deliberate breaking changes with migration documentation. Consumers should be able to choose when to upgrade and understand what must change.

**Derive for the project:** the reasons for the chosen technologies, known operating limits, and the conditions that would justify revisiting them. Document those conditions without building a speculative migration system.

## When the application includes agents

These are conditional design directions. An ordinary web application need not add an agent to satisfy this manifesto.

- **Shared operations:** put reusable application actions behind documented operation contracts. Let UI and agent callers use the same behavior and authorization rules, including record-level checks. Keep that behavior outside presentation components.
- **View control:** distinguish changing application state from steering one user's view. Expose meaningful view actions through a small discoverable interface; expand it as interactions require. Decide how the agent obtains permission to steer that user's view.
- **Execution ownership:** for work that must outlive a browser connection, keep execution and authoritative state on the backend. Reconnection should recover the view of that work. When failure leaves execution uncertain, preserve available state, show the interruption, and obtain a continuation decision instead of silently replaying actions.
- **Permission context:** define how an agent acts on behalf of a user and how the system enforces that user's applicable limits. If construction capabilities exist, distinguish permission to build from explicit activation, and make the active mode visible.

For each adopted direction, Wayfinder must settle the concrete contract and verify the behavior through the relevant user path. A list of capabilities is not an implementation plan.

## Use with Wayfinder

Start the conversation with this request:

> Use this manifesto to help me derive architectural guidelines for this project and stack. First understand the application, its existing code if any, its users, and its operating constraints. Ask questions that resolve consequential design choices. Keep my participation focused on knowledge ownership and the contracts between parts. Distinguish agreed decisions from proposals and unresolved questions. Produce a compact guide future coding agents can apply, with concrete boundaries, examples, and checks. Preserve implementation freedom where a restriction has no demonstrated purpose.

The resulting guide should answer:

1. Which knowledge belongs where, and which dependencies may cross each boundary?
2. Which contracts matter, where are they documented, and when must changes involve the user?
3. How does a representative feature pass through the chosen architecture?
4. Which rules do tools enforce, and which require judgment? What does a violation look like?
5. Which defaults may be adapted, and how is the new decision recorded?
6. Which questions remain open, and which conditions would justify revisiting a decision?

Record decisions as the conversation reaches them. Keep speculative choices marked as proposals. Test the guide against a real feature and a plausible change before calling it usable: an agent should be able to identify where the change belongs without inventing the architecture again.

Maintain one authoritative project guide, with short entry-point pointers and linked detail where needed. Update it when the architecture changes so future agents inherit the current decisions.
