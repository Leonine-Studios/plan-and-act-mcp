import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RedisSessionStore } from "../storage/RedisSessionStore.js";
import { UserIdMismatchError, SessionNotFoundError } from "../storage/types.js";

// Mock ioredis
const mockData = new Map<string, { value: string; ttl: number }>();

vi.mock("ioredis", () => {
  const MockRedis = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    setex: vi.fn().mockImplementation((key: string, ttl: number, value: string) => {
      mockData.set(key, { value, ttl });
      return Promise.resolve("OK");
    }),
    get: vi.fn().mockImplementation((key: string) => {
      const data = mockData.get(key);
      return Promise.resolve(data ? data.value : null);
    }),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (mockData.delete(key)) count++;
      }
      return Promise.resolve(count);
    }),
    exists: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(mockData.has(key) ? 1 : 0);
    }),
    keys: vi.fn().mockImplementation((pattern: string) => {
      const prefix = pattern.replace("*", "");
      const matchingKeys = Array.from(mockData.keys()).filter((k) =>
        k.startsWith(prefix)
      );
      return Promise.resolve(matchingKeys);
    }),
    ttl: vi.fn().mockImplementation((key: string) => {
      const data = mockData.get(key);
      return Promise.resolve(data ? data.ttl : -2);
    }),
    on: vi.fn().mockImplementation(function (
      this: { _handlers: Record<string, Function> },
      event: string,
      handler: Function
    ) {
      this._handlers = this._handlers || {};
      this._handlers[event] = handler;
      // Simulate immediate connection
      if (event === "connect") {
        setTimeout(() => handler(), 0);
      }
      return this;
    }),
  }));

  return {
    Redis: MockRedis,
    default: MockRedis,
  };
});

