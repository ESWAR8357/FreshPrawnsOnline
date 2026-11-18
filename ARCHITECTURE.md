# Fresh Prawns Online — Architecture and Phase Plan

## Architecture goals

- Keep the working Phase 1 React storefront and the API as separate services in the same repository; deploy them independently.
- Use REST APIs, versioned under `/api/v1`, between the browser and the backend.
- Build one TypeScript/Node.js modular monolith, organized around business capabilities. Do not split it into microservices.
- MongoDB is the only application database. Use Mongoose models, MongoDB validators where appropriate, and explicit indexes.
- Keep external integrations behind provider-independent interfaces. No provider, paid account, credential, or live connection is approved by this plan.
- Treat the current frontend sample data as the only Phase 1 source of behavior. Backend and frontend integration happen only in later, reviewed phases.

## Required technology stack

### Frontend

- React and TypeScript
- Vite and Tailwind CSS
- React Router
- TanStack Query for remote/server state
- React Hook Form and Zod for forms and client-side validation
- Vitest and React Testing Library for frontend tests

Phase 1 may continue to use local React state and sample data. Do not imply that the TypeScript migration, remote query layer, form library, or frontend tests are already complete.

### Backend

- Node.js and TypeScript
- Express
- MongoDB and Mongoose; MongoDB is the only application database
- Zod for environment and request validation
- JWT access tokens with short expiry and a secure refresh-token design
- Argon2 password hashing
- Role-based authorization for customers and admins
- OpenAPI documentation for REST endpoints
- Vitest and Supertest for backend tests

### Repository and local development

Keep the current frontend at the repository root and add the backend as a separate application/service (for example `server/`). Group backend modules by business area. Use Docker Compose to run MongoDB locally; do not make a local database a production dependency. Keep example env files safe and placeholder-only, ignore real `.env` files, and validate every required setting at service startup.

Suggested eventual backend organization:

```text
server/
  src/
    app.ts
    config/
    middleware/
    modules/
      auth/
      users/
      products/
      pricing/
      inventory/
      carts/
      orders/
      delivery/
      payments/
      notifications/
      images/
    providers/
    openapi/
  test/
docker-compose.yml
```

Only add modules when their phase is approved. A folder or interface for a future integration is not authorization to connect a provider.

## Phases

### Phase 1 — Frontend-only prototype (existing)

Preserve the current storefront, responsive design, sample catalogue/orders, cleaned/uncleaned options, weight and quantity choices, cart, checkout UI, address placeholder, tracking UI, contact area, and admin demo. Mock values and local state are clearly not live commerce data. Do not add a real payment, map, delivery, inventory, order, or authentication integration.

### Phase 2 — Planning and architecture only

Planning includes owner decisions, domain/API contracts, collection and index design, threat/security review, MongoDB transaction assumptions, non-transactional consistency/failure handling, provider boundaries, and operations/release criteria. This phase does not implement backend endpoints or connect services.

### Phase 3 — Backend foundation and MongoDB connection (foundation implemented)

The foundation now lives in `server/`, independently of the React frontend. It uses Node.js/TypeScript, Express, Mongoose/MongoDB, Zod configuration validation, Pino HTTP logging/request IDs, Helmet, explicit CORS allowlisting, rate limits, a centralized safe error response, JSON size limits, `GET /health`, and `GET /openapi.json`. Docker Compose provides localhost-only MongoDB for development. Initial Mongoose schemas and indexes are grouped by users, products, pricing, inventory, orders, and delivery assignment.

Focused API tests run with Supertest and an injected MongoDB health state without connecting to a database. The live service requires a MongoDB connection at startup and initializes the declared indexes after connecting. The local Compose MongoDB is standalone and does not provide multi-document transactions. See `README.md` for setup and the transaction/fallback strategy.

This foundation does not implement business endpoints, authentication/session flows, role enforcement, checkout, inventory updates, payment, maps, notifications, or delivery-provider calls. The Phase 1 frontend continues to use mock data. CI setup and broader MongoDB integration tests remain follow-up work.

### Later reviewed feature phases

Implement small vertical slices, with tests and human review:

1. Public product read APIs plus admin-managed products and effective-dated daily prices.
2. Stock-by-weight records, append-only adjustments, reservation/release behavior, and concurrency controls.
3. Customer/admin authentication, refresh-token lifecycle, Argon2 hashes, and role-based authorization.
4. Server-backed cart/quote and idempotent order creation with server-calculated prices, fees, and stock checks.
5. Order operations, safe public tracking, status history, and shop-person delivery assignment.
6. Independent third-party delivery adapter, then provider-approved integrations only after explicit owner approval.
7. Provider-independent payments, notifications, maps/location, and image storage; sandbox first and live operation only after approval.
8. Gradual frontend integration using TanStack Query and React Hook Form/Zod while preserving responsive UI and accessible loading, error, empty, and success states.

## Domain collections and design

Use Mongoose schemas with explicit validation and collection-level indexes. Store money as integer paise and weight as integer grams; make the shop's pricing day and display timezone explicit (`Asia/Kolkata`). Never rely on a browser calculation as the source of truth.

