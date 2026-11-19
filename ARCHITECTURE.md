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

Preserve the current storefront, responsive design, sample catalogue, cleaned/uncleaned options, weight and quantity choices, cart, checkout UI, address placeholder, tracking UI, contact area, and admin dashboard. The initial Phase 1 UI used mock data; current product reads, customer accounts, checkout/orders, tracking, protected admin order status, and manual delivery assignment are API-backed. Cart state stays local. No payment, maps, notifications, or delivery-provider integration is enabled.

### Phase 2 — Planning and architecture only

Planning includes owner decisions, domain/API contracts, collection and index design, threat/security review, MongoDB transaction assumptions, non-transactional consistency/failure handling, provider boundaries, and operations/release criteria. This phase does not implement backend endpoints or connect services.

### Phase 3 — Backend foundation and MongoDB connection (foundation implemented)

The foundation now lives in `server/`, independently of the React frontend. It uses Node.js/TypeScript, Express, Mongoose/MongoDB, Zod configuration validation, Pino HTTP logging/request IDs, Helmet, explicit CORS allowlisting, rate limits, a centralized safe error response, JSON size limits, `GET /health`, and `GET /openapi.json`. Docker Compose provides localhost-only MongoDB for development. Initial Mongoose schemas and indexes are grouped by users, products, pricing, inventory, orders, and delivery assignment.

Focused API tests run with Supertest and an injected MongoDB health state without connecting to a database. The live service requires a MongoDB connection at startup and initializes the declared indexes after connecting. The local Compose MongoDB is standalone and does not provide multi-document transactions. See `README.md` for setup and the transaction/fallback strategy.

The backend foundation is followed by the account/order implementation and Phase 6 admin management described below. Payments, maps, notifications, and provider delivery remain out of scope. CI setup and live MongoDB integration tests remain follow-up work.

### Later reviewed feature phases

Implemented vertical slices and remaining work:

1. **Implemented:** Public product read APIs with effective-dated prices, preparation options, and available stock.
2. **Implemented:** Customer-only registration, login/logout, Argon2id hashes, short-lived JWT access tokens, rotating opaque refresh tokens, and database-checked customer/admin authorization. Admin accounts are created by an interactive CLI, never by public registration.
3. **Implemented:** Customer checkout/order creation with server-calculated prices and fees, idempotency, conditional per-product stock reservation, order ownership reads, and admin status transitions.
4. **Implemented:** Frontend account, API-backed checkout, order tracking, and protected admin order/status views. Cart remains local to the browser.
5. **Implemented: Manual delivery assignment (current feature phase):** Admins may assign a shop delivery person or record a third-party method and reference manually. Delivery status transitions are validated; customer order responses expose only the assigned contact or service/reference needed for tracking. No provider is contacted.
6. **Implemented: Admin catalogue, pricing, stock, and order history:** Admin-only product create/read/update/deactivation, chronological Hyderabad-day price history, idempotent on-hand adjustments and stock movements, and owner/admin-scoped order event history. Product/order snapshots remain immutable. Stock changes and movement entries share a Stock document; order events share the Order document.
7. **Implemented preparation; provider integration remains later:** Provider-neutral delivery adapter contracts define normalized statuses, idempotent dispatch/cancel requests, retryable errors, and manual-fallback disposition. A fake adapter exists only in backend tests. No production adapter is configured; real provider integration requires explicit owner approval.
8. **Phase 8 preparation implemented; integrations remain later:** Provider-neutral payment, notification, maps/location, and image-storage contracts with deterministic test-only fakes. Contracts remain disconnected from routes, services, and startup; real providers and live behavior require separate owner approval.
9. **Pay-on-delivery launch method implemented:** New orders are server-assigned `pay_on_delivery` with `pending_collection`. Only an admin may record collection, and only after delivery; the transition is audited on the order. Cancelling an unpaid order marks it `not_collectible`. No online payment provider is connected.
10. **Remaining frontend stack adoption:** TypeScript, TanStack Query, React Hook Form/Zod, and React Testing Library; preserve current responsive UI and accessible loading, error, empty, and success states.

