# Fresh Prawns Online

Fresh Prawns Online is a customer storefront and owner dashboard for a single-owner prawn shop serving Hyderabad. The application is split into independently runnable frontend and backend services in this repository. The storefront reads the public product catalogue, current daily prices, and available stock through REST; cart, checkout, tracking, and order operations remain demonstrations.

## Current project stack

- **Frontend:** React, JavaScript/JSX today, Vite, Tailwind CSS, React Router. TypeScript, TanStack Query, React Hook Form/Zod, and React Testing Library are target frontend choices to adopt in later reviewed work; they are not all implemented yet.
- **Backend:** Node.js/TypeScript, Express, MongoDB/Mongoose, Zod configuration validation, structured Pino request logging, Helmet, CORS allowlist, and Express rate limits.
- **Backend APIs:** process and MongoDB readiness at `GET /health`; OpenAPI JSON at `GET /openapi.json`; public catalogue endpoints at `GET /api/v1/products` and `GET /api/v1/products/:slug`, including current price in integer paise, cleaned/uncleaned options, and stock/available weight in integer grams.
- **Database:** MongoDB is the only application database. Local development uses Docker Compose. Frontend and backend are independently started and built.

## Phase 1 frontend

The Phase 1 storefront presentation is preserved. Product, current price, preparation options, and availability are API-backed; the following remain mock/local demonstrations:

- Responsive homepage, catalogue, product details, cleaned/uncleaned choice, weight and quantity selection, cart, checkout UI, address/location placeholder, tracking, and support/contact section.
- Admin demo at `/admin` for API-backed read-only products/prices/stock and sample order, delivery, and sales views. Product and inventory editing is disabled until authenticated write APIs are added.
- Routes: `/`, `/shop`, `/product/:id`, `/cart`, `/checkout`, `/track`, and `/admin`.
- Sample orders, cart pricing, checkout, tracking, and dashboard order metrics still use mock/local data. No order placement, stock reservation, login, payments, maps, notifications, or delivery requests are made.

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

The Vite development server proxies `/api` requests to the local API. For separately hosted services, set `VITE_API_BASE_URL` to the API origin at frontend build time and add the frontend origin to the API's `CORS_ORIGINS`. The API reads the root `.env` using Node's `--env-file` option. `MONGODB_URI`, `HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX` are validated with Zod before startup.

### Load clearly labeled sample catalogue data

The database starts empty. After starting MongoDB and installing dependencies, run the explicit development-only seed command to load four sample products, today's sample prices, and stock weights:

```powershell
npm --prefix server run seed:sample
```

The command runs only when `NODE_ENV=development` and `MONGODB_URI` points to a local host. Seeded products are marked as sample data; do not treat their prices or quantities as real shop inventory. Re-running the command refreshes the same sample products, today's sample prices, and stock values.

### Public catalogue API

- `GET /api/v1/products` — active products enriched with the currently effective daily price, enabled preparation options, and stock in grams. Optional validated filters: `?size=Small|Medium|Large` and `?preparation=cleaned|uncleaned`.
- `GET /api/v1/products/:slug` — one active product with the same price and availability fields.
- Prices are integer paise per kg (`pricePerKgPaise`); stock quantities are integer grams (`stock.onHandGrams`, `stock.availableGrams`). A product with no current price returns `pricePerKgPaise: null`; missing stock is reported as zero available grams.
- Invalid filters/slugs return a structured `400`; unknown or inactive products return `404`; MongoDB unavailability returns `503`.

These are public read endpoints only. No API in this stage can create or modify products, prices, or stock. Admin product/price/stock controls are read-only until authentication, role authorization, and validated write endpoints are implemented.

## Checks

```powershell
npm run build
npm run lint
npm --prefix server run lint
npm run test:api
npm run typecheck:api
npm run build:api
```

API tests use Supertest and injected catalogue repositories, so focused unit/API validation runs without connecting to a real database. For database-backed local development, start Compose first.

## Backend foundation boundaries

The API includes environment validation, MongoDB connection lifecycle, startup index initialization, health/OpenAPI endpoints, request IDs, structured request logs with sensitive headers redacted, secure headers, allowlisted CORS, request rate limiting, JSON size limits, centralized safe errors, and public product/pricing/stock reads. Zod validates API filters and slugs; Mongoose schemas validate stored product, price, preparation fee, and stock values. Schemas and endpoints are grouped by business area under `server/src/modules/`.

Product catalogue, daily pricing, and available stock can be read by the storefront. Admin mutations, authentication, customer/admin authorization middleware, cart persistence, checkout, stock reservations, and tracking APIs are not implemented. Do not treat sample data or demo order flows as ready for real customer transactions.

## MongoDB consistency

The Compose database is a standalone MongoDB instance, which does not support multi-document transactions. Later order and stock work must not assume transaction support:

- Prefer conditional atomic updates on a single product stock document for each reservation.
- Use idempotency keys, durable reservation/order states, compensation on partial failure, and a recovery/reconciliation process.
- Do not confirm an order until every required item reservation and order write is finalized.
- If business requirements need atomic multi-document order/stock writes, use and test a replica-set-capable MongoDB deployment; that topology decision must be made before implementation.

## Phase boundaries and future integrations

1. **Phase 1:** Frontend mock-data UI, preserved as-is.
2. **Phase 2:** Planning and architecture, including owner decisions and consistency/security review.
3. **Phase 3:** Backend foundation and MongoDB connection, now implemented as described above.
4. **Current feature stage:** Public product, current daily-price, and stock-availability reads; storefront integration; admin writes intentionally deferred until authenticated admin access is available.
5. **Later phases:** Authentication/admin roles, product/pricing/stock management, cart/order/checkout APIs, and delivery assignment in small reviewed slices. Integrate each frontend workflow only when its API is approved and tested.

Payments, maps/location, third-party delivery, email/SMS, and cloud image storage remain provider-independent future integrations. No provider has been selected or connected. Obtain explicit owner approval before creating paid accounts, adding credentials, enabling a provider, or processing live customer data. Never store card data.

## Deployment and secrets

Deploy frontend and API independently. Production hosting and MongoDB provider selection, region, replica-set topology, backups, restore drills, monitoring, and access controls require owner review; no paid resources are created here. Keep all secrets in environment/deployment secret management, never in source control, browser bundles, logs, or prompts. The checked-in `.env.example` contains placeholders only.