- **users:** customer/admin identity, normalized unique identifiers, Argon2 password hash where applicable, role, account state, and timestamps. Do not put an unconstrained role value in JWT claims and trust it indefinitely; authorize against current account/session state.
- **refreshSessions:** store only a hash of each opaque refresh token, user, expiry, rotation/revocation state, and device/session metadata needed for security. Rotate on use, detect reuse, and revoke a token family on replay.
- **products:** stable slug, name/description, size/category, active state, preparation-option references/settings, image reference, and timestamps.
- **dailyPrices:** product, integer paise per kg, effective interval, actor, and audit timestamps. Preserve history; do not overwrite a price used by an existing order.
- **stock:** per-product on-hand/reserved integer grams and version/update metadata. Pair balance updates with append-only **stockMovements** (signed delta, reason, actor, reference, timestamp).
- **carts (optional):** customer or short-lived guest cart and item selections. Treat it as a convenience only; recalculate price and validate stock when quoting and placing an order.
- **orders:** customer/contact and address snapshot, immutable item/preparation/weight/quantity/price/fee snapshots, integer subtotal/delivery/total paise, status, opaque tracking token hash, timestamps, and idempotency metadata.
- **orderEvents:** append-only status and administrative event history with actor and timestamp.
- **deliveryAssignments:** order, method (`SHOP` or `THIRD_PARTY`), assignment/status, internal assignee or provider-neutral reference, and timestamps. Do not store provider credentials here.
- **idempotencyRecords / outbox (as needed):** unique idempotency key and request fingerprint; durable intent for reliable internal follow-up work when a multi-document transaction cannot be used.

Indexes to plan and test include: normalized user login identifier (unique), product slug (unique), product active/category lookup, daily price by product and effective time, stock by unique product ID, order by status/created time and customer/date, unique idempotency key, unique tracking-token hash, and event/assignment history by order and time. Avoid storing unnecessary personal data in indexes or public API responses.

## MongoDB consistency and transactions

Do not assume transactions are enabled. Multi-document transactions require a MongoDB replica set or sharded deployment; a standalone MongoDB server does not support them. Confirm the selected local/staging/production topology before relying on transactions.

**When transactions are available:** create the order, reserve inventory, create order items/events, and finalize the idempotency record within a bounded transaction. Retry only transient transaction errors, with limits and idempotency protection.

**When transactions are unavailable:** do not pretend several writes are atomic. Prefer a single-document conditional atomic update for each product stock balance (for example, decrement only when available grams cover the requested amount, with a version/available-stock predicate). Use a durable, idempotent reservation/order state machine:

1. Create a unique idempotency/reservation record in a pending state.
2. Atomically reserve each affected product balance with conditional updates. Record reservation operation IDs so retries cannot reserve twice.
3. Create the pending order and its immutable line snapshots.
4. Finalize the reservation/order. If a later step fails, compensate by releasing every completed reservation and mark the operation failed/recoverable.
5. On process restart, a reconciler inspects stale pending operations and either completes or compensates them. Use bounded retries, observable alerts, and an admin repair path.

For multi-product checkout, transient partial reservations are possible without transactions; the UI and state model must not confirm an order until every reservation and order write is finalized. Make each operation idempotent, retain a durable event/outbox for repair, and test crashes/failures at every step. If these guarantees cannot meet the shop's operational needs, require a replica-set deployment rather than claiming standalone MongoDB offers equivalent atomicity.

## REST API outline

These are future contracts to refine during Phase 2, not endpoints already implemented.

### Public/customer