describe("RedisSessionStore", () => {
  let store: RedisSessionStore;

  beforeEach(async () => {
    // Clear mock data before each test
    mockData.clear();

    store = new RedisSessionStore({
      host: "localhost",
      port: 6379,
      ttlHours: 1,
      keyPrefix: "test:session:",
      nanoidLength: 21,
    });
    // Allow mock connection event to fire
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(async () => {
    if (store) {
      await store.clear();
      store.stopCleanup();
    }
  });

  describe("create", () => {
    it("should create a new session with NanoID", async () => {
      const session = await store.create();

      expect(session.id).toBeDefined();
      expect(session.id.length).toBe(21);
      expect(session.scratchpad).toBe("");
      expect(session.todos).toEqual([]);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastModified).toBeInstanceOf(Date);
    });

    it("should create session with userId when provided", async () => {
      const session = await store.create("user-123");

      expect(session.userId).toBe("user-123");
    });

    it("should create session without userId when not provided", async () => {
      const session = await store.create();

      expect(session.userId).toBeUndefined();
    });

    it("should generate unique session IDs", async () => {
      const sessions = await Promise.all([
        store.create(),
        store.create(),
        store.create(),
      ]);

      const ids = sessions.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("get", () => {
    it("should return session by ID", async () => {
      const created = await store.create();
      const retrieved = await store.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return null for non-existent session", async () => {
      const session = await store.get("non-existent-id");

      expect(session).toBeNull();
    });

    it("should validate userId if session has one", async () => {
      const session = await store.create("user-123");

      // Correct userId
      const retrieved = await store.get(session.id, "user-123");
      expect(retrieved).not.toBeNull();

      // Wrong userId
      await expect(store.get(session.id, "wrong-user")).rejects.toThrow(
        UserIdMismatchError
      );

      // Missing userId
      await expect(store.get(session.id, undefined)).rejects.toThrow(
        UserIdMismatchError
      );
    });

    it("should not require userId if session has none", async () => {
      const session = await store.create();

      // No userId provided - should work
      const retrieved = await store.get(session.id);
      expect(retrieved).not.toBeNull();

      // With userId provided - should also work
      const retrieved2 = await store.get(session.id, "any-user");
      expect(retrieved2).not.toBeNull();
    });
  });

  describe("update", () => {
    it("should update session scratchpad", async () => {
      const session = await store.create();
      await store.update(session.id, { scratchpad: "Hello World" });

      const retrieved = await store.get(session.id);
      expect(retrieved?.scratchpad).toBe("Hello World");
    });

    it("should update lastModified on update", async () => {
      const session = await store.create();
      const originalLastModified = session.lastModified;

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await store.update(session.id, { scratchpad: "Updated" });
      const retrieved = await store.get(session.id);

      expect(retrieved?.lastModified.getTime()).toBeGreaterThan(
        originalLastModified.getTime()
      );
    });

    it("should throw SessionNotFoundError for non-existent session", async () => {
      await expect(
        store.update("non-existent", { scratchpad: "test" })
      ).rejects.toThrow(SessionNotFoundError);
    });

    it("should validate userId on update", async () => {
      const session = await store.create("user-123");

      await expect(
        store.update(session.id, { scratchpad: "test" }, "wrong-user")
      ).rejects.toThrow(UserIdMismatchError);
    });
  });

  describe("delete", () => {
    it("should delete session", async () => {
      const session = await store.create();
      await store.delete(session.id);

      const retrieved = await store.get(session.id);
      expect(retrieved).toBeNull();
    });

    it("should throw SessionNotFoundError for non-existent session", async () => {
      await expect(store.delete("non-existent")).rejects.toThrow(
        SessionNotFoundError
      );
    });

    it("should validate userId on delete", async () => {
      const session = await store.create("user-123");

      await expect(store.delete(session.id, "wrong-user")).rejects.toThrow(
        UserIdMismatchError
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing session", async () => {
      const session = await store.create();

      expect(await store.exists(session.id)).toBe(true);
    });

    it("should return false for non-existent session", async () => {
      expect(await store.exists("non-existent")).toBe(false);
    });
  });

  describe("count", () => {
    it("should return correct session count", async () => {
      expect(await store.count()).toBe(0);

      await store.create();
      expect(await store.count()).toBe(1);

      await store.create();
      expect(await store.count()).toBe(2);
    });
  });

  describe("key prefix", () => {
    it("should use configured key prefix", async () => {
      const customStore = new RedisSessionStore({
        keyPrefix: "custom:prefix:",
        ttlHours: 1,
      });

      const session = await customStore.create();

      // Verify session was created and can be retrieved
      const retrieved = await customStore.get(session.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(session.id);

      await customStore.clear();
    });
  });

  describe("cleanup", () => {
    it("should return 0 (TTL handled by Redis)", async () => {
      await store.create();
      await store.create();

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(0);
    });

    it("should start and stop cleanup without errors", () => {
      store.startCleanup();
      store.stopCleanup();
      // Should not throw
    });
  });

  describe("clear", () => {
    it("should clear all sessions with prefix", async () => {
      await store.create();
      await store.create();
      await store.create();

      expect(await store.count()).toBe(3);

      await store.clear();

      expect(await store.count()).toBe(0);
    });
  });

  describe("serialization", () => {
    it("should correctly serialize and deserialize session with todos", async () => {
      const session = await store.create();

      // Update with todos
      await store.update(session.id, {
        scratchpad: "Test notes",
        todos: [
          {
            id: "todo-1",
            title: "Task 1",
            description: "Description",
            tags: ["tag1", "tag2"],
            status: "pending",
            createdAt: new Date("2025-01-18T10:00:00Z"),
          },
          {
            id: "todo-2",
            title: "Task 2",
            description: "",
            tags: [],
            status: "done",
            createdAt: new Date("2025-01-18T11:00:00Z"),
          },
        ],
      });

      const retrieved = await store.get(session.id);

      expect(retrieved?.scratchpad).toBe("Test notes");
      expect(retrieved?.todos.length).toBe(2);
      expect(retrieved?.todos[0].title).toBe("Task 1");
      expect(retrieved?.todos[0].tags).toEqual(["tag1", "tag2"]);
      expect(retrieved?.todos[0].status).toBe("pending");
      expect(retrieved?.todos[0].createdAt).toBeInstanceOf(Date);
      expect(retrieved?.todos[1].title).toBe("Task 2");
      expect(retrieved?.todos[1].status).toBe("done");
    });
  });
});
