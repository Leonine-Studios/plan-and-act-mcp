import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  createSessionStoreFromEnv,
  getStorageType,
  StorageFactoryResult,
} from "./storage/factory.js";
import { ResponseEncoder, getResponseFormat } from "./utils/encoder.js";
import {
  initSessionTool,
  InitSessionInputSchema,
  ToolContext,
} from "./tools/session.js";
import {
  readScratchpadTool,
  ReadScratchpadInputSchema,
  writeScratchpadTool,
  WriteScratchpadInputSchema,
} from "./tools/scratchpad.js";
import {
  addTodoTool,
  AddTodoInputSchema,
  listTodosTool,
  ListTodosInputSchema,
  updateTodoTool,
  UpdateTodoInputSchema,
  deleteTodoTool,
  DeleteTodoInputSchema,
} from "./tools/todo.js";

// Configuration from environment
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "localhost";
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || "24", 10);
const NANOID_LENGTH = parseInt(process.env.NANOID_LENGTH || "21", 10);
const STORAGE_TYPE = getStorageType();

// Keep-alive interval for SSE connections (30 seconds, well under the 60s client timeout)
const KEEP_ALIVE_INTERVAL_MS = 30000;

// Initialize storage using factory
let storage: StorageFactoryResult;

// Initialize encoder
const encoder = new ResponseEncoder();

/**
 * Extract X-User-ID header from request
 */
function extractUserId(req: IncomingMessage): string | undefined {
  const userId = req.headers["x-user-id"];
  if (Array.isArray(userId)) {
    return userId[0];
  }
  return userId;
}

/**
 * Create tool context from request
 */
function createToolContext(req: IncomingMessage): ToolContext {
  return {
    store: storage.store,
    encoder: encoder,
    userId: extractUserId(req),
  };
}

// Store the current request for tool handlers
let currentRequest: IncomingMessage | null = null;

