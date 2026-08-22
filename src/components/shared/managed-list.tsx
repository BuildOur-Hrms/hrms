"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api-client";

/**
 * The shape shared by locations, departments and designations: a flat list of
 * org rows with an add / edit / delete dialog and a usage count that blocks
 * deletion. Three near-identical screens are one component rather than three
 * copies that drift apart.
 */

export interface ManagedColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

export interface ManagedListProps<T extends { id: string }> {
  /** Resource path under /api/v1, e.g. "departments". */
  resource: string;
  queryKey: readonly unknown[];
  columns: ManagedColumn<T>[];
  /** Renders the add/edit form. Receives the row when editing. */
  renderForm: (props: {
    row: T | null;
    onSubmit: (values: Record<string, unknown>) => Promise<void>;
    submitting: boolean;
    onCancel: () => void;
  }) => React.ReactNode;
  singular: string;
  plural: string;
  emptyIcon?: LucideIcon;
  emptyDescription?: string;
  canManage: boolean;
  /** Rows still in use cannot be deleted; the server refuses too. */
  usageCount?: (row: T) => number;
  rowLabel: (row: T) => string;
}

export function ManagedList<T extends { id: string }>({
  resource,
  queryKey,
  columns,
  renderForm,
  singular,
  plural,
  emptyIcon,
  emptyDescription,
  canManage,
  usageCount,
  rowLabel,
}: ManagedListProps<T>) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.get<T[]>(`/${resource}`, undefined, signal),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const save = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (editing) return api.patch(`/${resource}/${editing.id}`, values);
      return api.post(`/${resource}`, values);
    },
    onSuccess: () => {
      toast.success(editing ? `${singular} updated` : `${singular} added`);
      setDialogOpen(false);
      setEditing(null);
      void invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/${resource}/${id}`),
    onSuccess: () => {
      toast.success(`${singular} removed`);
      setDeleting(null);
      void invalidate();
    },
    onError: (e: unknown) => {
      toast.error(
        e instanceof Error ? e.message : `Could not remove this ${singular.toLowerCase()}`,
      );
      setDeleting(null);
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add {singular.toLowerCase()}
          </Button>
        </div>
      ) : null}

      {error ? (
        <EmptyState
          title={`Could not load ${plural.toLowerCase()}`}
          description={error instanceof Error ? error.message : undefined}
        />
      ) : isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border py-12 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          {...(emptyIcon ? { icon: emptyIcon } : {})}
          title={`No ${plural.toLowerCase()} yet`}
          {...(emptyDescription ? { description: emptyDescription } : {})}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column.header} className={column.className}>
                    {column.header}
                  </TableHead>
                ))}
                {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const inUse = usageCount ? usageCount(row) : 0;
                return (
                  <TableRow key={row.id}>
                    {columns.map((column) => (
                      <TableCell key={column.header} className={column.className}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${rowLabel(row)}`}
                            onClick={() => {
                              setEditing(row);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${rowLabel(row)}`}
                            disabled={inUse > 0}
                            title={inUse > 0 ? `${inUse} in use` : undefined}
                            onClick={() => setDeleting(row)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(next) => {
          if (!next) {
            setDialogOpen(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes apply everywhere this is referenced."
                : `Create a new ${singular.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>
          {renderForm({
            row: editing,
            onSubmit: async (values) => {
              await save.mutateAsync(values);
            },
            submitting: save.isPending,
            onCancel: () => {
              setDialogOpen(false);
              setEditing(null);
            },
          })}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting ? rowLabel(deleting) : ""}?</DialogTitle>
            <DialogDescription>
              It is archived rather than erased, so anything that referenced it historically stays
              readable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
