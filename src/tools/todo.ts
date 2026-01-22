import { z } from "zod";
import { nanoid } from "nanoid";
import {
  Todo,
  TodoStatus,
  SessionNotFoundError,
  UserIdMismatchError,
  TodoNotFoundError,
} from "../storage/types.js";
import { ToolContext } from "./session.js";
import { getSessionLock } from "../utils/locks.js";

/**
 * Schema for add_todo tool input
 */
export const AddTodoInputSchema = z.object({
  session_id: z.string().describe("The session ID returned by init_session"),
  title: z.string().min(1).describe("The title of the todo item"),
  description: z
    .string()
    .optional()
    .default("")
    .describe("Optional description for the todo item"),
  tags: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Optional tags for categorization"),
});

export type AddTodoInput = z.infer<typeof AddTodoInputSchema>;

/**
 * Schema for list_todos tool input
 */
export const ListTodosInputSchema = z.object({
  session_id: z.string().describe("The session ID returned by init_session"),
  filter: z
    .enum(["all", "pending", "done"])
    .optional()
    .default("all")
    .describe("Filter todos by status: 'all', 'pending', or 'done'"),
});

export type ListTodosInput = z.infer<typeof ListTodosInputSchema>;

/**
 * Schema for update_todo tool input
 */
export const UpdateTodoInputSchema = z.object({
  session_id: z.string().describe("The session ID returned by init_session"),
  todo_id: z.string().describe("The ID of the todo item to update"),
  status: z
    .enum(["pending", "done"])
    .describe("The new status for the todo item"),
});

export type UpdateTodoInput = z.infer<typeof UpdateTodoInputSchema>;

/**
 * Schema for delete_todo tool input
 */
export const DeleteTodoInputSchema = z.object({
  session_id: z.string().describe("The session ID returned by init_session"),
  todo_id: z.string().describe("The ID of the todo item to delete"),
});

export type DeleteTodoInput = z.infer<typeof DeleteTodoInputSchema>;

/**
 * Add a new todo item to a session.
 * Uses mutex lock to prevent race conditions with parallel calls.
 */
export async function addTodo(
  input: AddTodoInput,
  context: ToolContext
): Promise<string> {
  const lock = getSessionLock(input.session_id);

  return lock.runExclusive(async () => {
    try {
      const session = await context.store.get(input.session_id, context.userId);

      if (!session) {
        return context.encoder.encodeError(
          `Session not found: ${input.session_id}`,
          "SESSION_NOT_FOUND"
        );
      }

      const todo: Todo = {
        id: nanoid(12), // Shorter ID for todos
        title: input.title,
        description: input.description ?? "",
        tags: input.tags ?? [],
        status: "pending" as TodoStatus,
        createdAt: new Date(),
      };

      const updatedTodos = [...session.todos, todo];

      await context.store.update(
        input.session_id,
        { todos: updatedTodos },
        context.userId
      );

      return context.encoder.encodeTodo(todo);
    } catch (error) {
      if (error instanceof UserIdMismatchError) {
        return context.encoder.encodeError(
          "User ID mismatch - access denied",
          "USER_ID_MISMATCH"
        );
      }
      throw error;
    }
  });
}

/**
 * List todos in a session with optional filtering
 */
export async function listTodos(
  input: ListTodosInput,
  context: ToolContext
): Promise<string> {
  try {
    const session = await context.store.get(input.session_id, context.userId);

    if (!session) {
      return context.encoder.encodeError(
        `Session not found: ${input.session_id}`,
        "SESSION_NOT_FOUND"
      );
    }

    let todos = session.todos;

    // Apply filter
    if (input.filter === "pending") {
      todos = todos.filter((t) => t.status === "pending");
    } else if (input.filter === "done") {
      todos = todos.filter((t) => t.status === "done");
    }

    return context.encoder.encodeTodos(todos);
  } catch (error) {
    if (error instanceof UserIdMismatchError) {
      return context.encoder.encodeError(
        "User ID mismatch - access denied",
        "USER_ID_MISMATCH"
      );
    }
    throw error;
  }
}

/**
 * Update the status of a todo item.
 * Uses mutex lock to prevent race conditions with parallel calls.
 */
