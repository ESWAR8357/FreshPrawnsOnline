# Fresh Prawns Online

Fresh Prawns Online is a customer storefront and owner dashboard for a single-owner prawn shop serving Hyderabad. The application is split into independently runnable frontend and backend services in this repository. REST integration between them is planned for a later phase.

## Current project stack

- **Frontend:** React, JavaScript/JSX today, Vite, Tailwind CSS, React Router. TypeScript, TanStack Query, React Hook Form/Zod, and React Testing Library are target frontend choices to adopt in later reviewed work; they are not all implemented yet.
- **Backend:** Node.js/TypeScript, Express, MongoDB/Mongoose, Zod configuration validation, structured Pino request logging, Helmet, CORS allowlist, and Express rate limits.
- **Backend API foundation:** process and MongoDB readiness at `GET /health`; initial OpenAPI JSON at `GET /openapi.json`; modular Mongoose models and indexes for users, products, daily prices, stock/movements, order snapshots, and delivery assignments.
- **Database:** MongoDB is the only application database. Local development uses Docker Compose. Frontend and backend are independently started and built.

## Phase 1 frontend

The existing Phase 1 UI is preserved and remains a frontend-only prototype using mock data and local React state:

- Responsive homepage, catalogue, product details, cleaned/uncleaned choice, weight and quantity selection, cart, checkout UI, address/location placeholder, tracking, and support/contact section.
- Admin demo at `/admin` for sample daily prices, stock by weight, orders, delivery method/assignment, product controls, and sales overview.
- Routes: `/`, `/shop`, `/product/:id`, `/cart`, `/checkout`, `/track`, and `/admin`.
- The frontend does not use the backend yet. No real orders, inventory reservations, login, payments, maps, notifications, or delivery requests are made.

## Local setup

### Prerequisites

- Node.js 22 or newer and npm.
- Docker Desktop with Docker Compose for the local MongoDB container.

### Configure MongoDB

1. Copy the safe placeholder template and edit it for local development:

   ```powershell
   Copy-Item .env.example .env
   ```

2. In `.env`, replace `replace-local-password` in both MongoDB settings with the same local-only password. Do not commit `.env`; never put real or production secrets in the example file.
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

The API reads the root `.env` using Node's `--env-file` option. `MONGODB_URI`, `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX` are validated with Zod before startup.

## Checks

```powershell
npm run build
npm run lint
npm run test:api
npm run typecheck:api
npm run build:api
```

API tests use Supertest and an injected MongoDB health state, so the focused unit/API suite can run without connecting to a real database. For database-backed local development, start Compose first.

## Backend foundation boundaries

The API foundation includes environment validation, MongoDB connection lifecycle, startup index initialization, health/OpenAPI foundation, request IDs, structured request logs with sensitive headers redacted, secure headers, allowlisted CORS, request rate limiting, JSON size limits, and centralized safe errors. Mongoose schema/index foundations are grouped by business area under `server/src/modules/`.

No product/pricing/stock/order business API, authentication flow, customer/admin authorization middleware, cart persistence, checkout, or tracking API is implemented yet. The initial models are schema foundations only. Do not treat them as ready for production traffic or actual customer data.

## MongoDB consistency

The Compose database is a standalone MongoDB instance, which does not support multi-document transactions. Later order and stock work must not assume transaction support:

- Prefer conditional atomic updates on a single product stock document for each reservation.
- Use idempotency keys, durable reservation/order states, compensation on partial failure, and a recovery/reconciliation process.
- Do not confirm an order until every required item reservation and order write is finalized.
- If business requirements need atomic multi-document order/stock writes, use and test a replica-set-capable MongoDB deployment; that topology decision must be made before implementation.

## Phase boundaries and future integrations

1. **Phase 1:** Frontend mock-data UI, preserved as-is.
2. **Phase 2:** Planning and architecture, including owner decisions and consistency/security review.
3. **Phase 3:** Backend foundation and MongoDB connection, now implemented as described above; the frontend stays on mocks.
4. **Later phases:** Add products/pricing/stock APIs, authentication/admin roles, carts/orders/checkout, and delivery assignment in small reviewed slices. Integrate the frontend only when those APIs are approved and tested.

Payments, maps/location, third-party delivery, email/SMS, and cloud image storage remain provider-independent future integrations. No provider has been selected or connected. Obtain explicit owner approval before creating paid accounts, adding credentials, enabling a provider, or processing live customer data. Never store card data.

## Deployment and secrets

Deploy frontend and API independently. Production hosting and MongoDB provider selection, region, replica-set topology, backups, restore drills, monitoring, and access controls require owner review; no paid resources are created here. Keep all secrets in environment/deployment secret management, never in source control, browser bundles, logs, or prompts. The checked-in `.env.example` contains placeholders only.
