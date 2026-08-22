/**
 * Module state that has to survive being loaded more than once.
 *
 * Next.js does not give you one module graph. `instrumentation.ts` is its own
 * entry point, each route handler is bundled separately, and dev-mode hot
 * reload re-evaluates modules on edit. A `const registry = new Map()` at module
 * scope is therefore not one map — it is one map *per bundle*, and code that
 * registers into it from one entry point is invisible to code that reads it
 * from another.
 *
 * That failure is silent, which is what makes it dangerous: a subscriber
 * registered in the instrumentation bundle simply never fires for a request
 * handled by a route bundle. No error, no log, no row. It cost this project a
 * completely inert audit trail — `emit()` was called correctly on every login
 * and found nobody listening.
 *
 * Anchoring the registry to `globalThis` gives one instance per *process*,
 * which is what these registries actually mean.
 */
export function globalSingleton<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, T | undefined>;
  const existing = store[key];
  if (existing !== undefined) return existing;

  const value = create();
  store[key] = value;
  return value;
}
