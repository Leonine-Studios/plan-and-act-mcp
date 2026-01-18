import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { helloWorldTool, HelloWorldInputSchema } from "./tools/hello.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "localhost";

/**
 * Create and configure the MCP server
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "hello-mcp-server",
    version: "1.0.0",
  });

  // Register the hello_world tool
  server.tool(
    helloWorldTool.name,
    helloWorldTool.description,
    HelloWorldInputSchema.shape,
    async (params) => {
      const validated = HelloWorldInputSchema.parse(params);
      const result = helloWorldTool.handler(validated);
      return {
        content: [
          {
            type: "text" as const,
            text: result,
          },
        ],
      };
    }
  );

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const mcpServer = createMcpServer();

  // Create HTTP server with Streamable HTTP transport
  const httpServer = createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
      });
      res.end();
      return;
    }

    // Health check endpoint
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "hello-mcp-server" }));
      return;
    }

    // MCP endpoint
    if (req.url === "/mcp" || req.url === "/") {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless mode
        });

        // Connect the transport to the MCP server
        await mcpServer.connect(transport);

        // Handle the HTTP request
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`🚀 MCP Server running at http://${HOST}:${PORT}`);
    console.log(`📡 MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`❤️  Health check: http://${HOST}:${PORT}/health`);
    console.log("\nAvailable tools:");
    console.log(`  - ${helloWorldTool.name}: ${helloWorldTool.description}`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n👋 Shutting down gracefully...");
    httpServer.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