- `GET /api/v1/health` — process/readiness status with dependency state clearly distinguished.
- `GET /api/v1/products` and `GET /api/v1/products/:productId` — active products and current effective prices/preparation options.
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout` — only if the owner chooses customer accounts; otherwise provide a carefully designed guest-checkout flow.
- `GET/POST/PATCH/DELETE /api/v1/cart` — only if a persistent server-side cart is approved.
- `POST /api/v1/checkout/quote` — validate requested items and return a server-calculated quote; a quote is not stock reservation unless stated.
- `POST /api/v1/orders` — validate current server prices/options/stock, apply idempotency, and create/reserve the order.
- `GET /api/v1/orders/track/:token` — expose only limited status and delivery information via an unguessable token.

### Admin

- `POST /api/v1/admin/auth/login`, `/refresh`, `/logout`, `GET /api/v1/admin/auth/me`.
- `POST/GET/PATCH /api/v1/admin/products` and `/api/v1/admin/products/:productId`.
- `POST /api/v1/admin/products/:productId/prices` — append a new effective-dated price.
- `GET /api/v1/admin/stock`, `POST /api/v1/admin/stock/:productId/adjustments`.
- `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/:orderId`.
- `PATCH /api/v1/admin/orders/:orderId/status` with explicit transition rules.
- `PATCH /api/v1/admin/orders/:orderId/delivery` for internal assignments or an approved adapter.

Validate params, query, headers, and body with Zod at the API boundary. Document stable request/response and error shapes in OpenAPI. Never accept browser-supplied role, trusted prices/totals, payment status, delivery-provider status, or available stock.

## Authentication and security requirements

- Hash passwords with Argon2id and appropriate deployment-calibrated parameters; never store or log plaintext passwords.
- Use short-lived access JWTs with minimal claims, issuer/audience/expiry checks, key rotation planning, and revocation/session checks where required.
- Use opaque, high-entropy refresh tokens stored only as hashes server-side; rotate on every refresh, detect reuse, support revocation/expiry, and protect browser delivery using an appropriately configured Secure, HttpOnly, SameSite cookie plus CSRF defenses. Decide how non-browser clients are supported before finalizing token transport.
- Apply customer/admin role authorization on every protected route. The admin UI is not a security boundary.
- Use explicit CORS origins, secure headers, request size/time limits, conservative rate limits, request IDs, centralized safe error responses, and structured logs with sensitive fields redacted.
- Validate all values server-side; enforce allowed weights, quantity limits, fees, current prices, stock, status transitions, and request idempotency.
- Keep public tracking responses minimal; use unguessable tracking tokens and never return full phone/address or internal assignment notes publicly.
- Protect MongoDB with least-privilege users, network restrictions, TLS in hosted environments, encrypted backups, retention rules, and tested restore procedures.
- Never store payment card details. Keep secrets in deployment secret stores, not source, client bundles, logs, or AI-agent prompts.

## Provider and paid-account boundaries

No external provider is selected or connected. Obtain owner approval before creating accounts, sharing customer data, entering credentials, or incurring fees.

- **Payments:** provider-independent interface; provider/account credentials, webhook signing secret, and transaction fees require approval. Sandbox/test mode first; never store card details.
- **Maps/location:** provider adapter only; paid maps/geocoding may require a key and usage charges. Define consent, accuracy, coverage, and retention before enabling.
- **Delivery:** separate shop-person and third-party strategies. A real third-party adapter needs an approved provider account, credentials, contract, and agreed failure/manual fallback.
- **Email/SMS:** adapter only; sender registration, templates, credentials, and per-message fees require approval.
- **Image storage:** storage interface with local development implementation; an approved cloud storage account, credentials, retention, access controls, and charges are later decisions.

## Operations, CI, and release plan

- Local development: Docker Compose MongoDB only; never expose its development credentials to a public network.
- Keep `.env` and all credential-bearing files ignored. Commit safe examples with obvious placeholders and document required variables. Validate them using Zod before startup.
- Keep frontend and backend build/start/deploy artifacts independent; use a reverse proxy or explicitly configured API origin only when integration is approved.
- Add CI for frontend/backend lint, TypeScript checks, unit/API tests, production builds, OpenAPI consistency, and MongoDB integration tests on an isolated test service. CI must use disposable synthetic data and non-production credentials.
- Recommend a managed Node hosting platform and MongoDB replica-set-capable managed database for production, with least privilege, TLS, encryption, monitoring, point-in-time backups, restore drills, and alerting. Select a vendor only after owner review; no resources are provisioned by this plan.
- Release first to private staging with synthetic data; document migration/rollback and incident procedures. Require human approvals for production, payment, stock/order mutations, and delivery operations. AI agents do not autonomously act on real money, live inventory, customers, or dispatch.

## Open decisions for the shop owner

Resolve these in planning before the relevant code is implemented:

1. Exact Hyderabad delivery areas/pin codes, excluded areas, delivery hours, minimum order, and fee rules by method.
2. Allowed weight increments and quantity caps; whether cleaning has a fixed fee, a per-weight fee, a yield effect, or product-specific rules.
3. Daily-price timezone, publish/cutoff time, expiry behavior, and whether an accepted quote locks a price for a defined duration.
4. Stock measurement, waste/yield accounting, reservation duration, cancellation/release rules, and handling partial multi-product reservation failure.
5. Guest checkout versus customer accounts, required contact fields, and customer data retention/deletion policy.
6. Order cancellation, substitution, out-of-stock, refund, complaint, and order-status policies.
7. Whether shop-owned delivery is manually assigned, what information a rider may access, and which third-party provider (if any) to evaluate.
8. Payment method for launch (including whether cash at delivery is acceptable); no paid provider is selected.
9. Whether maps/live location and email/SMS are needed at launch and the acceptable consent, privacy, and cost model.
10. Admin access requirements, owner MFA/recovery process, backup/restore objectives, hosting region, and production support responsibilities.

## Current implementation gaps

The frontend is still React JavaScript/JSX; TypeScript, TanStack Query, React Hook Form, and React Testing Library remain target-stack work. The previous Fastify/Prisma/PostgreSQL backend scaffold has been replaced by the Express/Mongoose/MongoDB foundation. Authentication libraries and flows, Argon2, customer/admin authorization, business REST endpoints, provider adapters, CI, and database-backed integration tests remain for their later approved phases. The schema files are foundations; they do not enable real commerce workflows by themselves.
