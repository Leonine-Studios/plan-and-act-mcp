# Ephemeral Scratchpad & Todo MCP Server

A session-based MCP (Model Context Protocol) server providing ephemeral scratchpad and todo list functionality for AI agents. Features NanoID-based session isolation, optional X-User-ID security binding, configurable TONL/JSON response encoding, Redis/in-memory storage backends, and automatic TTL-based cleanup.

## Features

- **Session-based architecture**: Each agent gets an isolated workspace with unique NanoID
- **Scratchpad**: Document-based working memory for notes, reasoning trails, and findings
- **Todo list**: Atomic CRUD operations for task tracking
- **X-User-ID security**: Optional header binding for multi-user environments (LibreChat compatible)
- **TONL/JSON encoding**: Configurable token-efficient response format (30-60% token reduction)
- **Storage backends**: In-memory (default) or Redis for distributed deployments
- **TTL cleanup**: Automatic session expiration with configurable lifetime
- **Docker support**: Ready-to-use Dockerfile and docker-compose configuration
- **Multi-agent support**: Designed for remote, multi-user deployments

## Quick Start

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Testing

```bash
npm test           # Run tests once
npm run test:watch # Watch mode
```

## Docker Deployment

### Using Docker Compose (Recommended)

The easiest way to deploy with Redis:

```bash
# Start all services (MCP server + Redis)
docker-compose up -d

# View logs
docker-compose logs -f mcp-server

# Stop services
docker-compose down
```

### Using Docker Only

Build and run the server:

```bash
# Build the image
docker build -t mcp-scratchpad-todo .

# Run with in-memory storage
docker run -p 3000:3000 mcp-scratchpad-todo

# Run with external Redis
docker run -p 3000:3000 \
  -e STORAGE_TYPE=redis \
  -e REDIS_HOST=your-redis-host \
  -e REDIS_PORT=6379 \
  mcp-scratchpad-todo
```

### Development with Docker Redis

Use Docker for Redis while developing locally:

```bash
# Start only Redis
docker-compose up -d redis

# Run server locally with Redis
STORAGE_TYPE=redis npm run dev
```

## Configuration

Environment variables (create `.env` file or set in shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | localhost | Server host |
| `STORAGE_TYPE` | memory | Storage backend: `memory` or `redis` |
| `SESSION_TTL_HOURS` | 24 | Session TTL before auto-cleanup |
| `RESPONSE_FORMAT` | json | Response encoding: `json` or `tonl` |
| `NANOID_LENGTH` | 21 | Length of generated NanoIDs |
| `REDIS_HOST` | localhost | Redis server host (when using Redis) |
| `REDIS_PORT` | 6379 | Redis server port |
| `REDIS_PASSWORD` | (none) | Redis password (optional) |
| `REDIS_KEY_PREFIX` | mcp:session: | Key prefix for Redis keys |

Example `.env` for in-memory storage:

```env
PORT=3000
HOST=0.0.0.0
STORAGE_TYPE=memory
SESSION_TTL_HOURS=24
RESPONSE_FORMAT=tonl
```

Example `.env` for Redis storage:

```env
PORT=3000
HOST=0.0.0.0
STORAGE_TYPE=redis
REDIS_HOST=localhost
REDIS_PORT=6379
SESSION_TTL_HOURS=24
RESPONSE_FORMAT=json
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/health` | GET | Health check with session count and storage status |

Health check response:

```json
{
  "status": "ok",
  "server": "ephemeral-scratchpad-todo-mcp-server",
  "storage": {
    "type": "redis",
    "connected": true
  },
  "sessions": 5,
  "format": "json",
  "ttl_hours": 24
}
```

## Available Tools

### `init_session`

Initialize a new ephemeral session.

**Input**: None required

**Output** (JSON):
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "user_id": "user-123",
  "scratchpad": "",
  "todos": [],
  "created_at": "2025-01-18T10:00:00.000Z",
  "last_modified": "2025-01-18T10:00:00.000Z"
}
```

**Output** (TONL):
```
{id, userId, scratchpadLength, todoCount, createdAt, lastModified}
id: V1StGXR8_Z5jdHi6B-myT
userId: user-123
scratchpadLength: 0
todoCount: 0
createdAt: 2025-01-18
lastModified: 2025-01-18
```

---

### `read_scratchpad`

Read the scratchpad content.

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT"
}
```

**Output** (JSON):
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "content_length": 42,
  "content": "## Notes\n- Working on feature X\n- Found issue Y"
}
```

---

### `write_scratchpad`

Write content to the scratchpad (replaces existing).

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "content": "## Updated Notes\n- Completed feature X"
}
```

**Output**:
```json
{
  "success": true,
  "message": "Scratchpad updated successfully",
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "content_length": 38
}
```

---

### `add_todo`

Add a new todo item.

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "title": "Implement feature X",
  "description": "Optional description",
  "tags": ["backend", "priority"]
}
```

**Output** (JSON):
```json
{
  "id": "abc123def456",
  "title": "Implement feature X",
  "description": "Optional description",
  "tags": ["backend", "priority"],
  "status": "pending",
  "createdAt": "2025-01-18T10:30:00.000Z"
}
```

---

### `list_todos`

List todos with optional filtering.

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "filter": "all"
}
```

