# Architecture guidelines manifesto

This document guides the creation of **project- and stack-specific architectural guidelines**, through a conversation with Wayfinder. Its purpose is to minimize the chance that successive rounds of vibecoding turn a codebase into a mess.

It captures a way of thinking about architecture. Wayfinder should use that reasoning to question the project's design, surface choices, and help the user settle concrete rules. Those rules will differ between projects because their domains, technologies, constraints, and ambitions differ.

The problem is cumulative. A coding agent can make a feature work while putting its knowledge in the wrong place. The next agent follows the precedent. Over time, business rules spread through handlers and screens, integrations acquire special cases, and changing one concept requires finding all its accidental representations. Each change may look reasonable on its own. Together they make the software harder to understand and change.

We want to shape how the application can grow. That requires agreement about where knowledge belongs and how parts communicate, with enough reasoning behind the agreement that future agents can apply it to situations nobody anticipated.

## Code represents knowledge

An application contains knowledge about its business: what an order means, when it may be cancelled, how a price is calculated. It also contains knowledge about mechanisms: how to talk to a database, decode a request, render a table, or report an error. Writing code gives that knowledge an executable representation.

Architecture begins by asking where each kind of knowledge belongs. A team needs a map of those homes. Without one, “put this in the appropriate module” leaves the most consequential part of the instruction unresolved.

Consider a cancellation deadline. If the interface hides a button after that deadline, an endpoint checks it again, and a scheduled process implements its own version, several places now claim to know the same business rule. A change to the deadline becomes a search for copies. Even if the implementations share no identical lines, the knowledge is duplicated.

This is why DRY requires more thought than finding similar code. To avoid repeating knowledge, first identify its proper home. The interface can display a decision and the endpoint can enforce it while both rely on the same authoritative rule. Conversely, two calculations that happen to look alike may belong to different business concepts. Combining them can create a dependency between decisions that should evolve independently.

The ownership question repeats at different scales. Between a reusable library and an application, distinguish generic knowledge from application-specific knowledge. Within the application, identify which module owns a business concept. Within that module, make the same judgment about files and functions. A clean package diagram does little good if the functions inside it still know each other's business.

Shared infrastructure must remain independent of a particular consumer's domain. A library that needs exceptions for named customers or particular application workflows has absorbed knowledge that belongs elsewhere. At the other extreme, an application that repeatedly reimplements shared error handling or integration conventions has no reliable way to receive improvements to that generic knowledge.

Knowledge also lives in documentation, prompts, skills, and configuration. An agent may need both a library's implementation and guidance about using it. Those are legitimate parts of the architecture. Give shared guidance an authoritative home, and let projects reference it. Copying a large body of generic instructions into each project creates another set of implementations that can drift.

In the project conversation, draw this map using actual concepts. Naming folders “domain,” “services,” and “utils” is insufficient: explain what each is allowed to know, what it must obtain from another part, and who owns a rule when several callers need it.

## Design the seams intentionally, with the user

A system consists of parts that communicate. Their interfaces determine what each part can ask of another, what assumptions callers may make, and how much of an implementation can change without affecting its neighbors.

An interface deserves design attention in its own right. Treat it as a first-class part of the documentation, with a meaningful vocabulary, a small understandable shape, and explicit behavior. A reader should be able to learn the contract without reconstructing it from whichever caller happens to use it today.

The danger in agent-driven development is that an agent can invent both sides of an interface in a single pass. Nothing forces the human to notice the decision. The feature works, but the agent has also chosen how the system divides responsibility. Repeat that often enough and the architecture reflects a succession of local conveniences.

Bring the user into those decisions. Show the significant seams and explain what they mean. For example, an operation named “cancel order” raises useful questions: when is cancellation allowed, what happens to a payment, and what result should the caller expect if fulfillment has started? Those are questions the person who understands the business can answer. An operation that merely exposes an internal status field can conceal all of them.

Participation needs to fit the user's understanding. Discuss concepts, examples, inputs, outcomes, and promises. A non-programmer can help design the conceptual API without choosing serialization syntax or reading type definitions. A technical user may want to inspect the exact interface shape. Both should have visibility into decisions that change what the parts mean to one another.

A domain document or conceptual API description gives that conversation somewhere to live. Its purpose is to make the design visible and editable. Following a document template does not establish that the user understood or helped shape the boundaries.

