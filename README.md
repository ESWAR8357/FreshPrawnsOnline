# Fresh Prawns Online

Fresh Prawns Online is a customer storefront and owner dashboard for a single-owner prawn shop serving Hyderabad. Frontend and backend are independently runnable services in this repository. Product, price, stock, account, checkout, and order-status requests use REST APIs; payments, maps, and delivery dispatch are not connected.

## Current project stack

- **Frontend:** React, JavaScript/JSX today, Vite, Tailwind CSS, React Router. TypeScript, TanStack Query, React Hook Form/Zod, and React Testing Library are target frontend choices to adopt in later reviewed work; they are not all implemented yet.
- **Backend:** Node.js/TypeScript, Express, MongoDB/Mongoose, Zod configuration and request validation, Argon2id password hashing, short-lived JWT access tokens, rotating opaque refresh tokens, Pino request logging, Helmet, CORS allowlist, and rate limits.
- **Backend APIs:** process and MongoDB readiness at `GET /health`; OpenAPI JSON at `GET /openapi.json`; public catalogue at `GET /api/v1/products` and `GET /api/v1/products/:slug`; customer auth at `/api/v1/auth`; customer/admin order APIs at `/api/v1/orders`; admin product, pricing, and stock APIs at `/api/v1/admin`.
- **Database:** MongoDB is the only application database. Local development uses Docker Compose. Frontend and backend are independently started and built.

## Phase 1 frontend

The Phase 1 storefront presentation is preserved. Product, current price, preparation options, and availability are API-backed; the following remain mock/local demonstrations:

- Responsive homepage, catalogue, product details, cleaned/uncleaned choice, weight and quantity selection, cart, account form, checkout UI, address/location placeholder, order tracking, and support/contact section.
- `/checkout` requires a customer account and submits selection/address/delivery method only. The server reads current product options and daily prices, reserves available stock, and calculates the final total. Cart contents remain browser-local until order submission.
- Admin dashboard at `/admin` requires an API-verified admin role. Orders, status updates, manual delivery assignment, product management, daily pricing, stock adjustments, and movement history use protected APIs.
- Routes: `/`, `/shop`, `/product/:id`, `/cart`, `/account`, `/checkout`, `/track`, and `/admin`.
- No payments, maps/location providers, delivery dispatch providers, email/SMS, or cloud image storage are connected. Delivery assignment is manual only.

## Local setup

### Prerequisites

- Node.js 22 or newer and npm.
- Docker Desktop with Docker Compose for the local MongoDB container.

### Configure MongoDB

1. Copy the safe placeholder template and edit it for local development:

   ```powershell
   Copy-Item .env.example .env
   ```

2. In `.env`, replace the MongoDB local placeholder password in both MongoDB settings with the same local-only value. Replace `JWT_ACCESS_SECRET` with a locally generated random value of at least 32 characters (for example, `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`). Do not commit `.env`; never put real or production secrets in the example file.
3. Start the local database:

   ```powershell
   docker compose up -d mongodb
   ```

   The container binds to localhost only and stores local data in a named Docker volume.

### Run the frontend and API

Install the frontend and separate API dependencies:

```powershell
npm install
npm --prefix server install
```

In separate VS Code terminals, start each service:

```powershell
npm run dev
npm run dev:api
```

The frontend is normally at `http://localhost:5173`; the API listens on `http://127.0.0.1:4000`. Verify API process and database readiness at `http://127.0.0.1:4000/health` and view the current OpenAPI document at `http://127.0.0.1:4000/openapi.json`. The health route returns `503` and `database: "disconnected"` if the MongoDB connection is not ready. API startup requires MongoDB and fails explicitly if it cannot connect.

The Vite development server proxies `/api` requests to the local API. For separately hosted services, set `VITE_API_BASE_URL` to the API origin at frontend build time and add the frontend origin to the API's `CORS_ORIGINS`. Keep the UI and API on the same site (for example, sibling subdomains) or use a same-site reverse proxy so the `SameSite=Strict` refresh cookie works. The API reads the root `.env` using Node's `--env-file` option. MongoDB URI, JWT secret, token lifetimes, CORS origins, rate limits, and runtime settings are validated with Zod before startup.

### Load clearly labeled sample catalogue data

The database starts empty. After starting MongoDB and installing dependencies, run the explicit development-only seed command to load four sample products, today's sample prices, and stock weights:

```powershell
npm --prefix server run seed:sample
```

The command runs only when `NODE_ENV=development` and `MONGODB_URI` points to a local host. Seeded products are marked as sample data; do not treat their prices or quantities as real shop inventory. Re-running the command refreshes the same sample products, today's sample prices, and stock values, and resets their stock reservations; do not rerun it while preserving local order reservations.

### Create the first admin account

Public registration always creates a `customer`; submitted role fields are rejected. Once MongoDB is running and `.env` is configured, provision the owner/admin account from an interactive terminal:

