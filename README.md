# 🏦 Wallet API

A production-grade **Secure Wallet & Transaction Processing API** built with NestJS, MySQL, and TypeORM.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [API Endpoints](#api-endpoints)
4. [Race Condition Prevention](#1-race-condition-prevention)
5. [Idempotency Strategy](#2-idempotency-strategy)
6. [Locking Strategy](#3-locking-strategy-rationale)
7. [Injection Prevention](#4-injection-prevention)
8. [Production Changes](#5-what-would-change-in-production)
9. [Scaling Strategy](#6-scaling-the-system)
10. [1M Transactions/Day](#7-handling-1m-transactions-per-day)
11. [OWASP & BOLA Prevention](#8-bola--owasp-top-10-api-security)
12. [Running Tests](#running-tests)

---

## Quick Start

### With Docker (recommended)

```bash
# 1. Clone and configure
cp .env.example .env

# 2. Start all services (MySQL + Redis + App)
docker-compose up --build

# 3. Run migrations
docker-compose exec app npm run migration:run

# 4. API available at
http://localhost:3000/api/v1

# 5. Swagger docs
http://localhost:3000/api/docs
```

### Without Docker

```bash
# Prerequisites: MySQL 8.0 running locally

npm install

# Configure .env with your DB credentials
cp .env.example .env

# Run migrations
npm run migration:run

# Start dev server
npm run start:dev
```

---

## Architecture

```
src/
├── auth/                    # JWT auth, guards, strategies
│   ├── decorators/          # @Public()
│   ├── dto/                 # RegisterDto, LoginDto, RefreshTokenDto
│   ├── guards/              # JwtAuthGuard (applied globally)
│   ├── strategies/          # JwtStrategy (passport)
│   ├── tests/               # Unit tests
│   ├── auth.controller.ts
│   ├── auth.module.ts
│   └── auth.service.ts
├── users/
│   ├── entities/            # User entity
│   ├── users.repository.ts  # Data access layer
│   ├── users.service.ts     # Business logic
│   └── users.module.ts
├── wallet/
│   ├── dto/
│   ├── entities/            # Wallet entity
│   ├── tests/
│   ├── wallet.repository.ts # includes findByIdWithLock (SELECT FOR UPDATE)
│   ├── wallet.service.ts    # BOLA enforcement
│   ├── wallet.controller.ts
│   └── wallet.module.ts
├── transactions/
│   ├── dto/
│   ├── entities/            # Transaction entity
│   ├── tests/               # Concurrency + idempotency tests
│   ├── transactions.repository.ts
│   ├── transactions.service.ts  # ← CORE: atomic processing engine
│   ├── transactions.controller.ts
│   └── transactions.module.ts
├── common/
│   ├── decorators/          # @GetUser(), @Roles()
│   ├── dto/                 # PaginationDto
│   ├── filters/             # HttpExceptionFilter (global)
│   └── guards/              # RolesGuard
├── database/
│   ├── data-source.ts       # TypeORM CLI config
│   └── migrations/          # Versioned schema migrations
├── app.module.ts
└── main.ts
```

### Layered Architecture

| Layer | Responsibility | Rule |
|-------|---------------|------|
| **Controller** | HTTP in/out, route decorators | No business logic |
| **Service** | Business rules, orchestration | No direct DB access |
| **Repository** | Data access, query building | No business logic |
| **DTO** | Input validation & shaping | Whitelist-only (mass assignment protection) |
| **Entity** | DB schema definition | No methods |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | Public | Register user |
| POST | `/api/v1/auth/login` | Public | Login, get tokens |
| POST | `/api/v1/auth/refresh` | Public | Refresh access token |
| GET | `/api/v1/wallet` | User | Get own wallet balance |
| GET | `/api/v1/wallet/all` | Admin | List all wallets |
| POST | `/api/v1/transactions` | User | Process transaction |
| GET | `/api/v1/transactions` | User | Own transaction history |
| GET | `/api/v1/transactions/all` | Admin | All transactions |

---

## 1. Race Condition Prevention

**Problem:** Two concurrent debit requests of 100 each hit a wallet with balance 150.
Without locking, both read `150`, both compute `150 - 100 = 50`, and both write `50` — net loss of only 100, not 200. Or worse: both write simultaneously creating an inconsistent state.

**Solution: Pessimistic Row-Level Locking**

```typescript
// wallet.repository.ts
async findByIdWithLock(walletId: string, queryRunner: QueryRunner) {
  return queryRunner.manager
    .createQueryBuilder(Wallet, 'wallet')
    .setLock('pessimistic_write')   // → SELECT ... FOR UPDATE
    .where('wallet.id = :walletId', { walletId })
    .getOne();
}
```

**Execution flow for two concurrent requests:**

```
Time →

Request A:  START TX → LOCK ROW (acquired) → read 150 → write 50 → COMMIT → unlock
Request B:  START TX → LOCK ROW (blocked)  → ..................... → read 50 → 50 < 100 → FAIL → COMMIT
```

MySQL InnoDB's `SELECT FOR UPDATE` ensures:
- Request B physically cannot read the balance until Request A commits
- No phantom reads, no dirty reads
- One succeeds (balance → 50), one fails cleanly
- **No inconsistent state possible**

---

## 2. Idempotency Strategy

**How `idempotencyKey` is enforced:**

Every transaction request requires a unique `idempotencyKey` provided by the client (e.g., `"order-abc-20240101-attempt-1"`). This key has a `UNIQUE` constraint in the database.

```
POST /transactions
{
  "amount": 100,
  "type": "debit",
  "idempotencyKey": "order-xyz-001"
}
```

**Processing flow:**

```
1. Client sends request with idempotencyKey "order-xyz-001"
2. Inside DB transaction (before acquiring wallet lock):
   → SELECT * FROM transactions WHERE idempotencyKey = 'order-xyz-001'
3a. NOT FOUND → proceed to process, insert transaction record
3b. FOUND     → return original result immediately, DO NOT reprocess
```

**What happens if the server crashes mid-transaction?**

If the server crashes after inserting a `PENDING` transaction but before updating the wallet balance:
- The `QueryRunner.rollbackTransaction()` in the `catch` block reverts both the transaction row and any balance change atomically
- On restart, no `PENDING` record exists for that `idempotencyKey`
- The client can safely retry with the **same** `idempotencyKey` — the request will be processed as new
- For production, a background reconciliation job should scan for `PENDING` records older than 5 minutes and resolve them

**How replay attacks are prevented:**

- The `idempotencyKey` is checked **inside the row-level lock** to close the TOCTOU (time-of-check-time-of-use) window
- The unique DB constraint provides a final safety net — even if two identical keys slip through simultaneously, only one `INSERT` will succeed; the other gets a DB unique-constraint violation which is caught and rolled back
- Failed transactions are persisted with `status: failed` — retrying the same key returns the failure, not a retry

---

## 3. Locking Strategy Rationale

**Why Pessimistic Locking over Optimistic Locking?**

| Strategy | Mechanism | Best For | Risk |
|----------|-----------|----------|------|
| **Pessimistic** (chosen) | `SELECT FOR UPDATE` | High-contention financial ops | Throughput under extreme load |
| Optimistic | Version column + retry | Low-contention reads | Retry storms under load |
| Application-level | Redis `SETNX` | Distributed systems | Adds infra dependency |

Financial transactions demand **correctness over throughput**. Pessimistic locking guarantees:
- Zero retry storms (contending requests queue, not crash-loop)
- Predictable failure mode (clean FAILED transaction, not corrupted balance)
- Database-enforced — no risk of application bug bypassing the lock

**Why not `SERIALIZABLE` isolation?**

`SERIALIZABLE` is overly broad — it serializes all reads within the transaction, causing unnecessary lock contention on unrelated rows. We apply the lock surgically: only the specific wallet row is locked, for the minimum duration (the transaction window), releasing immediately on commit.

---

## 4. Injection Prevention

**Parameterized queries — zero raw SQL:**

TypeORM's QueryBuilder always uses parameterized queries:
```typescript
.where('wallet.id = :walletId', { walletId })  // → WHERE id = ?  (parameterized)
// NOT: .where(`wallet.id = '${walletId}'`)     // ← SQL injection risk
```

**Input validation at the boundary:**

All inputs are validated before reaching any service layer:
```typescript
// DTO validation with class-validator
@IsNumber({ maxDecimalPlaces: 2 })
@IsPositive()
amount: number;

@IsEnum(TransactionType)
type: TransactionType;

@MaxLength(512)
idempotencyKey: string;
```

**Global `ValidationPipe` with `whitelist: true`:**
```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,             // strips unknown properties
  forbidNonWhitelisted: true,  // throws on unexpected fields
  transform: true,
}));
```
This means even if a client sends `{ "balance": 9999999, "role": "admin" }`, those fields are stripped before the DTO reaches the service — **mass assignment is structurally impossible**.

---

## 5. What Would Change in Production

| Concern | Current (Dev) | Production |
|---------|--------------|-----------|
| Secrets | `.env` file | AWS Secrets Manager / Vault |
| Migrations | Manual `npm run migration:run` | CI/CD pipeline step |
| Logging | Console | Structured JSON → ELK / Datadog |
| Error details | Shown in dev | Hidden, stack traces never sent |
| DB password | `.env` | Rotated credentials via IAM |
| JWT secret | Static string | Rotated asymmetric RS256 keys |
| Rate limiting | In-process Throttler | API Gateway + Redis shared store |
| Admin seed | Migration | Dedicated secure onboarding flow |
| Refresh tokens | Stateless JWT | Stored in DB + Redis blacklist for revocation |
| HTTPS | None | TLS termination at load balancer |
| Health checks | None | `/health` endpoint for K8s liveness/readiness |

---

## 6. Scaling the System

**Horizontal API scaling:**

Since the API is stateless (JWT auth, no in-memory session), multiple instances can run behind a load balancer with zero coordination. Rate limiting must move to a **shared Redis store** so limits are enforced across all instances.

**Database scaling path:**

```
Phase 1: Single MySQL primary (current)
Phase 2: Primary + Read Replica — route GET queries to replica
Phase 3: PlanetScale / Vitess — transparent horizontal sharding
Phase 4: Shard by userId hash for true horizontal write scale
```

**Connection pooling:**

Each API instance uses a connection pool (configured in `app.module.ts`). With 3 instances × 20 connections = 60 total connections — MySQL handles this comfortably. Use **ProxySQL** or **RDS Proxy** to manage connection fan-out at scale.

**Caching:**

- Wallet balance: Cache with Redis, short TTL (1–5s), invalidate on every transaction commit
- Transaction history: Cache paginated results, invalidate on new transaction

---

## 7. Handling 1M Transactions Per Day

1M/day = ~11.6 TPS average, ~50–100 TPS at peak (10× multiplier).

**Database:**
- `DECIMAL(18,2)` with proper indexes handles this comfortably on a single MySQL instance
- The `IDX_TRANSACTION_WALLET_CREATED` composite index ensures wallet history queries are O(log n), not O(n)
- Partition the `transactions` table by month (`PARTITION BY RANGE` on `createdAt`) to keep active partitions small

**Async processing (optional upgrade path):**

For burst handling, introduce a queue:
```
Client → POST /transactions → enqueue job → return { status: pending, reference }
Worker → dequeue → process atomically → update status
Client → GET /transactions/:ref → poll for result
```

This decouples HTTP response time from DB lock contention.

**Archive strategy:**

Move transactions older than 90 days to a cold-storage table or data warehouse (BigQuery / Redshift) to keep the hot table under 50M rows.

---

## 8. BOLA & OWASP Top 10 API Security

### API1 — Broken Object Level Authorization (BOLA)

The most critical API vulnerability. Our mitigation:

```typescript
// wallet.service.ts — enforced in every wallet access
async getWallet(requestingUser: User, targetUserId?: string) {
  const userId = targetUserId ?? requestingUser.id;

  // BOLA check: non-admin users CANNOT access other users' wallets
  if (requestingUser.role !== UserRole.ADMIN && userId !== requestingUser.id) {
    throw new ForbiddenException('Access denied');
  }
  // ...
}
```

Users **never supply their walletId** in the transaction request — the wallet is always resolved server-side from the authenticated JWT. A malicious user cannot craft a request targeting another user's wallet.

### API2 — Broken Authentication

- Argon2id password hashing (memory-hard, GPU-resistant)
- Constant-time comparison (prevents timing attacks)
- JWT with short expiry (15 min access, 7 day refresh)
- Generic error messages (`"Invalid email or password"`, never `"Email not found"`)

### API3 — Broken Object Property Level Authorization (Mass Assignment)

- `whitelist: true` on `ValidationPipe` strips all undeclared DTO properties
- `role` is never accepted from client input — always set server-side
- `balance` can never be set by a client request — only modified by the transaction engine

### API4 — Unrestricted Resource Consumption

- `@Throttle()` on auth endpoints (5 req/min) and transaction endpoints (20 req/min)
- Pagination enforced on all list endpoints (`MAX 100` per page)
- Input length limits on all string fields

### API5 — Broken Function Level Authorization

- `JwtAuthGuard` applied **globally** — all routes protected by default
- `@Public()` must be explicitly added to opt out
- `RolesGuard` + `@Roles(UserRole.ADMIN)` on admin-only endpoints

### API6 — Unrestricted Access to Sensitive Business Flows

- Idempotency prevents double-spend attacks
- Row-level locking prevents race conditions
- Amount must be `> 0` and have `≤ 2 decimal places`

### API7 — Server Side Request Forgery (SSRF)

No outbound HTTP calls from this service. Not applicable.

### API8 — Security Misconfiguration

- `synchronize: false` in TypeORM — schema changes only via migrations
- Stack traces never sent to clients in production
- Password field has `select: false` — never returned in default queries

### API9 — Improper Inventory Management

- Swagger docs only available in non-production environments
- All routes versioned under `/api/v1`

### API10 — Unsafe Consumption of APIs

No third-party API consumption. Not applicable.

---

## Running Tests

```bash
# Unit tests
npm run test

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

### Test Coverage

| Test | File | What it verifies |
|------|------|-----------------|
| Concurrent debit | `transactions.service.spec.ts` | First succeeds, second fails, balance = 50 |
| Idempotency | `transactions.service.spec.ts` | Duplicate key returns original, no reprocess |
| Negative balance | `transactions.service.spec.ts` | Debit > balance → FAILED status |
| Exact balance | `transactions.service.spec.ts` | Debit = balance → SUCCESS (boundary) |
| Auth guard | `jwt-auth.guard.spec.ts` | Public routes pass, protected routes require JWT |
| BOLA | `wallet.service.spec.ts` | User B cannot access User A's wallet |
| Admin access | `wallet.service.spec.ts` | Admin can access any wallet |
| Mass assignment | `auth.service.spec.ts` | Role always forced to USER on register |
| Rollback on error | `transactions.service.spec.ts` | DB error → rollback + release pool connection |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | HTTP port |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USERNAME` | `wallet_user` | MySQL user |
| `DB_PASSWORD` | `wallet_password` | MySQL password |
| `DB_NAME` | `wallet_db` | Database name |
| `JWT_SECRET` | — | Access token secret (min 32 chars) |
| `JWT_EXPIRES_IN` | `15m` | Access token expiry |
| `JWT_REFRESH_SECRET` | — | Refresh token secret (min 32 chars) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token expiry |