export async function updateTodo(
  input: UpdateTodoInput,
  context: ToolContext
): Promise<string> {
  const lock = getSessionLock(input.session_id);

  return lock.runExclusive(async () => {
    try {
      const session = await context.store.get(input.session_id, context.userId);

      if (!session) {
        return context.encoder.encodeError(
          `Session not found: ${input.session_id}`,
          "SESSION_NOT_FOUND"
        );
      }

      const todoIndex = session.todos.findIndex((t) => t.id === input.todo_id);

      if (todoIndex === -1) {
        return context.encoder.encodeError(
          `Todo not found: ${input.todo_id}`,
          "TODO_NOT_FOUND"
        );
      }

      const updatedTodo: Todo = {
        ...session.todos[todoIndex],
        status: input.status,
      };

      const updatedTodos = [...session.todos];
      updatedTodos[todoIndex] = updatedTodo;

      await context.store.update(
        input.session_id,
        { todos: updatedTodos },
        context.userId
      );

      return context.encoder.encodeTodo(updatedTodo);
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.encoder.encodeError(
          `Session not found: ${input.session_id}`,
          "SESSION_NOT_FOUND"
        );
      }
      if (error instanceof UserIdMismatchError) {
        return context.encoder.encodeError(
          "User ID mismatch - access denied",
          "USER_ID_MISMATCH"
        );
      }
      throw error;
    }
  });
}

/**
 * Delete a todo item from a session.
 * Uses mutex lock to prevent race conditions with parallel calls.
 */
export async function deleteTodo(
  input: DeleteTodoInput,
  context: ToolContext
): Promise<string> {
  const lock = getSessionLock(input.session_id);

  return lock.runExclusive(async () => {
    try {
      const session = await context.store.get(input.session_id, context.userId);

      if (!session) {
        return context.encoder.encodeError(
          `Session not found: ${input.session_id}`,
          "SESSION_NOT_FOUND"
        );
      }

      const todoIndex = session.todos.findIndex((t) => t.id === input.todo_id);

      if (todoIndex === -1) {
        return context.encoder.encodeError(
          `Todo not found: ${input.todo_id}`,
          "TODO_NOT_FOUND"
        );
      }

      const deletedTodo = session.todos[todoIndex];
      const updatedTodos = session.todos.filter((t) => t.id !== input.todo_id);

      await context.store.update(
        input.session_id,
        { todos: updatedTodos },
        context.userId
      );

      return context.encoder.encodeSuccess("Todo deleted successfully", {
        deleted_id: deletedTodo.id,
        deleted_title: deletedTodo.title,
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        return context.encoder.encodeError(
          `Session not found: ${input.session_id}`,
          "SESSION_NOT_FOUND"
        );
      }
      if (error instanceof UserIdMismatchError) {
        return context.encoder.encodeError(
          "User ID mismatch - access denied",
          "USER_ID_MISMATCH"
        );
      }
      throw error;
    }
  });
}

/**
 * Tool definitions for MCP registration
 */
export const addTodoTool = {
  name: "add_todo",
  description: `Add a new todo item to the session's todo list.

Creates a new todo with 'pending' status. Use for tracking discrete, actionable tasks.

Returns the created todo with its assigned ID.`,
  inputSchema: AddTodoInputSchema,
  handler: addTodo,
};

export const listTodosTool = {
  name: "list_todos",
  description: `List all todos in the session, optionally filtered by status.

Filters:
- 'all' (default): Return all todos
- 'pending': Return only incomplete todos
- 'done': Return only completed todos

Returns todos in a compact format (TONL or JSON based on server configuration).`,
  inputSchema: ListTodosInputSchema,
  handler: listTodos,
};

export const updateTodoTool = {
  name: "update_todo",
  description: `Update the status of a todo item.

Use to mark todos as 'done' when completed, or back to 'pending' if needed.

Returns the updated todo.`,
  inputSchema: UpdateTodoInputSchema,
  handler: updateTodo,
};

export const deleteTodoTool = {
  name: "delete_todo",
  description: `Delete a todo item from the session.

Permanently removes the specified todo. Use when a task is cancelled or no longer relevant.

Returns confirmation with the deleted todo's details.`,
  inputSchema: DeleteTodoInputSchema,
  handler: deleteTodo,
};