This practice continues as the application grows. When a feature requires changing an important contract, surface the change and its implications. Implementation within an agreed contract can proceed with less discussion. The project guidelines should help future agents recognize that distinction, so the user participates where judgment matters without approving every helper function.

## Separate plumbing from intelligence

In backend code, distinguish the work of connecting things from the work of making decisions.

Plumbing receives a request, decodes its representation, obtains dependencies, moves data, and translates a result for the caller. Intelligence expresses the application's rules: whether a transition is allowed, how a value is calculated, what a workflow should do next.

Take the cancellation example. Parsing an order identifier from a request is plumbing. Deciding whether an order can still be cancelled is intelligence. Reading the order through a database client is plumbing. Deciding whether cancellation creates a refund is intelligence. Formatting the response returns to plumbing.

When all of that lives together, answering a business question requires navigating transport and storage details. Reusing the behavior from a different entry point becomes awkward: a command-line task or another operation either calls through an irrelevant transport or copies the rule. Testing the decision can require machinery that has little to do with the decision itself.

Give business behavior a home where its inputs, decisions, and outcomes remain recognizable. Let integrations handle their mechanisms through deliberate boundaries. Then changing a transport or storage detail need not become a rewrite of business behavior, and changing a business rule need not require understanding the database client's conventions.

Apply the distinction to failures too. “This order can no longer be cancelled” is an expected business outcome that deserves a defined meaning. A connection failure is a different kind of event, requiring consistent handling at the appropriate execution boundary. An authentication mechanism and a business rule about who may cancel a particular order also answer different questions, even though both concern access.

Generic versus specific knowledge is a separate distinction. An application has its own plumbing, and a reusable component can contain substantial decision logic. Use both questions: whose knowledge is this, and what responsibility does this code perform?

The project and stack determine how to express the separation. Existing framework facilities may already supply useful boundaries. Decide what must remain independent before prescribing a layer count, class hierarchy, or folder tree. For frontend architecture, investigate its responsibilities on their own terms; this backend model does not settle a universal frontend structure.

## Let contracts contain implementation differences

A well-chosen boundary gives callers a useful capability without making them carry the details of its implementation. If several implementations must serve the same capability, callers should not need provider-specific branches scattered through their code. Choose the implementation in a defined place and let it satisfy the agreed contract.

Persistence illustrates the ownership issue. A domain record can represent a value the application understands, while a persistence adapter knows how to save it. Putting a database-specific `save` method on the record ties those responsibilities together. Favor composition: give the record to the part that knows persistence. The domain value can then travel between parts of the application without dragging storage mechanics along with it.

The same reasoning applies to other integrations, but it does not justify wrapping every library or designing a universal provider system in advance. Identify the knowledge that callers should not need, and the changes the boundary should contain. Sometimes an existing library interface already does the job.

Useful abstractions also need to acknowledge their limits. A storage engine may have a native query facility the application has a good reason to use. An explicit escape hatch at the persistence boundary can support that need while keeping the dependency visible. Scattering native calls across the application would lose that ownership; forcing an elaborate universal query language on the project could cost more than it solves.

Keep contracts meaningful and small enough to understand. Preserve useful capabilities without pretending that every implementation is interchangeable in every respect. The project conversation should settle which guarantees are shared and where a deliberate dependency on a particular implementation is acceptable.

## Engineer constraints that leave room to discover

These guidelines are a form of constraint engineering. We choose restrictions on where knowledge can live and how dependencies can form because unrestricted local choices tend to produce disorder over time.

Restrictions have a cost. A rule can prevent accidental coupling while also making a legitimate feature harder to express. Too little structure leaves each agent to invent its own architecture. Too much structure forces the application to fit decisions made before anyone understood its particular needs.

For each proposed constraint, explain the failure it prevents and the freedom it removes. “Database clients belong behind the persistence boundary” has a reason grounded in knowledge ownership. “Every application must have these seven folders” needs a separate argument. Familiarity with a structure is not enough to make it the right structure here.

Defaults still matter. A recognizable approach reduces the number of decisions an agent must invent and helps a person move between projects. Choose an opinionated default, then allow the user and agent to recognize when it no longer fits. A deliberate exception should leave behind a comprehensible replacement decision, rather than an unexplained special case future agents will copy.

Planning helps expose uncertainty, but use reveals gaps that a planning conversation will miss. Build the capabilities the application needs now. Let real features test whether the boundaries hold. A possible future deployment model may be worth considering when choosing a seam, without warranting implementation of that deployment model today.

