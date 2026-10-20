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
  - [5. Group Chat Relational Integrity & Role Governance](#5-group-chat-relational-integrity--role-governance-milestone-10)
  - [6. Message Immutability, Soft Deletion & Concurrency Control](#6-message-immutability-soft-deletion--concurrency-control-milestone-11)
- [API Documentation](#api-documentation)
  - [1:1 Direct Chat APIs](#11-direct-chat-apis)
  - [Group Chat Management APIs (Milestone 10)](#group-chat-management-apis-milestone-10)
  - [Message Edit & Delete APIs (Milestone 11)](#message-edit--delete-apis-milestone-11)
- [Interactive Swagger / OpenAPI](#interactive-swagger--openapi)
- [Prerequisites & Environment Setup](#prerequisites--environment-setup)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Code Quality, Linting & Formatting](#-code-quality-linting--formatting)
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
| **Chats** | PostgreSQL | 1:1 & Group Chat entities (`ChatType: DIRECT | GROUP`), canonical unique constraints for 1:1 (`@@unique([user1Id, user2Id])`). |
| **Chat Membership** | PostgreSQL | **Source of truth** for authorization. Roles (`ADMIN` vs `MEMBER`), cascade deletes, indexed membership queries. |
| **Messages** | Firebase Firestore | NoSQL document storage scoped under `chats/{chatId}/messages`. Scalable writes. |
| **Read Receipts** | Firebase Firestore | Idempotent per-user receipts at `.../messages/{msgId}/readReceipts/{userId}`. |
| **Last-Seen Tracking** | Firebase Firestore | Monotonic high-water mark pointer at `chats/{chatId}/lastSeen/{userId}`. |

---

## 🛠️ Tech Stack & Dependency Versions

| Component | Technology | Version |
| :--- | :--- | :--- |
| **Runtime** | Node.js | Node.js 22 or newer, using a currently supported release |
| **Framework** | NestJS | `^10.4.15` |
| **Language** | TypeScript (Strict Mode) | `^5.7.3` |
| **Database** | PostgreSQL | `16-alpine` |
| **ORM** | Prisma ORM | `^6.4.1` |
| **Realtime Storage**| Firebase Admin SDK | `^14.5.0` |
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
  │     ├── text: string (cleared to "" if isDeleted is true)
  │     ├── createdAt: ServerTimestamp
  │     ├── editedAt: ServerTimestamp | null (optional)
  │     ├── isDeleted: boolean (defaults to false if omitted)
  │     ├── deletedAt: ServerTimestamp | null (optional)
  │     │
  │     └── readReceipts/{userId}
  │           ├── userId: string
  │           └── readAt: ServerTimestamp
  │
  └── lastSeen/{userId}
        ├── messageId: string
        └── updatedAt: ServerTimestamp
```

### Firestore Design Trade-offs & Backward Compatibility
1. **Subcollection Scoping**: Messages are naturally scoped under `chats/{chatId}/messages`. Cross-chat data leaks are impossible at the path level.
2. **Stable Document IDs**: Using `userId` as the document ID for both `readReceipts/{userId}` and `lastSeen/{userId}` guarantees:
   - $O(1)$ direct document access without costly query scans.
   - Built-in idempotency (duplicate network retries cannot produce duplicate documents).
3. **Atomic Timestamps**: All write timestamps use `FieldValue.serverTimestamp()`, eliminating client clock skew and timezone discrepancies.
4. **Backward-Compatible Schema Evolution**: Older messages created prior to Milestone 11 lack `editedAt`, `isDeleted`, and `deletedAt`. In the application layer, these fields default cleanly to `editedAt: null`, `isDeleted: false`, and `deletedAt: null`, ensuring zero migration downtime and 100% backward compatibility.

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

### 5. Group Chat Relational Integrity & Role Governance (Milestone 10)
- **Atomic Creation**: Group entity and initial members are written inside a single PostgreSQL `$transaction`.
- **Role-Based Governance**: Only members with `role: ADMIN` can add or remove other participants (`403 Forbidden` for regular members).
- **Last Administrator Guard**: Prevents removing or abandoning a group by the last administrator while other members remain (`400 Bad Request`), preventing orphaned groups.
- **PostgreSQL as Source of Truth**: All group metadata and memberships reside in PostgreSQL, ensuring ACID consistency, indexed membership queries, and complete compatibility with existing Firestore message streams.

### 6. Message Immutability, Soft Deletion & Concurrency Control (Milestone 11)
- **Author-Only Permissions**: Only the original message sender (`senderId === authorId`) can edit or delete their message.
- **Relational Membership Enforcement**: The actor must be an authorized member in the PostgreSQL conversation before any Firestore read/write can occur (`403 Forbidden`).
- **Atomic Concurrency via Firestore Transactions**: Edit and delete operations run inside a Firestore transaction (`runTransaction`), preventing race conditions, lost updates, or reviving already deleted messages.
- **Soft-Delete Strategy & Privacy**: When a message is deleted, its sensitive text content is cleared from storage (`text: ""`) while message ID and timestamps remain intact. This preserves chronological timeline order, cursor-based pagination continuity, and read receipt linkages without leaking deleted content to client devices.

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
        "type": "DIRECT",
        "name": null,
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

### Group Chat Management APIs (Milestone 10)

#### 7. Create Group Chat
- **Route**: `POST /api/chat/group/create`
- **Request Body**:
  ```json
  {
    "name": "Backend Engineering Team",
    "creatorId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "memberIds": [
      "05044ae6-ed94-405c-9416-36340b4842a6",
      "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    ]
  }
  ```
- **Rules**:
  - Validates group name (1–100 chars, non-blank).
  - Enforces min 2 distinct members and max 100 members.
  - Automatically deduplicates member IDs and assigns the creator the `ADMIN` role.
  - Validates that all requested users exist in PostgreSQL.
  - Creates the group entity and members inside an atomic PostgreSQL transaction.
- **Response (`201 Created`)**:
  ```json
  {
    "chatId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Backend Engineering Team",
    "type": "GROUP",
    "creatorId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "members": [
      {
        "userId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
        "role": "ADMIN"
      },
      {
        "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
        "role": "MEMBER"
      },
      {
        "userId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "role": "MEMBER"
      }
    ],
    "createdAt": "2026-10-21T00:00:00.000Z"
  }
  ```

#### 8. Get Group Details & Members
- **Route**: `GET /api/chat/group/:chatId?userId=<callerUserId>`
- **Header (Alternative)**: `x-user-id: <callerUserId>`
- **Rules**:
  - Verifies that the group exists and is of type `GROUP`.
  - Authorizes caller: User must be an existing group member to view group details (`403 Forbidden` if unauthorized).
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Backend Engineering Team",
    "type": "GROUP",
    "creatorId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "members": [
      {
        "userId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
        "name": "Alice",
        "email": "alice@example.com",
        "role": "ADMIN",
        "joinedAt": "2026-10-21T00:00:00.000Z"
      },
      {
        "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
        "name": "Bob",
        "email": "bob@example.com",
        "role": "MEMBER",
        "joinedAt": "2026-10-21T00:00:00.000Z"
      }
    ],
    "memberCount": 2,
    "createdAt": "2026-10-21T00:00:00.000Z",
    "updatedAt": "2026-10-21T00:00:00.000Z"
  }
  ```

#### 9. Add Member to Group
- **Route**: `POST /api/chat/group/:chatId/members`
- **Request Body**:
  ```json
  {
    "actingUserId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "userId": "e4b2d398-3561-4bb2-b60f-f4c6e9491745",
    "role": "MEMBER"
  }
  ```
- **Rules**:
  - `actingUserId` must be an `ADMIN` in the group (`403 Forbidden` if regular member or non-member).
  - Target user must exist in PostgreSQL (`404 Not Found`).
  - Rejects duplicate addition if user is already a member (`409 Conflict`).
  - Enforces group maximum capacity of 100 members (`400 Bad Request`).
- **Response (`201 Created`)**:
  ```json
  {
    "chatId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "userId": "e4b2d398-3561-4bb2-b60f-f4c6e9491745",
    "role": "MEMBER",
    "joinedAt": "2026-10-21T00:05:00.000Z"
  }
  ```

#### 10. Remove Member from Group
- **Route**: `DELETE /api/chat/group/:chatId/members/:userId?actingUserId=<adminUserId>`
- **Header (Alternative)**: `x-user-id: <adminUserId>`
- **Rules**:
  - `actingUserId` must be an `ADMIN` in the group (`403 Forbidden` if not admin).
  - Target user must be a member of the group (`404 Not Found` if not in group).
  - **Last Administrator Guard**: Prevents removing the last administrator of the group (`400 Bad Request`). Another admin must be designated first.
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "userId": "e4b2d398-3561-4bb2-b60f-f4c6e9491745",
    "removed": true
  }
  ```

#### 11. Leave Group
- **Route**: `POST /api/chat/group/:chatId/leave`
- **Request Body**:
  ```json
  {
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6"
  }
  ```
- **Rules**:
  - User must be an existing group member (`403 Forbidden`).
  - **Last Administrator Guard**: If the leaving user is the last `ADMIN` and other members remain, departure is blocked (`400 Bad Request`). An admin role must be transferred to another member before leaving.
- **Response (`200 OK`)**:
  ```json
  {
    "chatId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "userId": "05044ae6-ed94-405c-9416-36340b4842a6",
    "left": true
  }
  ```

---

### Message Edit & Delete APIs (Milestone 11)

#### 12. Edit Message
- **Route**: `PATCH /api/chat/:chatId/message/:messageId`
- **Request Body**:
  ```json
  {
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "text": "Hello squad, this is my updated message!"
  }
  ```
- **Rules**:
  - `senderId` must be the original author of the message (`403 Forbidden` if another user attempts edit).
  - Acting sender must be a member of the conversation in PostgreSQL (`403 Forbidden`).
  - Text must not be empty or blank (`400 Bad Request`).
  - Cannot edit a soft-deleted message (`400 Bad Request`).
  - Executed inside a Firestore `runTransaction` for concurrency safety.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "msg-123456",
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "text": "Hello squad, this is my updated message!",
    "createdAt": "2026-10-21T00:00:00.000Z",
    "editedAt": "2026-10-21T00:05:00.000Z",
    "isDeleted": false
  }
  ```

#### 13. Delete Message (Soft Delete)
- **Route**: `DELETE /api/chat/:chatId/message/:messageId?senderId=<authorUserId>`
- **Header Alternative**: `x-user-id: <authorUserId>`
- **Request Body (Alternative)**:
  ```json
  {
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581"
  }
  ```
- **Rules**:
  - Only the original message author can delete the message (`403 Forbidden` if another user attempts deletion).
  - Acting user must be an active member of the conversation in PostgreSQL (`403 Forbidden`).
  - Employs a **soft-delete/tombstone strategy**:
    - Clears sensitive content from storage (`text: ""`).
    - Retains `id`, `senderId`, and `createdAt` so timeline chronological ordering and cursor pagination remain unbroken.
    - Sets `isDeleted: true` and records `deletedAt` server timestamp.
  - Repeated deletion requests are idempotent (`200 OK`).
  - Normal message retrieval (`GET /messages`) hides the deleted text and flags `isDeleted: true`.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "msg-123456",
    "chatId": "6b6eb37e-5b65-44eb-9ec9-585b6e80f01c",
    "senderId": "78a15aac-0d92-4ca9-ab67-70a78b569581",
    "isDeleted": true,
    "deletedAt": "2026-10-21T00:10:00.000Z"
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

1. **Node.js**: Node.js 22 or newer, using a currently supported release
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

### 5. Production Build & Run
```bash
npm run build
npm run start:prod
```
*`npm run build` compiles TypeScript to `dist/`, and `npm run start:prod` executes the entrypoint `node dist/main.js`.*

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

---

## 🧹 Code Quality, Linting & Formatting

Formatting and linting are maintained as separate, purpose-built commands:

### 1. Code Formatting (Prettier)
- **Check formatting (Read-only, does not modify files)**:
  ```bash
  npm run format:check
  ```
  *Verifies all files conform to Prettier rules without touching disk.*
- **Apply formatting (Modifies files in-place)**:
  ```bash
  npm run format
  ```
  *Runs `prettier --write` to automatically format and overwrite code across `src/` and `test/`.*

### 2. Static Code Analysis & Linting (ESLint)
- **Run linter**:
  ```bash
  npm run lint
  ```
  *Enforces ESLint rules with `--max-warnings=0` (fails if any warning/error exists).*
- **Auto-fix linter issues**:
  ```bash
  npm run lint:fix
  ```
  *Automatically applies safe ESLint fixes where possible.*

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