## Domain collections and design

Use Mongoose schemas with explicit validation and collection-level indexes. Store money as integer paise and weight as integer grams; make the shop's pricing day and display timezone explicit (`Asia/Kolkata`). Never rely on a browser calculation as the source of truth.

- **users:** customer/admin identity, normalized unique identifiers, Argon2 password hash where applicable, role, account state, and timestamps. Do not put an unconstrained role value in JWT claims and trust it indefinitely; authorize against current account/session state.
- **refreshSessions:** store only a hash of each opaque refresh token, user, expiry, rotation/revocation state, and device/session metadata needed for security. Rotate on use, detect reuse, and revoke a token family on replay.
- **products:** stable slug, name/description, size/category, active state, preparation-option references/settings, image reference, and timestamps.
- **dailyPrices:** product, integer paise per kg, effective interval, actor, and audit timestamps. Preserve history; do not overwrite a price used by an existing order.
- **stock:** per-product on-hand/reserved integer grams, a per-order reservation ledger, and an embedded append-only movement ledger (on-hand and reserved deltas, reason, actor/order reference, timestamp, idempotency operation ID). Update balances, reservation entries, and their movement atomically in the same Stock document.
- **carts (optional):** customer or short-lived guest cart and item selections. Treat it as a convenience only; recalculate price and validate stock when quoting and placing an order.
- **orders:** customer/contact and address snapshot, immutable item/preparation/weight/quantity/price/fee snapshots, integer subtotal/delivery/total paise, order status, fixed launch payment method (`pay_on_delivery`), payment collection status (`pending_collection`, `collected`, or `not_collectible`), optional collection timestamp, durable stock-operation state, timestamps, and customer-scoped idempotency metadata. The server initializes payment state; customer requests cannot set it.
- **orders.events (embedded):** append-only order/delivery/payment status and assignment history with actor role, state transition, and timestamp. Payment collection is an admin-only, delivered-only one-way transition that atomically records the timestamp and audit event. Cancelling an unpaid order marks it `not_collectible` and records that transition. Embedding the bounded (500-event) ledger makes each event atomic with its order mutation and allows owner-scoped history reads.
- **orders.deliveryAssignment (embedded):** Phase 5 assignment data stays in the order document so assignment/status changes are atomic for that order. It records method (`shop` or `third_party`), progress status, shop person contact or manually entered third-party label/reference/admin-only details. Do not store provider credentials here; a separately indexed collection can be considered if a later audit/history requirement justifies it.
- **delivery provider port (preparation only):** The backend adapter contract uses normalized delivery statuses, opaque order/delivery identifiers, and idempotency keys for dispatch and cancellation. Repeating an operation with the same key/input must replay the original result; changed input with a reused key is an idempotency conflict. Provider-neutral errors carry retryability and a manual-fallback disposition. It is not connected to routes, orders, or a provider; provider-specific request data and persistence are deferred until an owner approves an integration and its data-sharing requirements.
- **payment provider port (Phase 8 preparation):** Payment intent, status lookup, and refund use integer paise, normalized states, idempotency keys, and provider-neutral errors. No card data is accepted or stored. The contract and test-only fake are not wired into checkout, order state, routes, or startup. Pay on delivery is implemented separately as the fixed launch method; no online provider is enabled.
- **notification provider port (Phase 8 preparation):** Email/SMS sends use an opaque recipient reference, template key, and explicitly supplied bounded template variables, with normalized outcomes and idempotency keys. The contract does not define an event-specific safe-variable allowlist; any future sender must add one and enforce consent and opt-out. A recording fake exists only in tests. No sender, queue, route, or startup behavior is configured; templates, retention, and provider choice remain owner decisions.
- **maps/location provider port (Phase 8 preparation):** Address geocoding returns normalized found/ambiguous/not-found outcomes and optional precision-labeled coordinates. A fake uses only synthetic test fixtures. The contract is not wired to checkout, browser location, tracking, routes, or startup; no address is sent externally or persisted by this preparation.
- **image storage provider port (Phase 8 preparation):** An opaque object-key contract supports metadata reference lookup and deletion with normalized image content types. A deterministic fake uses synthetic metadata only and stores no bytes. To honor the no-upload boundary, object creation/upload is not part of this slice; no upload route, storage backend, or startup wiring exists. File limits, content inspection, access policy, retention, and provider choice require owner approval before any write capability is designed.
- **idempotencyRecords / outbox (as needed):** unique idempotency key and request fingerprint; durable intent for reliable internal follow-up work when a multi-document transaction cannot be used.