Package boundaries deserve the same restraint. Several responsibilities can live in one package with low coupling. Separate packages become useful when actual consumers or operational needs justify them. More repositories and layers do not establish better knowledge ownership by themselves.

Judge the result through change. Pick a concrete new behavior and ask what an agent would have to understand and edit. If one business decision requires coordinated changes in unrelated places, examine where its knowledge has spread. If a small feature requires navigating a forest of abstractions, examine whether the restrictions are earning their cost. Use that evidence to improve the affected design without turning each feature into an unrelated cleanup campaign.

## Put repeatable knowledge into tools

An architectural rule that exists only in prose depends on each future agent noticing it, interpreting it, and remembering it at the right moment. When a rule is mechanical, encode it in the tools the project already uses.

Dependency checks are a useful example. If only persistence adapters should import a database driver, a lint rule can catch violations where they occur. The diagnostic should name the violated boundary and point to the intended approach. Deterministic scaffolding can establish the same conventions at project creation; shared configuration can distribute improvements without copying instructions everywhere.

Keep the reasoning in documentation even when tooling enforces the restriction. An agent still needs to understand why the boundary exists when a new requirement puts pressure on it. Tools can detect an import; they cannot decide whether the architecture should change.

Use documentation for the decisions that require judgment, with examples from the actual project. Keep always-loaded agent instructions short and give them explicit pointers to the deeper material needed for particular tasks. The goal is for the agent to reach the relevant reasoning when making the decision, rather than carry an architecture textbook through every edit.

Start with ordinary lint checks and useful guidance. Add enforcement machinery only for a concrete problem those mechanisms cannot address. The user and agent may deliberately adapt architectural checks as the design evolves; document the changed decision so the tooling and guidance continue to agree.

## Choose technology from the application's reality

Architectural judgment includes knowing which problems the application actually has. Labels such as “production,” “enterprise,” or “best practice” leave that question unanswered.

A small application with limited data and a simple operating model may reasonably use files for persistence. Versioning suitable data in Git may be useful. Another application may need database transactions, concurrent writers, or operational facilities that make a database the simpler choice. Discuss the users, data, access, volume, concurrency, and recovery needs that distinguish those cases.

Choose mechanisms against those conditions. Reuse libraries that handle generic work well. Preserve clear ownership and contracts regardless of whether the chosen implementation looks fashionable or modest.

Pragmatism also applies to evolution. A shared component should aim for compatible changes, but a permanent ban on breaking changes can prevent useful improvement. When a break is justified, document what consumers must change and let them upgrade deliberately. The practical test is whether a future agent can use those instructions to complete the upgrade without rediscovering the design from scratch.

Record the limits of the current choice and the circumstances that would justify revisiting it. That gives future agents a reason to change direction when the situation changes, while avoiding infrastructure built for hypothetical demands.

## Turn this thinking into project guidelines with Wayfinder

Use the manifesto to drive a conversation about a particular project. Begin with the application and its domain, the existing code if there is any, the chosen stack, and the operating constraints. Work through concrete behaviors to discover consequential choices. Keep proposals, agreed decisions, and unresolved questions distinguishable, and record decisions as the conversation reaches them.

A starting prompt:

> Help me derive architectural guidelines for this project using this manifesto. Ask questions that expose where knowledge belongs and how the parts should communicate. Involve me in designing the important contracts. Explain the reasoning and tradeoffs behind proposed restrictions, using examples from this application. Account for the stack's existing conventions and mechanisms. Produce project-specific guidance future coding agents can apply, preserving implementation freedom where a restriction has no useful purpose.

The resulting guide needs more than a repetition of these principles. It should name the project's concepts and their owners, identify dependency directions, and show a representative operation passing through the actual architecture. Document significant contracts and explain when changing them requires another design conversation. Include examples of misplaced knowledge and the correct home for it, plus executable checks where they fit.

Keep enough rationale that a future agent can reason about an unfamiliar case. A bare rule invites either blind compliance or casual dismissal. A rule tied to the failure it prevents helps the agent recognize when to follow it, when to question it, and what must remain true if it changes.

Before considering the guide usable, apply it to a real feature and a plausible subsequent change. The agent should be able to explain where the new knowledge belongs and which contracts it affects. Revise the guide where that exercise exposes ambiguity. Maintain it as decisions evolve, so future work starts from the architecture the project has chosen.
