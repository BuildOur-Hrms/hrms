import { z } from "zod";

/**
 * The settings catalog (docs/03-modules-platform-and-reports.md, Module 23).
 *
 * Every key is declared here with its scope, zod shape and default. Modules
 * read settings through typed accessors so a value that drifts out of shape in
 * the database is rejected at read time rather than surfacing as a strange
 * calculation three screens away.
 *
 * `global` keys are platform-wide and only `super_admin` may write them.
 * `company` keys are per-tenant and `hr_admin` may write them.
 */

export const SETTINGS_CATALOG = {
  "general.timezone": {
    scope: "company",
    schema: z.string().min(1).max(64),
    default: "Asia/Kolkata",
    group: "general",
    label: "Timezone",
  },
  "general.currency": {
    scope: "company",
    schema: z.string().length(3),
    default: "INR",
    group: "general",
    label: "Currency",
  },
  "general.date_format": {
    scope: "company",
    schema: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
    default: "DD/MM/YYYY",
    group: "general",
    label: "Date format",
  },
  "general.working_days": {
    scope: "company",
    schema: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    default: [1, 2, 3, 4, 5],
    group: "general",
    label: "Working days",
  },
  "general.leave_year_start_month": {
    scope: "company",
    schema: z.number().int().min(1).max(12),
    default: 1,
    group: "general",
    label: "Leave year starts in",
  },

  "attendance.join_mid_month_cutoff_day": {
    scope: "company",
    schema: z.number().int().min(1).max(28),
    default: 15,
    group: "attendance",
    label: "Mid-month joiner cutoff day",
  },
  "attendance.missing_checkout_policy": {
    scope: "company",
    schema: z.enum(["flag_only", "half_day", "absent"]),
    default: "flag_only",
    group: "attendance",
    label: "Missing check-out policy",
  },
  "attendance.auto_absent_after_days": {
    scope: "company",
    schema: z.number().int().min(0).max(31),
    default: 1,
    group: "attendance",
    label: "Mark absent after (days)",
  },

  "leave.sandwich_rule_default": {
    scope: "company",
    schema: z.boolean(),
    default: false,
    group: "leave",
    label: "Sandwich rule by default",
  },
  "leave.allow_negative_balance": {
    scope: "company",
    schema: z.boolean(),
    default: false,
    group: "leave",
    label: "Allow negative leave balance",
  },

  /**
   * How much notice somebody owes when they resign.
   *
   * The company default. An employee's own record may override it, because
   * senior contracts routinely say something different from the handbook.
   */
  "offboarding.notice_period_days": {
    scope: "company",
    schema: z.number().int().min(0).max(180),
    default: 30,
    group: "leave",
    label: "Notice period (days)",
  },

  "security.password_min_length": {
    scope: "global",
    schema: z.number().int().min(8).max(64),
    default: 10,
    group: "security",
    label: "Minimum password length",
  },
  "security.lockout_threshold": {
    scope: "global",
    schema: z.number().int().min(3).max(20),
    default: 5,
    group: "security",
    label: "Failed logins before lockout",
  },
  /**
   * Not in the published catalog table; added because docs/09-security.md §2
   * specifies a 15-minute lock with progressive doubling and that duration has
   * to live somewhere configurable.
   */
  "security.lockout_minutes": {
    scope: "global",
    schema: z.number().int().min(1).max(1440),
    default: 15,
    group: "security",
    label: "Lockout duration (minutes)",
  },
  "security.session_hours": {
    scope: "global",
    schema: z.number().int().min(1).max(168),
    default: 12,
    group: "security",
    label: "Session length (hours)",
  },

  "notifications.email_enabled": {
    scope: "company",
    schema: z.boolean(),
    default: true,
    group: "notifications",
    label: "Send notification emails",
  },
  /**
   * Which notices also go out by email, as event keys
   * (docs/07-workflows-and-automation.md §3).
   *
   * A list rather than a boolean per event: the set is small, it changes as
   * modules land, and one row a company can narrow beats a dozen switches
   * nobody will ever find. Everything not named here is in-app only.
   *
   * The default is the catalog's own answer to "does this ask the recipient
   * to do something they cannot see from the app they are not in". An
   * approval waiting on you does. Somebody's birthday does not.
   */
  "notifications.email_events": {
    scope: "company",
    schema: z.array(z.string().trim().min(1).max(60)).max(50),
    default: [
      "leave.requested",
      "leave.reviewed",
      "attendance.correction_requested",
      "attendance.correction_reviewed",
      "attendance.absent_no_leave",
      "probation.ending",
    ],
    group: "notifications",
    label: "Events that also send an email",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS_CATALOG;

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_CATALOG)[K]["schema"]>;

export type SettingScope = "global" | "company";

export const SETTING_KEYS = Object.keys(SETTINGS_CATALOG) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTINGS_CATALOG;
}

export function settingScope(key: SettingKey): SettingScope {
  return SETTINGS_CATALOG[key].scope;
}

/** Every default, as the resolved map a caller gets before any override. */
export function defaultSettings(): { [K in SettingKey]: SettingValue<K> } {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    out[key] = SETTINGS_CATALOG[key].default;
  }
  return out as { [K in SettingKey]: SettingValue<K> };
}
