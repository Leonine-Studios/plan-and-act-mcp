import { z } from "zod";

/**
 * Schema for the hello_world tool input
 */
export const HelloWorldInputSchema = z.object({
  name: z.string().optional().describe("The name to greet. Defaults to 'World' if not provided."),
});

export type HelloWorldInput = z.infer<typeof HelloWorldInputSchema>;

/**
 * Hello world tool handler
 * Returns a greeting message
 */
export function helloWorld(input: HelloWorldInput): string {
  const name = input.name || "World";
  return `Hello, ${name}!`;
}

/**
 * Tool definition for MCP registration
 */
export const helloWorldTool = {
  name: "hello_world",
  description: "A simple greeting tool that says hello. Optionally accepts a name to personalize the greeting.",
  inputSchema: HelloWorldInputSchema,
  handler: helloWorld,
};