Indexes to plan and test include: normalized user login identifier (unique), product slug (unique), product active/category lookup, unique daily price by product/effective date, stock by unique product ID and reservation order ID, order by status/created time and customer/date, and unique order idempotency key. Stock/order event ledgers are embedded in their owning documents. Avoid storing unnecessary personal data in indexes or public API responses.

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

Public product reads and Phase 6 admin/order-history endpoints below are implemented.

### Public/customer

- `GET /api/v1/health` — process/readiness status with dependency state clearly distinguished.
- `GET /api/v1/products` and `GET /api/v1/products/:slug` — active products and current effective prices, preparation options, and available stock.
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` — implemented for customer accounts; public registration cannot grant admin roles.
- `GET/POST/PATCH/DELETE /api/v1/cart` — only if a persistent server-side cart is approved.
- `POST /api/v1/orders` — implemented; validate current server prices/options/stock, apply idempotency, and reserve stock. No quote API is currently provided.
- `GET /api/v1/orders`, `GET /api/v1/orders/:id` — customer-scoped; admins can read recent orders.
- `GET /api/v1/orders/:id/events` — order owner or admin; customer response omits actor IDs and internal notes.

### Admin

- Admins use the same `/api/v1/auth/*` endpoints as customers; role authorization is enforced from current MongoDB account state on every protected request.
- `GET/POST /api/v1/admin/products`, `GET/PATCH /api/v1/admin/products/:productId` — product management and deactivation; every route requires current admin authorization. Admin list and stock reads are paginated with bounded offset/limit.
- `POST/GET /api/v1/admin/products/:productId/prices` — append/read chronological price history; effective date is midnight `Asia/Kolkata`, stored in integer paise per kg.
- `GET /api/v1/admin/stock`, `POST /api/v1/admin/stock/:productId/adjustments`, `GET /api/v1/admin/stock/:productId/movements` — on-hand adjustments never change reservations; signed integer grams, reserved-stock bounds, and actor-scoped idempotency are enforced. The ledger contains adjustment, order reservation/release, and fulfillment movements.
- `GET /api/v1/orders` — returns recent orders to admins.
- `PATCH /api/v1/orders/:id/status` — implemented with server-side role checks and explicit transition rules.
- `PATCH /api/v1/orders/:id/delivery` — implemented, admin-only; saves shop person contact or manually entered third-party label/reference/details. No external provider is called.
- `PATCH /api/v1/orders/:id/delivery/status` — implemented, admin-only; validates manual delivery progress transitions.
- Order status and delivery assignment/progress mutations append bounded embedded events atomically; the event history endpoint is readable only by the order owner or an admin.
- `PATCH /api/v1/orders/:id/status` — an order can move to `out_for_delivery` only after a manual delivery assignment; delivery completion/cancellation stays coupled to the existing stock-consumption/release behavior.

Validate params, query, headers, and body with Zod at the API boundary. Document stable request/response and error shapes in OpenAPI. Never accept browser-supplied role, trusted prices/totals, payment status, delivery-provider status, or available stock.

## Authentication and security requirements

- Hash passwords with Argon2id and appropriate deployment-calibrated parameters; never store or log plaintext passwords.
- Use short-lived access JWTs with minimal claims, issuer/audience/expiry checks, key rotation planning, and current account-state checks.
- Use opaque, high-entropy refresh tokens stored only as hashes server-side; rotate on every refresh, detect reuse, support revocation/expiry, and protect browser delivery using an appropriately configured Secure, HttpOnly, SameSite cookie plus CSRF defenses. Decide how non-browser clients are supported before finalizing token transport.
- Apply customer/admin role authorization on every protected route. The admin UI is not a security boundary.
- Require admin authorization for every delivery assignment or delivery progress write. Validate method-specific fields and status transitions server-side; never accept provider-reported status from a browser or external service in this phase.
- Use explicit CORS origins, secure headers, request size/time limits, conservative rate limits, request IDs, centralized safe error responses, and structured logs with sensitive fields redacted.
- Validate all values server-side; enforce allowed weights, quantity limits, fees, current prices, stock, status transitions, and request idempotency.
- Keep order delivery responses role-appropriate: authenticated customers receive the assigned shop contact or third-party label/reference needed for coordination, never admin-only delivery notes. Any future unauthenticated tracking endpoint must use unguessable tokens and return minimal data.
- Protect MongoDB with least-privilege users, network restrictions, TLS in hosted environments, encrypted backups, retention rules, and tested restore procedures.
- Never store payment card details. Keep secrets in deployment secret stores, not source, client bundles, logs, or AI-agent prompts.

## Provider and paid-account boundaries

No external provider is selected or connected. Obtain owner approval before creating accounts, sharing customer data, entering credentials, or incurring fees.

- **Payments:** provider-independent interface; provider/account credentials, webhook signing secret, and transaction fees require approval. Sandbox/test mode first; never store card details.
- **Maps/location:** provider adapter only; paid maps/geocoding may require a key and usage charges. Define consent, accuracy, coverage, and retention before enabling.
- **Delivery:** separate shop-person and third-party strategies. The provider-neutral adapter contract and test-only fake establish normalized outcomes, idempotency, provider-neutral errors, and manual fallback. The existing manual assignment remains the live default/fallback. A real third-party adapter needs an approved provider account, credentials, contract, approved data-sharing scope, and agreed failure/manual fallback.
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
3. Daily-price publish/cutoff time, expiry behavior, and whether an accepted quote locks a price for a defined duration. Phase 6 interprets an entered effective date at midnight `Asia/Kolkata` and requires chronological additions.
4. Stock measurement, waste/yield accounting, reservation expiry, cancellation/release rules, and production alerting for interrupted inventory recovery.
5. Guest checkout remains disabled; customer accounts are implemented. Confirm required customer fields and data retention/deletion policy.
6. Order cancellation, substitution, out-of-stock, refund, complaint, and order-status policies.
7. Whether shop-owned delivery is manually assigned, what information a rider may access, and which third-party provider (if any) to evaluate.
8. **Resolved for launch:** Pay on delivery is the launch method. Collection is recorded by an admin only after delivery. No online payment provider is selected; any later provider decision needs separate approval.
9. Whether maps/live location and email/SMS are needed at launch and the acceptable consent, privacy, and cost model.
10. Admin access requirements, owner MFA/recovery process, backup/restore objectives, hosting region, and production support responsibilities.

## Current implementation gaps

The frontend is still React JavaScript/JSX; TypeScript, TanStack Query, React Hook Form/Zod, and React Testing Library remain target-stack work. The backend implements account access, protected order creation/read/status operations, resumable stock reservation on MongoDB standalone, admin-only manual delivery assignment/progress with customer-safe assignment details, admin product/price/stock writes with status audit history, and admin-only delivered-order pay-on-delivery collection recording. Customer profile management, production provider adapters, CI, and live MongoDB integration tests remain follow-up work. The delivery and online-payment adapter contracts are not wired into the live workflow; no online payment provider is connected.
