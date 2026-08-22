import { withApi } from "@/lib/api";
import { deleteEmergencyContact, updateEmergencyContact } from "@/modules/employees/service";
import {
  contactParamSchema,
  emergencyContactSchema,
  type EmergencyContactInput,
} from "@/modules/employees/validators";

export const runtime = "nodejs";

type Params = { id: string; contactId: string };

export const PATCH = withApi<EmergencyContactInput, Record<string, never>, Params>(
  { body: emergencyContactSchema, params: contactParamSchema, rateLimit: "mutation" },
  async ({ ctx, body, params }) => updateEmergencyContact(ctx, params.id, params.contactId, body),
);

export const DELETE = withApi<Record<string, never>, Record<string, never>, Params>(
  { params: contactParamSchema, rateLimit: "mutation" },
  async ({ ctx, params }) => {
    await deleteEmergencyContact(ctx, params.id, params.contactId);
    return { ok: true };
  },
);