/**
 * Create and configure the MCP server
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ephemeral-scratchpad-todo-mcp-server",
    version: "1.0.0",
  });

  // Register init_session tool
  server.tool(
    initSessionTool.name,
    initSessionTool.description,
    InitSessionInputSchema.shape,
    async (params) => {
      const validated = InitSessionInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await initSessionTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register read_scratchpad tool
  server.tool(
    readScratchpadTool.name,
    readScratchpadTool.description,
    ReadScratchpadInputSchema.shape,
    async (params) => {
      const validated = ReadScratchpadInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await readScratchpadTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register write_scratchpad tool
  server.tool(
    writeScratchpadTool.name,
    writeScratchpadTool.description,
    WriteScratchpadInputSchema.shape,
    async (params) => {
      const validated = WriteScratchpadInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await writeScratchpadTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register add_todo tool
  server.tool(
    addTodoTool.name,
    addTodoTool.description,
    AddTodoInputSchema.shape,
    async (params) => {
      const validated = AddTodoInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await addTodoTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register list_todos tool
  server.tool(
    listTodosTool.name,
    listTodosTool.description,
    ListTodosInputSchema.shape,
    async (params) => {
      const validated = ListTodosInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await listTodosTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register update_todo tool
  server.tool(
    updateTodoTool.name,
    updateTodoTool.description,
    UpdateTodoInputSchema.shape,
    async (params) => {
      const validated = UpdateTodoInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await updateTodoTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  // Register delete_todo tool
  server.tool(
    deleteTodoTool.name,
    deleteTodoTool.description,
    DeleteTodoInputSchema.shape,
    async (params) => {
      const validated = DeleteTodoInputSchema.parse(params);
      const context = createToolContext(currentRequest!);
      const result = await deleteTodoTool.handler(validated, context);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );

  return server;
}

/**
 * Handle HTTP requests
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, X-User-ID",
    });
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === "GET" && req.url === "/health") {
    const sessionCount = await storage.store.count();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        server: "ephemeral-scratchpad-todo-mcp-server",
        storage: {
          type: storage.type,
          connected: storage.isConnected(),
        },
        sessions: sessionCount,
        format: getResponseFormat(),
        ttl_hours: SESSION_TTL_HOURS,
      })
    );
    return;
  }

  // MCP endpoint
  if (req.url === "/mcp" || req.url === "/") {
    let keepAliveInterval: NodeJS.Timeout | null = null;

    try {
      // Store current request for tool context
      currentRequest = req;

      // Create a NEW McpServer instance for each request (stateless mode)
      // This prevents SSE connection conflicts when multiple clients connect
      const mcpServer = createMcpServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
      });

      // Connect the transport to the MCP server
      await mcpServer.connect(transport);

      // For GET requests (SSE streams), set up keep-alive to prevent 60s client timeout
      // The MCP client SDK has a 60-second default timeout for SSE connections
      if (req.method === "GET") {
        const acceptHeader = req.headers.accept || "";
        const isSSE = acceptHeader.includes("text/event-stream");

        if (isSSE) {
          // Set up keep-alive interval to send SSE comments every 30 seconds
          keepAliveInterval = setInterval(() => {
            if (!res.writableEnded && res.writable) {
              try {
                // SSE comment format - ignored by clients but keeps connection alive
                res.write(": keepalive\n\n");
              } catch {
                // Connection might be closed, clear interval
                if (keepAliveInterval) {
                  clearInterval(keepAliveInterval);
                  keepAliveInterval = null;
                }
              }
            }
          }, KEEP_ALIVE_INTERVAL_MS);

          // Clean up interval when response ends
          res.on("close", () => {
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
          });

          res.on("error", () => {
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval);
              keepAliveInterval = null;
            }
          });
        }
      }

      // Handle the HTTP request
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    } finally {
      currentRequest = null;
      // Clean up keep-alive interval if still running
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }
    }
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Initialize storage
  storage = createSessionStoreFromEnv();

  // Connect to storage (important for Redis)
  await storage.connect();

  // Start background cleanup
  storage.store.startCleanup();

  // Create HTTP server
  // Note: McpServer instances are created per-request in stateless mode
  // to prevent SSE connection conflicts between multiple clients
  const httpServer = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Unhandled error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  // Disable server timeouts for SSE connections
  // These can cause premature connection termination
  httpServer.timeout = 0; // Disable socket timeout
  httpServer.keepAliveTimeout = 0; // Disable keep-alive timeout
  httpServer.headersTimeout = 0; // Disable headers timeout

  httpServer.listen(PORT, HOST, () => {
    console.log(`\n🚀 Ephemeral Scratchpad & Todo MCP Server`);
    console.log(`   Running at http://${HOST}:${PORT}`);
    console.log(`\n📡 Endpoints:`);
    console.log(`   MCP:    http://${HOST}:${PORT}/mcp`);
    console.log(`   Health: http://${HOST}:${PORT}/health`);
    console.log(`\n⚙️  Configuration:`);
    console.log(`   Storage Type:    ${STORAGE_TYPE}`);
    console.log(`   Response Format: ${getResponseFormat()}`);
    console.log(`   Session TTL:     ${SESSION_TTL_HOURS} hours`);
    console.log(`   NanoID Length:   ${NANOID_LENGTH}`);
    console.log(`   Keep-alive:      ${KEEP_ALIVE_INTERVAL_MS / 1000}s interval`);
    console.log(`\n🔧 Available Tools:`);
    console.log(`   - ${initSessionTool.name}`);
    console.log(`   - ${readScratchpadTool.name}`);
    console.log(`   - ${writeScratchpadTool.name}`);
    console.log(`   - ${addTodoTool.name}`);
    console.log(`   - ${listTodosTool.name}`);
    console.log(`   - ${updateTodoTool.name}`);
    console.log(`   - ${deleteTodoTool.name}`);
    console.log(`\n💡 Tip: Set X-User-ID header for session-user binding security`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n👋 Shutting down gracefully...");
    storage.store.stopCleanup();
    await storage.disconnect();
    httpServer.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
