"use client";

import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";

import { ANY, type FilterState, type ReportDefinition } from "./types";

/**
 * The filter bar, drawn from the report's own declaration.
 *
 * Only the controls a report named are rendered, so switching reports keeps
 * the filters that still apply and quietly drops the ones that do not — which
 * is what makes "headcount by department, then absences in that department"
 * two clicks instead of two forms.
 */

interface Option {
  id: string;
  name: string;
}

const STATUSES = ["onboarding", "active", "on_notice", "exited"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"];
const GROUP_BY = ["department", "location", "employmentType", "status"];

function label(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function ReportFilters({
  report,
  filters,
  onChange,
}: {
  report: ReportDefinition;
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
}) {
  const wants = (name: string) => report.filters.includes(name as never);

  // Fetched only when a control needs them, and cached across reports by key.
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: ({ signal }) => api.get<Option[]>("/departments", undefined, signal),
    enabled: wants("department"),
  });
  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: ({ signal }) => api.get<Option[]>("/locations", undefined, signal),
    enabled: wants("location"),
  });
  const leaveTypes = useQuery({
    queryKey: ["leave-types"],
    queryFn: ({ signal }) => api.get<Option[]>("/leave-types", undefined, signal),
    enabled: wants("leaveType"),
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {wants("dateRange") ? (
        <>
          <Field id="from" label="From">
            <Input
              id="from"
              type="date"
              value={filters.from}
              onChange={(event) => onChange({ from: event.target.value })}
            />
          </Field>
          <Field id="to" label="To">
            <Input
              id="to"
              type="date"
              value={filters.to}
              onChange={(event) => onChange({ to: event.target.value })}
            />
          </Field>
        </>
      ) : null}

      {wants("month") ? (
        <Field id="month" label="Month">
          <Input
            id="month"
            type="month"
            value={filters.month}
            onChange={(event) => onChange({ month: event.target.value })}
          />
        </Field>
      ) : null}

      {wants("year") ? (
        <Field id="year" label="Leave year">
          <Input
            id="year"
            type="number"
            min={2000}
            max={2100}
            placeholder={String(new Date().getFullYear())}
            value={filters.year}
            onChange={(event) => onChange({ year: event.target.value })}
          />
        </Field>
      ) : null}

      {wants("department") ? (
        <Picker
          id="departmentId"
          label="Department"
          anyLabel="All departments"
          options={departments.data ?? []}
          value={filters.departmentId}
          onChange={(value) => onChange({ departmentId: value })}
        />
      ) : null}

      {wants("location") ? (
        <Picker
          id="locationId"
          label="Location"
          anyLabel="All locations"
          options={locations.data ?? []}
          value={filters.locationId}
          onChange={(value) => onChange({ locationId: value })}
        />
      ) : null}

      {wants("leaveType") ? (
        <Picker
          id="leaveTypeId"
          label="Leave type"
          anyLabel="All types"
          options={leaveTypes.data ?? []}
          value={filters.leaveTypeId}
          onChange={(value) => onChange({ leaveTypeId: value })}
        />
      ) : null}

      {wants("status") ? (
        <Picker
          id="status"
          label="Status"
          anyLabel="Current employees"
          options={STATUSES.map((s) => ({ id: s, name: label(s) }))}
          value={filters.status}
          onChange={(value) => onChange({ status: value })}
        />
      ) : null}

      {wants("employmentType") ? (
        <Picker
          id="employmentType"
          label="Employment type"
          anyLabel="All types"
          options={EMPLOYMENT_TYPES.map((t) => ({ id: t, name: label(t) }))}
          value={filters.employmentType}
          onChange={(value) => onChange({ employmentType: value })}
        />
      ) : null}

      {wants("groupBy") ? (
        <Picker
          id="groupBy"
          label="Group by"
          anyLabel="No grouping"
          options={GROUP_BY.map((g) => ({ id: g, name: label(g) }))}
          value={filters.groupBy}
          onChange={(value) => onChange({ groupBy: value })}
        />
      ) : null}

      {wants("lateThreshold") ? (
        <Field id="lateThresholdMinutes" label="Late by at least">
          <Input
            id="lateThresholdMinutes"
            type="number"
            min={0}
            max={480}
            placeholder="1 minute"
            value={filters.lateThresholdMinutes}
            onChange={(event) => onChange({ lateThresholdMinutes: event.target.value })}
          />
        </Field>
      ) : null}

      {wants("action") ? (
        <Field id="action" label="Action starts with">
          <Input
            id="action"
            placeholder="employee."
            value={filters.action}
            onChange={(event) => onChange({ action: event.target.value })}
          />
        </Field>
      ) : null}

      {wants("entityType") ? (
        <Field id="entityType" label="Entity">
          <Input
            id="entityType"
            placeholder="employee"
            value={filters.entityType}
            onChange={(event) => onChange({ entityType: event.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label: text,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{text}</Label>
      {children}
    </div>
  );
}

function Picker({
  id,
  label: text,
  anyLabel,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  anyLabel: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const items = Object.fromEntries([
    [ANY, anyLabel],
    ...options.map((option) => [option.id, option.name]),
  ]);

  return (
    <Field id={id} label={text}>
      <Select
        items={items}
        value={value || ANY}
        onValueChange={(next) => onChange(!next || next === ANY ? "" : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