Filter options: `all` (default), `pending`, `done`

**Output** (JSON):
```json
[
  {
    "id": "abc123def456",
    "title": "Task 1",
    "description": "",
    "tags": ["backend"],
    "status": "done",
    "createdAt": "2025-01-18T10:00:00.000Z"
  },
  {
    "id": "xyz789ghi012",
    "title": "Task 2",
    "description": "",
    "tags": [],
    "status": "pending",
    "createdAt": "2025-01-18T10:30:00.000Z"
  }
]
```

**Output** (TONL):
```
[2]{id, title, status, tags, createdAt}
abc123def456   Task 1   done      [backend]   2025-01-18
xyz789ghi012   Task 2   pending   []          2025-01-18
```

---

### `update_todo`

Update a todo's status.

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "todo_id": "abc123def456",
  "status": "done"
}
```

Status options: `pending`, `done`

---

### `delete_todo`

Delete a todo item.

**Input**:
```json
{
  "session_id": "V1StGXR8_Z5jdHi6B-myT",
  "todo_id": "abc123def456"
}
```

**Output**:
```json
{
  "success": true,
  "message": "Todo deleted successfully",
  "deleted_id": "abc123def456",
  "deleted_title": "Task 1"
}
```

## X-User-ID Security

For multi-user environments, the server supports optional `X-User-ID` header binding:

### How it works

1. **Session created WITH X-User-ID**: All subsequent requests to that session MUST include the same `X-User-ID` header
2. **Session created WITHOUT X-User-ID**: No header validation required (backwards compatible)

### LibreChat Integration

Configure MCP in LibreChat with user ID header:

```yaml
mcp:
  scratchpad-todo:
    url: http://localhost:3000/mcp
    headers:
      X-User-ID: "{{LIBRECHAT_USER_ID}}"
```

### Security Benefits

- Prevents session ID guessing attacks
- Each user's sessions are isolated
- NanoID + User ID provides strong security without complex auth

## TONL Format

TONL (Token-Optimized Notation Language) reduces token usage by 30-60% compared to JSON:

### Example: Todo List

**JSON** (51 tokens):
```json
[
  {"id": "abc", "title": "Task 1", "status": "done", "tags": ["test"]},
  {"id": "def", "title": "Task 2", "status": "pending", "tags": []}
]
```

**TONL** (29 tokens):
```
[2]{id, title, status, tags, createdAt}
abc   Task 1   done      [test]   2025-01-18
def   Task 2   pending   []       2025-01-18
```

Enable TONL by setting `RESPONSE_FORMAT=tonl` in your environment.

## Architecture

```
├── Dockerfile                  # Multi-stage production build
├── docker-compose.yml          # Docker Compose with Redis
├── src/
│   ├── index.ts                # HTTP server entry point
│   ├── storage/
│   │   ├── types.ts            # Session, Todo, SessionStore interface
│   │   ├── InMemorySessionStore.ts  # In-memory storage with TTL
│   │   ├── RedisSessionStore.ts     # Redis storage with native TTL
│   │   ├── factory.ts          # Storage factory for backend selection
│   │   └── index.ts
│   ├── tools/
│   │   ├── session.ts          # init_session
│   │   ├── scratchpad.ts       # read/write scratchpad
│   │   ├── todo.ts             # CRUD operations
│   │   └── index.ts
│   ├── utils/
│   │   ├── encoder.ts          # Response format switching
│   │   ├── tonl.ts             # TONL encoder
│   │   └── index.ts
│   └── __tests__/              # Unit and integration tests
```

## Storage Backends

### In-Memory Storage (Default)

- Fast, no external dependencies
- Data lost on restart
- Suitable for development and single-instance deployments
- Background cleanup task removes expired sessions

### Redis Storage

- Persistent across restarts (with Redis persistence)
- Suitable for distributed/multi-instance deployments
- Native Redis TTL handles expiration automatically
- Supports key prefix for multi-tenant namespacing

The `SessionStore` interface allows swapping storage backends:

```typescript
interface SessionStore {
  create(userId?: string): Promise<Session>;
  get(sessionId: string, userId?: string): Promise<Session | null>;
  update(sessionId: string, updates: Partial<Session>, userId?: string): Promise<void>;
  delete(sessionId: string, userId?: string): Promise<void>;
  exists(sessionId: string): Promise<boolean>;
  cleanup(): Promise<number>;
}
```

## Use Cases

### Agent Working Memory

```
1. init_session() → Get session_id
2. write_scratchpad() → Store reasoning/findings
3. add_todo() → Break down tasks
4. [Work on tasks]
5. update_todo(status: "done") → Mark complete
6. read_scratchpad() → Review progress
```

### Multi-Step Workflows

- Track intermediate findings in scratchpad
- Decompose complex tasks into todos
- Persist state across tool calls
- Document blockers and approaches

### Multi-User SaaS

- Deploy with Docker Compose for production
- Use Redis for session persistence
- Each user gets isolated sessions via X-User-ID
- Sessions auto-expire after TTL
- Horizontal scaling with shared Redis

## License

MIT