```powershell
npm --prefix server run create:admin
```

The command prompts for an email and a 12–128 character password without echoing the password, hashes it with Argon2id, and creates the admin role directly in MongoDB. It does not accept an admin role through any public API. If the chosen email already exists, create a separate admin identity rather than changing a customer's role from the browser.

### Public catalogue API

- `GET /api/v1/products` — active products enriched with the currently effective daily price, enabled preparation options, and stock in grams. Optional validated filters: `?size=Small|Medium|Large` and `?preparation=cleaned|uncleaned`.
- `GET /api/v1/products/:slug` — one active product with the same price and availability fields.
- Prices are integer paise per kg (`pricePerKgPaise`); stock quantities are integer grams (`stock.onHandGrams`, `stock.availableGrams`). A product with no current price returns `pricePerKgPaise: null`; missing stock is reported as zero available grams.
- Invalid filters/slugs return a structured `400`; unknown or inactive products return `404`; MongoDB unavailability returns `503`.

These public routes expose only active products. Admin write operations are separate, authenticated APIs described below.

### Admin products, pricing, and stock

Every `/api/v1/admin/*` endpoint requires a current database-verified admin account. Customers and unauthenticated callers receive `403` and `401`, respectively. Request bodies and query parameters are strictly validated; unknown fields are rejected.

- `GET /api/v1/admin/products?active=true|false&size=...&limit=...&offset=...` lists products, including inactive ones when requested. `POST /api/v1/admin/products` creates a product. `GET /api/v1/admin/products/:productId` reads one. `PATCH /api/v1/admin/products/:productId` updates fields; `{ "active": false }` deactivates instead of deleting a product.
- Product slugs are unique and constrained; preparation types cannot be duplicated. Descriptions and URLs have size/HTTPS validation. Historical orders retain their product, name, and price snapshots.
- `POST /api/v1/admin/products/:productId/prices` accepts an integer `pricePerKgPaise` and `effectiveDate` (`YYYY-MM-DD`). The date begins at midnight in `Asia/Kolkata`. Prices are added chronologically; edits, duplicate days, and backdated entries are rejected. `GET /api/v1/admin/products/:productId/prices` returns paginated history.
- `GET /api/v1/admin/stock` returns on-hand, reserved, and available grams. `POST /api/v1/admin/stock/:productId/adjustments` applies a signed `deltaGrams`, reason, optional reference, and UUID idempotency key. A reduction cannot take on-hand stock below reserved stock; reservation quantities cannot be changed through this endpoint.
- `GET /api/v1/admin/stock/:productId/movements` returns the append-only per-product movement history, including manual adjustments, order reservations/releases, and fulfillment.
- Stock balance changes and their movement entries are embedded and updated atomically in the same Stock document. Retrying an adjustment with the same admin and idempotency key returns its prior movement without applying the delta again.

### Accounts and orders

- `POST /api/v1/auth/register` and `POST /api/v1/auth/login` accept email/password; passwords are 12–128 characters. Registration cannot create admins.
- Successful login/register returns a short-lived access JWT in the JSON response and sets an opaque, rotating refresh token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Refresh tokens are stored only as SHA-256 hashes in MongoDB; access tokens are intended to remain in frontend memory, not local storage.
- `POST /api/v1/auth/refresh` rotates the refresh token; reuse of a revoked token revokes its token family. `POST /api/v1/auth/logout` revokes the active refresh session. `GET /api/v1/auth/me` returns the active account.
- `POST /api/v1/orders` requires a customer bearer token and a UUID idempotency key. It accepts product slugs, cleaned/uncleaned selection, weight (250/500/1000 g), quantity, contact/address details, and `shop` or `third_party` delivery method. Browser-supplied prices, fees, totals, roles, stock, and payment state are not accepted.
- `GET /api/v1/orders` is scoped to the signed-in customer and supports cursor pagination (`limit`, `cursor`), status filtering, and an ISO timestamp range (`from`, inclusive; `to`, exclusive). It returns `data` plus `pagination.nextCursor`; admins receive the latest 100 orders. `GET /api/v1/orders/:id` checks ownership for customers. `PATCH /api/v1/orders/:id/status` is admin-only and validates allowed status transitions on the server.
- `GET /api/v1/orders/:id/events` returns append-only order and delivery status history to the owning customer or an admin; it does not expose actor IDs or internal notes. Status changes and their event entries are embedded in the order document and written atomically.
- `PATCH /api/v1/orders/:id/delivery` is admin-only. It records a shop delivery person's name/contact or a manually entered third-party service label, reference, and admin-only details. `PATCH /api/v1/orders/:id/delivery/status` is admin-only and accepts only valid manual progress transitions. Customer order responses include the assigned shop contact or third-party label/reference, but omit internal delivery notes.
- An order must have an assignment before it can move to `out_for_delivery`. Delivery progress reaching `in_transit` is coordinated with the order status; marking an order delivered/cancelled continues to use the existing stock-consumption/release workflow. Assignment changes do not rewrite the order's original delivery-fee snapshot.
- Delivery fees are currently explicit Phase 1 server demo values (₹40 for shop delivery and ₹60 for third-party method); confirm the owner's final fee/area rules before treating these values as business policy. The third-party option records a preference only and does not dispatch a provider.
- Authentication routes have an additional 10-request/15-minute rate limit. All private API responses use `Cache-Control: no-store`; protected routes verify the current user/role from MongoDB on each request.

