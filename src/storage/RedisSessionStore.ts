import { Redis } from "ioredis";
import { nanoid } from "nanoid";
import {
  Session,
  SessionStore,
  SessionNotFoundError,
  UserIdMismatchError,
} from "./types.js";

/**
 * Configuration for RedisSessionStore
 */
export interface RedisSessionStoreConfig {
  /**
   * Redis server host
   * @default "localhost"
   */
  host?: string;

  /**
   * Redis server port
   * @default 6379
   */
  port?: number;

  /**
   * Redis password (optional)
   */
  password?: string;

  /**
   * Time-to-live for sessions in hours
   * @default 24
   */
  ttlHours?: number;

  /**
   * Key prefix for Redis keys
   * @default "mcp:session:"
   */
  keyPrefix?: string;

  /**
   * Length of generated NanoIDs
   * @default 21
   */
  nanoidLength?: number;
}

/**
 * Serializable session format for Redis storage
 */
interface SerializedSession {
  id: string;
  userId?: string;
  scratchpad: string;
  todos: Array<{
    id: string;
    title: string;
    description: string;
    tags: string[];
    status: string;
    createdAt: string;
  }>;
  createdAt: string;
  lastModified: string;
}

/**
 * Redis implementation of SessionStore
 * Features:
 * - Native Redis TTL (no background cleanup needed)
 * - JSON serialization for session data
 * - Key prefix for namespacing
 * - NanoID collision check via EXISTS
 */
export class RedisSessionStore implements SessionStore {
  private client: Redis;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly nanoidLength: number;
  private isConnected: boolean = false;

  constructor(config: RedisSessionStoreConfig = {}) {
    const host = config.host ?? "localhost";
    const port = config.port ?? 6379;
    const password = config.password;
    const ttlHours = config.ttlHours ?? 24;

    this.ttlSeconds = ttlHours * 60 * 60;
    this.keyPrefix = config.keyPrefix ?? "mcp:session:";
    this.nanoidLength = config.nanoidLength ?? 21;

    this.client = new Redis({
      host,
      port,
      password,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.error("[RedisSessionStore] Max retries reached, giving up");
          return null;
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    this.client.on("connect", () => {
      this.isConnected = true;
      console.log(`[RedisSessionStore] Connected to Redis at ${host}:${port}`);
    });

    this.client.on("error", (err: Error) => {
      console.error("[RedisSessionStore] Redis error:", err.message);
    });

    this.client.on("close", () => {
      this.isConnected = false;
      console.log("[RedisSessionStore] Redis connection closed");
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
    }
  }

  /**
   * Check if connected to Redis
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get the full Redis key for a session
   */
  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Generate a unique NanoID with collision check
   */
  private async generateUniqueId(): Promise<string> {
    let id: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      id = nanoid(this.nanoidLength);
      attempts++;

      if (attempts > maxAttempts) {
        throw new Error(
          "Failed to generate unique session ID after maximum attempts"
        );
      }
    } while (await this.exists(id));

    return id;
  }

  /**
   * Serialize a session for Redis storage
   */
  private serializeSession(session: Session): string {
    const serialized: SerializedSession = {
      id: session.id,
      userId: session.userId,
      scratchpad: session.scratchpad,
      todos: session.todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        description: todo.description,
        tags: todo.tags,
        status: todo.status,
        createdAt: todo.createdAt.toISOString(),
      })),
      createdAt: session.createdAt.toISOString(),
      lastModified: session.lastModified.toISOString(),
    };
    return JSON.stringify(serialized);
  }

  /**
   * Deserialize a session from Redis storage
   */
  private deserializeSession(data: string): Session {
    const serialized: SerializedSession = JSON.parse(data);
    return {
      id: serialized.id,
      userId: serialized.userId,
      scratchpad: serialized.scratchpad,
      todos: serialized.todos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        description: todo.description,
        tags: todo.tags,
        status: todo.status as "pending" | "done",
        createdAt: new Date(todo.createdAt),
      })),
      createdAt: new Date(serialized.createdAt),
      lastModified: new Date(serialized.lastModified),
    };
  }

  /**
   * Validate user ID if session has one set
   */
  private validateUserId(session: Session, userId?: string): void {
    if (session.userId !== undefined) {
      if (userId === undefined || session.userId !== userId) {
        throw new UserIdMismatchError(session.id);
      }
    }
  }

  async create(userId?: string): Promise<Session> {
    const id = await this.generateUniqueId();
    const now = new Date();

    const session: Session = {
      id,
      userId,
      scratchpad: "",
      todos: [],
      createdAt: now,
      lastModified: now,
    };

    const key = this.getKey(id);
    const data = this.serializeSession(session);

    // SETEX sets value with TTL in one atomic operation
    await this.client.setex(key, this.ttlSeconds, data);

    return session;
  }

  async get(sessionId: string, userId?: string): Promise<Session | null> {
    const key = this.getKey(sessionId);
    const data = await this.client.get(key);

    if (!data) {
      return null;
    }

    const session = this.deserializeSession(data);

    // Validate user ID
    this.validateUserId(session, userId);

    return session;
  }

  async update(
    sessionId: string,
    updates: Partial<Omit<Session, "id" | "createdAt">>,
    userId?: string
  ): Promise<void> {
    const session = await this.get(sessionId, userId);

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // Apply updates
    const updatedSession: Session = {
      ...session,
      ...updates,
      lastModified: new Date(),
    };

    const key = this.getKey(sessionId);
    const data = this.serializeSession(updatedSession);

    // Get remaining TTL and set with updated data
    const ttl = await this.client.ttl(key);
    const newTtl = ttl > 0 ? ttl : this.ttlSeconds;

    await this.client.setex(key, newTtl, data);
  }

  async delete(sessionId: string, userId?: string): Promise<void> {
    const session = await this.get(sessionId, userId);

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    const key = this.getKey(sessionId);
    await this.client.del(key);
  }

  async exists(sessionId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const result = await this.client.exists(key);
    return result === 1;
  }

  async count(): Promise<number> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.client.keys(pattern);
    return keys.length;
  }

  /**
   * Cleanup is handled automatically by Redis TTL
   * This method is a no-op for Redis but kept for interface compatibility
   */
  async cleanup(): Promise<number> {
    // Redis handles TTL-based expiration automatically
    // No manual cleanup needed
    return 0;
  }

  /**
   * No background cleanup needed for Redis (uses native TTL)
   * Kept for interface compatibility
   */
  startCleanup(): void {
    console.log(
      `[RedisSessionStore] Using native Redis TTL (${this.ttlSeconds}s) - no background cleanup needed`
    );
  }

  /**
   * No background cleanup to stop for Redis
   * Kept for interface compatibility
   */
  stopCleanup(): void {
    // No-op for Redis
  }

  /**
   * Clear all sessions (useful for testing)
   */
  async clear(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    const keys = await this.client.keys(pattern);

    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
