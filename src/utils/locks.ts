import { Mutex } from "async-mutex";

/**
 * Per-session mutex locks to prevent race conditions
 * when multiple parallel operations modify the same session.
 */
const sessionLocks = new Map<string, Mutex>();

/**
 * Get or create a mutex lock for a session.
 * Use with lock.runExclusive() to ensure atomic read-modify-write operations.
 */
export function getSessionLock(sessionId: string): Mutex {
  let lock = sessionLocks.get(sessionId);
  if (!lock) {
    lock = new Mutex();
    sessionLocks.set(sessionId, lock);
  }
  return lock;
}

/**
 * Remove a session's lock (call when session is deleted to prevent memory leaks).
 */
export function removeSessionLock(sessionId: string): void {
  sessionLocks.delete(sessionId);
}
