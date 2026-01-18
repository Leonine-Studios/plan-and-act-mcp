import { SessionStore } from "./types.js";
import {
  InMemorySessionStore,
  InMemorySessionStoreConfig,
} from "./InMemorySessionStore.js";
import {
  RedisSessionStore,
  RedisSessionStoreConfig,
} from "./RedisSessionStore.js";

/**
 * Supported storage types
 */
export type StorageType = "memory" | "redis";

/**
 * Configuration for storage factory
 */
export interface StorageFactoryConfig {
  /**
   * Storage type to use
   * @default "memory"
   */
  type: StorageType;

  /**
   * Time-to-live for sessions in hours
   * @default 24
   */
  ttlHours?: number;

  /**
   * Length of generated NanoIDs
   * @default 21
   */
  nanoidLength?: number;

  /**
   * Redis-specific configuration (only used when type is "redis")
   */
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    keyPrefix?: string;
  };
}

/**
 * Result from storage factory
 */
export interface StorageFactoryResult {
  store: SessionStore;
  type: StorageType;
  /**
   * Connect to storage (for Redis)
   */
  connect: () => Promise<void>;
  /**
   * Disconnect from storage (for Redis)
   */
  disconnect: () => Promise<void>;
  /**
   * Get connection status (for health checks)
   */
  isConnected: () => boolean;
}

/**
 * Get storage type from environment
 */
export function getStorageType(): StorageType {
  const type = process.env.STORAGE_TYPE?.toLowerCase();
  if (type === "redis") {
    return "redis";
  }
  return "memory";
}

/**
 * Get storage configuration from environment
 */
export function getStorageConfigFromEnv(): StorageFactoryConfig {
  const type = getStorageType();
  const ttlHours = parseInt(process.env.SESSION_TTL_HOURS || "24", 10);
  const nanoidLength = parseInt(process.env.NANOID_LENGTH || "21", 10);

  const config: StorageFactoryConfig = {
    type,
    ttlHours,
    nanoidLength,
  };

  if (type === "redis") {
    config.redis = {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: process.env.REDIS_KEY_PREFIX || "mcp:session:",
    };
  }

  return config;
}

/**
 * Create a session store based on configuration
 */
export function createSessionStore(
  config: StorageFactoryConfig
): StorageFactoryResult {
  switch (config.type) {
    case "redis": {
      const redisConfig: RedisSessionStoreConfig = {
        host: config.redis?.host,
        port: config.redis?.port,
        password: config.redis?.password,
        keyPrefix: config.redis?.keyPrefix,
        ttlHours: config.ttlHours,
        nanoidLength: config.nanoidLength,
      };

      const store = new RedisSessionStore(redisConfig);

      return {
        store,
        type: "redis",
        connect: () => store.connect(),
        disconnect: () => store.disconnect(),
        isConnected: () => store.getConnectionStatus(),
      };
    }

    case "memory":
    default: {
      const memoryConfig: InMemorySessionStoreConfig = {
        ttlHours: config.ttlHours,
        nanoidLength: config.nanoidLength,
      };

      const store = new InMemorySessionStore(memoryConfig);

      return {
        store,
        type: "memory",
        connect: async () => {
          // No-op for in-memory
        },
        disconnect: async () => {
          // No-op for in-memory
        },
        isConnected: () => true, // Always "connected" for in-memory
      };
    }
  }
}

/**
 * Create session store from environment configuration
 */
export function createSessionStoreFromEnv(): StorageFactoryResult {
  const config = getStorageConfigFromEnv();
  return createSessionStore(config);
}
