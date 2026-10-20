# ChatHub — 1:1 Chat Backend

> **High-Performance 1:1 Chat Backend built with NestJS, PostgreSQL, Prisma ORM, and Firebase Firestore.**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture & Data Ownership](#architecture--data-ownership)
- [Tech Stack & Dependency Versions](#tech-stack--dependency-versions)
- [Firestore Data Model](#firestore-data-model)
- [Key Architectural Guarantees](#key-architectural-guarantees)
  - [1. Concurrency & Duplicate Chat Prevention](#1-concurrency--duplicate-chat-prevention)
  - [2. Relational Chat Membership as Source of Truth](#2-relational-chat-membership-as-source-of-truth)
  - [3. Backwards-Movement Prevention in Last-Seen Tracking](#3-backwards-movement-prevention-in-last-seen-tracking)
  - [4. Idempotent Read Receipts](#4-idempotent-read-receipts)
- [API Documentation](#api-documentation)
- [Interactive Swagger / OpenAPI](#interactive-swagger--openapi)
- [Prerequisites & Environment Setup](#prerequisites--environment-setup)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Security & Production Considerations](#security--production-considerations)

---

## 🚀 Overview

ChatHub is a production-grade 1:1 chat backend service designed for high throughput, strict relational consistency, and real-time message streams. It employs a **hybrid storage architecture**:
- **PostgreSQL**: Manages users, chat rooms, and relational memberships using ACID transactions and unique constraints.
- **Firebase Firestore**: Stores high-velocity message streams, per-message read receipts, and last-seen pointers with server-generated timestamps.

---

## 🏛️ Architecture & Data Ownership

```
                       +-----------------------------------+
                       |         Client Request            |
                       +-----------------+-----------------+
                                         |
                                         v
                       +-----------------+-----------------+
                       |     NestJS Application Layer      |
                       |  - ValidationPipe (whitelist)     |
                       |  - HttpExceptionFilter            |
                       |  - Swagger OpenAPI (/api/docs)    |
                       +--------+------------------+-------+
                                |                  |
          Relational Auth & Data|                  |Message Persistence
                                v                  v
             +-----------------------+   +-----------------------+
             |    PostgreSQL 16      |   |   Firebase Firestore  |
             |-----------------------|   |-----------------------|
             | - users               |   | - messages            |
             | - chats               |   | - readReceipts        |
             | - chat_members        |   | - lastSeen            |
             +-----------------------+   +-----------------------+
```

| Data Domain | Storage Engine | Responsibility & Reason |
| :--- | :--- | :--- |
| **Users** | PostgreSQL | Identity records, email uniqueness, relational foreign keys. |
| **Chats** | PostgreSQL | 1:1 Chat entities, canonical unique constraints (`@@unique([user1Id, user2Id])`). |
| **Chat Membership** | PostgreSQL | **Source of truth** for authorization. Cascade deletes, indexed membership queries. |
| **Messages** | Firebase Firestore | NoSQL document storage scoped under `chats/{chatId}/messages`. Scalable writes. |
| **Read Receipts** | Firebase Firestore | Idempotent per-user receipts at `.../messages/{msgId}/readReceipts/{userId}`. |
| **Last-Seen Tracking** | Firebase Firestore | Monotonic high-water mark pointer at `chats/{chatId}/lastSeen/{userId}`. |

---

## 🛠️ Tech Stack & Dependency Versions

| Component | Technology | Version |
| :--- | :--- | :--- |
| **Runtime** | Node.js (LTS) | `v20+` / `v24+` |
| **Framework** | NestJS | `^10.4.15` |
| **Language** | TypeScript (Strict Mode) | `^5.7.3` |
| **Database** | PostgreSQL | `16-alpine` |
| **ORM** | Prisma ORM | `^6.4.1` |
| **Realtime Storage**| Firebase Admin SDK | `^13.1.0` |
| **Validation** | class-validator & class-transformer | `^0.14.1` / `^0.5.1` |
| **Documentation** | Swagger / OpenAPI | `@nestjs/swagger ^7.4.2` |
| **Testing** | Jest & Supertest | `^29.7.0` / `^7.0.0` |
| **Code Quality** | ESLint 9 (Flat Config) & Prettier | `^9.18.0` / `^3.4.2` |

---

## 📂 Firestore Data Model

```
chats/{chatId}/
  │
  ├── messages/{messageId}
  │     ├── senderId: string
  │     ├── text: string
  │     ├── createdAt: ServerTimestamp
  │     │
  │     └── readReceipts/{userId}
  │           ├── userId: string
  │           └── readAt: ServerTimestamp
  │
  └── lastSeen/{userId}
        ├── messageId: string
        └── updatedAt: ServerTimestamp
```

### Firestore Design Trade-offs
1. **Subcollection Scoping**: Messages are naturally scoped under `chats/{chatId}/messages`. Cross-chat data leaks are impossible at the path level.
2. **Stable Document IDs**: Using `userId` as the document ID for both `readReceipts/{userId}` and `lastSeen/{userId}` guarantees:
   - $O(1)$ direct document access without costly query scans.
   - Built-in idempotency (duplicate network retries cannot produce duplicate documents).
3. **Atomic Timestamps**: All write timestamps use `FieldValue.serverTimestamp()`, eliminating client clock skew and timezone discrepancies.

---

## 🛡️ Key Architectural Guarantees

### 1. Concurrency & Duplicate Chat Prevention
- **Canonical Ordering**: For any two user IDs $A$ and $B$, the system computes:
  $$\text{user1Id} = \min(A, B), \quad \text{user2Id} = \max(A, B)$$
- **Database Constraint**: `Chat` table enforces `@@unique([user1Id, user2Id])`.
- **Atomic Creation**: Chat creation and membership insertion run inside a PostgreSQL `$transaction`.
- **P2002 Conflict Resolution**: If two concurrent requests hit `POST /chat/create` simultaneously, one commits while the other catches the unique constraint violation (`P2002`) and returns the winner chat ID seamlessly.

### 2. Relational Chat Membership as Source of Truth
- Every protected operation (`POST .../message/send`, `GET .../messages`, `POST .../read`, `POST .../lastseen`) verifies caller membership against PostgreSQL `chat_members`.
- Non-members are rejected immediately with `403 Forbidden` before any Firestore interaction occurs.

### 3. Backwards-Movement Prevention in Last-Seen Tracking
- Inside a Firestore `runTransaction` (Optimistic Concurrency Control), the target message's `createdAt` timestamp is compared against the user's current last-seen message timestamp.
- If an older message ID is submitted ($T_{\text{target}} < T_{\text{current}}$), the request is rejected with `400 Bad Request: Cannot move last-seen message backwards in time`.

### 4. Idempotent Read Receipts
- When `POST /chat/:chatId/message/:messageId/read` is invoked repeatedly, the existing read receipt is returned without creating duplicate records and without overwriting the initial `readAt` timestamp.

---

## 📡 API Documentation

### 1. Create or Get Chat
- **Route**: `POST /api/chat/create`
- **Request Body**:
  ```json
  {
    "userAId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "userBId": "05044ae6-ed94-405c-9416-36340b4842a6"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c"
  }
  ```

### 2. Send Message
- **Route**: `POST /api/chat/:chatId/message/send`
- **Request Body**:
  ```json
  {
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "text": "Hello, how are you?"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "msg-123456",
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "text": "Hello, how are you?",
    "createdAt": "2026-10-20T14:30:00.000Z"
  }
  ```

### 3. Get Messages
- **Route**: `GET /api/chat/:chatId/messages?limit=50&cursor=msg-123`
- **Header (Optional)**: `x-user-id: <callerUserId>`
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
    "messages": [
      {
        "id": "msg-123",
        "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
        "text": "Hello, how are you?",
        "createdAt": "2026-10-20T14:30:00.000Z"
      }
    ],
    "pagination": {
      "limit": 50,
      "nextCursor": "msg-123"
    }
  }
  ```

### 4. Mark Message Read
- **Route**: `POST /api/chat/:chatId/message/:messageId/read`
- **Request Body**:
  ```json
  {
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
    "messageId": "msg-123",
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
    "readAt": "2026-10-20T14:31:00.000Z",
    "isNew": true
  }
  ```

### 5. Update Last Seen Message
- **Route**: `POST /api/chat/:chatId/lastseen`
- **Request Body**:
  ```json
  {
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
    "messageId": "msg-123"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
    "messageId": "msg-123",
    "updatedAt": "2026-10-20T14:32:00.000Z"
  }
  ```

### 6. List User Chats
- **Route**: `GET /api/user/:userId/chats`
- **Response (`200 OK`)**:
  ```json
  {
    "userId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "chats": [
      {
        "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
        "memberIds": [
          "78a15aac-0d92-4ca9-ab67-70a78b569581",
          "05044ae6-ed94-405c-9416-36340b4842a6"
        ],
        "createdAt": "2026-10-20T13:45:00.000Z",
        "updatedAt": "2026-10-20T13:45:00.000Z"
      }
    ],
    "totalCount": 1
  }
  ```

---

## 📖 Interactive Swagger / OpenAPI

Start the application and visit the Swagger UI in your browser:
```
http://localhost:3000/api/docs
```
Swagger UI provides interactive request execution, DTO schemas, and detailed error response specifications.

---

## ⚙️ Prerequisites & Environment Setup

1. **Node.js**: `v20.x` or `v24.x`
2. **Docker & Docker Compose**: Installed and running
3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   ```

### Environment Configuration (`.env`)
```env
NODE_ENV=development
PORT=3000
GLOBAL_PREFIX=api

# PostgreSQL connection string
DATABASE_URL="postgresql://chathub_user:chathub_password@localhost:5433/chathub_db?schema=public"

# Firebase Admin SDK Configuration
FIREBASE_PROJECT_ID="chathub-assessment"
FIREBASE_SERVICE_ACCOUNT_PATH=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""
# FIRESTORE_EMULATOR_HOST="localhost:8080"
```

---

## 🏃 Getting Started

### 1. Start PostgreSQL with Docker Compose
```bash
docker compose up -d
```
Verifies PostgreSQL is healthy on host port `5433`.

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Prisma Migrations & Seed Database
```bash
npm run prisma:migrate
npm run prisma:seed
```

### 4. Start Application in Development Mode
```bash
npm run start:dev
```
Application will be available at `http://localhost:3000/api`.

---

## 🧪 Testing

### Run All Unit Tests
```bash
npm run test
```
*Executes all 41 unit tests across 7 test suites.*

### Run End-to-End (E2E) Integration Tests
```bash
npm run test:e2e
```
*Executes 15 comprehensive E2E tests validating PostgreSQL transactions, Firestore constraints, status codes, and idempotency.*

### Code Quality & Formatting
```bash
npm run format
npm run lint
```

---

## 🔒 Security & Production Considerations

1. **Authentication in Production**:
   - For technical assessment evaluation, endpoints receive user IDs via request body/params.
   - In production, user identity must be extracted strictly from a cryptographically signed JWT or verified session (`req.user.id`).
2. **Mass Assignment Protection**:
   - `ValidationPipe` is globally configured with `whitelist: true` and `forbidNonWhitelisted: true`. Unknown fields are rejected with `400 Bad Request`.
3. **Secrets Hygiene**:
   - `.env`, `.pem`, and service account JSON credentials are completely excluded by `.gitignore`.
4. **Graceful Shutdown**:
   - `app.enableShutdownHooks()` ensures database connection pools and background sockets terminate cleanly on container teardown (`SIGTERM`/`SIGINT`).

