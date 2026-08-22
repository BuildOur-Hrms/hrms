import type { RequestContext } from "@/lib/context";
import { withPlatform, type TenantTx } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { can } from "@/lib/permissions";
import { logger } from "@/lib/logger";

import {
  SETTINGS_CATALOG,
  SETTING_KEYS,
  type SettingKey,
  type SettingValue,
  defaultSettings,
  isSettingKey,
} from "./catalog";

/**
 * Resolution order for a key: company row → global row → catalog default.
 *
 * Values are cached per company for a few seconds because nearly every request
 * reads at least one setting, and invalidated on write so an HR admin sees
 * their own change immediately.
 */

export type ResolvedSettings = { [K in SettingKey]: SettingValue<K> };

interface CacheEntry {
  value: ResolvedSettings;
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, CacheEntry>();

export function invalidateSettingsCache(companyId?: string): void {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/**
 * A stored value that no longer matches its declared shape is ignored rather
 * than crashing the request: a bad row in one setting should not take down
 * every page that reads settings.
 */
function coerce<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> | undefined {
  const parsed = SETTINGS_CATALOG[key].schema.safeParse(raw);
  if (parsed.success) return parsed.data as SettingValue<K>;
  logger.warn({ key, raw }, "system setting failed its schema — falling back to default");
  return undefined;
}

export async function getSettings(db: TenantTx, companyId: string): Promise<ResolvedSettings> {
  const cached = cache.get(companyId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // The company filter is explicit rather than left to the tenant extension.
  // `login` resolves settings before a tenant context exists and therefore
  // calls this with the UNSCOPED platform client, where nothing is injected —
  // without this, another company's row could override the caller's.
  const rows = await db.systemSetting.findMany({
    where: {
      key: { in: SETTING_KEYS },
      OR: [{ companyId }, { companyId: null }],
    },
    select: { key: true, value: true, companyId: true },
  });

  const resolved = defaultSettings();

  // Globals first, company rows second, so company always wins.
  for (const row of rows.filter((r) => r.companyId === null)) {
    if (!isSettingKey(row.key)) continue;
    const value = coerce(row.key, row.value);
    if (value !== undefined) (resolved as Record<string, unknown>)[row.key] = value;
  }
  for (const row of rows.filter((r) => r.companyId !== null)) {
    if (!isSettingKey(row.key)) continue;
    const value = coerce(row.key, row.value);
    if (value !== undefined) (resolved as Record<string, unknown>)[row.key] = value;
  }

  cache.set(companyId, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

export async function getSetting<K extends SettingKey>(
  db: TenantTx,
  companyId: string,
  key: K,
): Promise<SettingValue<K>> {
  const all = await getSettings(db, companyId);
  return all[key];
}

export async function listSettings(ctx: RequestContext) {
  const resolved = await getSettings(ctx.db, ctx.companyId);
  return SETTING_KEYS.map((key) => ({
    key,
    value: resolved[key],
    group: SETTINGS_CATALOG[key].group,
    label: SETTINGS_CATALOG[key].label,
    scope: SETTINGS_CATALOG[key].scope,
    default: SETTINGS_CATALOG[key].default,
    /** Cosmetic: the UI disables platform-scope keys for company admins. */
    editable: SETTINGS_CATALOG[key].scope === "company" || can(ctx, "platform.manage"),
  }));
}

export async function setSetting(ctx: RequestContext, key: string, rawValue: unknown) {
  if (!isSettingKey(key)) {
    throw new ValidationError(`Unknown setting: ${key}`);
  }

  const definition = SETTINGS_CATALOG[key];

  if (definition.scope === "global" && !can(ctx, "platform.manage")) {
    throw new ForbiddenError("Only a platform administrator can change global settings");
  }

  const parsed = definition.schema.safeParse(rawValue);
  if (!parsed.success) {
    throw new ValidationError(`Invalid value for ${key}`, {
      value: parsed.error.issues.map((i) => i.message),
    });
  }

  // A global key lives on a `company_id IS NULL` row, which the tenant
  // extension refuses to write by design. Super admins reach it through the
  // explicit platform escape instead.
  if (definition.scope === "global") {
    await withPlatform(async (tx) => {
      const row = await tx.systemSetting.findFirst({
        where: { key, companyId: null },
        select: { id: true },
      });
      if (row) {
        await tx.systemSetting.update({
          where: { id: row.id },
          data: { value: parsed.data as never, updatedBy: ctx.userId },
        });
      } else {
        await tx.systemSetting.create({
          data: { companyId: null, key, value: parsed.data as never, updatedBy: ctx.userId },
        });
      }
    });

    invalidateSettingsCache();
    await emitSettingChanged(ctx, key);
    return { key, value: parsed.data };
  }

  const existing = await ctx.db.systemSetting.findFirst({
    where: { key, companyId: ctx.companyId },
    select: { id: true, value: true },
  });

  if (existing) {
    await ctx.db.systemSetting.update({
      where: { id: existing.id },
      data: { value: parsed.data as never, updatedBy: ctx.userId },
    });
  } else {
    await ctx.db.systemSetting.create({
      data: {
        companyId: ctx.companyId,
        key,
        value: parsed.data as never,
        updatedBy: ctx.userId,
      },
    });
  }

  invalidateSettingsCache(ctx.companyId);
  await emitSettingChanged(ctx, key);

  return { key, value: parsed.data };
}

function emitSettingChanged(ctx: RequestContext, key: string) {
  return emit(
    "org.setting_changed",
    { key },
    {
      userId: ctx.userId,
      companyId: ctx.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      db: ctx.db,
    },
  );
}
