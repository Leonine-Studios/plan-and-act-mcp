# MCP Hello World Server

A minimal HTTP-based MCP (Model Context Protocol) server built with TypeScript and the official `@modelcontextprotocol/sdk`.

## Features

- HTTP transport using Streamable HTTP (modern MCP transport)
- Single `hello_world` tool with Zod schema validation
- Development mode with hot-reload
- Production build support

## Prerequisites

- Node.js >= 18.0.0
- npm

## Installation

```bash
npm install
```

## Usage

### Development Mode

Run with hot-reload for development:

```bash
npm run dev
```

### Production Mode

Build and run the production version:

```bash
npm run build
npm start
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/health` | GET | Health check endpoint |

## Available Tools

### `hello_world`

A simple greeting tool that says hello.

**Input Schema:**
```json
{
  "name": "string (optional)"
}
```

**Example Request (Initialize):**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "test-client", "version": "1.0.0" }
    }
  }'
```

**Example Response (SSE format):**
```
event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"hello-mcp-server","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
```

> **Note**: The Streamable HTTP transport uses Server-Sent Events (SSE) format. For full MCP client integration, use an MCP-compatible client library or the [MCP Inspector](https://github.com/modelcontextprotocol/inspector).
```

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `HOST` | localhost | Server host |

## Project Structure

```
├── src/
│   ├── index.ts          # Server entry point
│   └── tools/
│       └── hello.ts      # Hello world tool definition
├── package.json
├── tsconfig.json
└── README.md
```

## Adding New Tools

1. Create a new file in `src/tools/`:

```typescript
import { z } from "zod";

export const MyToolInputSchema = z.object({
  // define your input schema
});

export function myTool(input: z.infer<typeof MyToolInputSchema>) {
  // implement your tool logic
  return "result";
}

export const myToolDefinition = {
  name: "my_tool",
  description: "Description of what your tool does",
  inputSchema: MyToolInputSchema,
  handler: myTool,
};
```

2. Register it in `src/index.ts`:

```typescript
import { myToolDefinition, MyToolInputSchema } from "./tools/myTool.js";

// In createMcpServer():
server.tool(
  myToolDefinition.name,
  myToolDefinition.description,
  MyToolInputSchema.shape,
  async (params) => {
    const validated = MyToolInputSchema.parse(params);
    const result = myToolDefinition.handler(validated);
    return {
      content: [{ type: "text", text: result }],
    };
  }
);
```

## License

MIT