### Provider-independent delivery adapter preparation

The backend defines a provider-neutral adapter contract for dispatch and cancellation with normalized statuses and idempotency keys. A repeated operation with the same key and input must replay its original result; reusing a key for changed input must fail. Provider-neutral errors indicate retryability and whether manual fallback is available, recommended, or required. A fake adapter is defined only in tests and performs no network calls. This contract is not connected to the order routes or manual assignment workflow: manual assignment remains the live default and fallback. No provider, provider-specific data fields, credentials, or external data sharing are configured. Select and approve a provider and its data-sharing/account requirements before implementing a production adapter.

## Checks

```powershell
npm run build
npm run lint
npm run test:frontend
npm --prefix server run lint
npm run test:api
npm run typecheck:api
npm run build:api
```

API tests use Supertest and injected services, so focused validation runs without connecting to a real database. For database-backed local development, start Compose first. `npm run lint` at the repository root checks the frontend; API lint, tests, typecheck, and build are run with the commands above.

## Backend foundation boundaries

The API includes environment validation, MongoDB connection lifecycle, startup index initialization, health/OpenAPI endpoints, request IDs, structured request logs with sensitive headers redacted, secure headers, allowlisted CORS, request rate limits, JSON size limits, centralized safe errors, public catalogue reads, authentication, and customer/admin order routes. Schemas and endpoints are grouped by business area under `server/src/modules/`.

Product catalogue, daily pricing, stock management, order management, and manual delivery assignment use MongoDB when the configured local database is running. This is not a production-ready commerce release: there is no payment collection, provider delivery dispatch, maps, customer notification integration, or production hosting.

## MongoDB consistency

The Compose database is a standalone MongoDB instance, which does not support multi-document transactions. Later order and stock work must not assume transaction support:

- An order is first persisted in `reserving` state. Each product stock document atomically records its reserved grams and the owning order ID in a reservation ledger, using a conditional availability update.
- The order is available to the customer only after every item reservation is recorded and the order state is `reserved`. A customer-scoped idempotency key and request fingerprint make retries safe; changing order details while reusing a key returns a conflict.
- Cancellation releases the order's reservation ledger entries; delivery consumes the reserved grams from on-hand stock. Intermediate `releasing`/`consuming` states make those operations resumable.
- Each stock reservation, release, fulfillment, and admin adjustment appends its movement to the same Stock document as its balance update. Each successful order/delivery status transition appends an event to the Order document with the state change, actor role, and timestamp.
- At API startup, incomplete reservation and terminal stock transitions are resumed from the durable order/stock records. If recovery cannot safely complete, API startup fails instead of serving with uncertain inventory.
- MongoDB standalone cannot make stock updates across multiple product documents atomic. The per-document ledger, conditional updates, durable operation states, idempotency, and startup recovery avoid relying on transactions; business-critical deployments may still choose a replica set and transactions after reviewing the operational trade-offs.
- If business requirements need atomic multi-document order/stock writes, use and test a replica-set-capable MongoDB deployment; that topology decision must be made before implementation.

## Phase boundaries and future integrations

1. **Phase 1:** Frontend UI using sample catalogue data; now connected to product reads and the account/order APIs where available.
2. **Phase 2:** Planning and architecture, including owner decisions and consistency/security review.
3. **Phase 3:** Backend foundation and MongoDB connection, now implemented as described above.
4. **Phase 4:** Public product, current daily-price, and stock-availability reads; storefront integration.
5. **Manual delivery assignment:** Admin-only assignment to the shop's delivery person or manually recorded third-party method, validated delivery progress, and customer-safe order tracking. No provider is contacted.
6. **Phase 6:** Admin product/pricing/stock management, append-only stock movement history, and owner-scoped order status event history.
7. **Later phases:** Notifications, provider adapters, and production operations in small reviewed stages.

Payments, maps/location, third-party delivery, email/SMS, and cloud image storage remain provider-independent future integrations. No provider has been selected or connected. Obtain explicit owner approval before creating paid accounts, adding credentials, enabling a provider, or processing live customer data. Never store card data.

## Deployment and secrets

Deploy frontend and API independently. Production hosting and MongoDB provider selection, region, replica-set topology, backups, restore drills, monitoring, and access controls require owner review; no paid resources are created here. Keep all secrets in environment/deployment secret management, never in source control, browser bundles, logs, or prompts. The checked-in `.env.example` contains placeholders only.
