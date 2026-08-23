import { withApi } from "@/lib/api";
import { createHoliday, listHolidays } from "@/modules/leave/holidays";
import {
  createHolidaySchema,
  holidayListSchema,
  type CreateHolidayInput,
  type HolidayListInput,
} from "@/modules/leave/validators";

export const runtime = "nodejs";

/** Readable by anyone signed in — the calendar is not a secret. */
export const GET = withApi<Record<string, never>, HolidayListInput>(
  { query: holidayListSchema },
  async ({ ctx, query }) => listHolidays(ctx, query.year, query.locationId),
);

export const POST = withApi<CreateHolidayInput>(
  {
    permission: "holidays.manage",
    body: createHolidaySchema,
    rateLimit: "mutation",
    status: 201,
  },
  async ({ ctx, body }) => createHoliday(ctx, body),
);
