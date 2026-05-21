"use client";

import Link from "next/link";
import { CheckCircle2, Circle, Pencil, Trash2 } from "lucide-react";
import {
  Task,
  dueDateBadge,
  priorityColor,
  priorityLabel,
} from "@/lib/tasks";

type TaskListProps = {
  tasks: Task[];
  loading: boolean;
  emptyMessage?: string;
  hideClientLink?: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
};

export function TaskList({
  tasks,
  loading,
  emptyMessage = "No tasks. Click '+ New Task' to add one.",
  hideClientLink = false,
  onToggle,
  onEdit,
  onDelete,
}: TaskListProps) {
  if (loading) {
    return (
      <div className="overflow-hidden rounded-lg border border-white/5 bg-brand-card">
        <SkeletonRows count={4} />
      </div>
    );
  }
  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/5 bg-brand-card">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          hideClientLink={hideClientLink}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TaskRow({
  task,
  hideClientLink,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task;
  hideClientLink: boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const isDone = task.status === "done";
  const badge = dueDateBadge(task.due_date, task.status);

  return (
    <div className="group flex items-start gap-3 px-4 py-3 hover:bg-white/5">
      <button
        type="button"
        onClick={() => onToggle(task)}
        aria-label={isDone ? `Mark '${task.title}' as pending` : `Mark '${task.title}' as done`}
        className="mt-0.5 shrink-0 rounded text-gray-400 hover:text-brand-gold"
      >
        {isDone ? (
          <CheckCircle2 className="h-5 w-5 text-brand-gold" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>

      <div className={`min-w-0 flex-1 ${isDone ? "opacity-60" : ""}`}>
        <div
          className={`truncate font-semibold text-gray-100 ${
            isDone ? "line-through" : ""
          }`}
        >
          {task.title}
        </div>
        {task.description && (
          <div
            className={`mt-0.5 text-sm text-gray-400 ${isDone ? "line-through" : ""}`}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {task.description}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${priorityColor(
              task.priority,
            )}`}
          >
            {priorityLabel(task.priority)}
          </span>
          <span className="text-gray-400">{task.assignee_name}</span>
          {!hideClientLink && task.client_id !== null && task.business_name && (
            <Link
              href={`/clients/${task.client_id}`}
              className="text-brand-gold hover:underline"
            >
              {task.business_name}
            </Link>
          )}
          {badge && <DueBadgePill text={badge.text} variant={badge.variant} />}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(task)}
          aria-label={`Edit ${task.title}`}
          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-brand-gold"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(task)}
          aria-label={`Delete ${task.title}`}
          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DueBadgePill({
  text,
  variant,
}: {
  text: string;
  variant: "overdue" | "today" | "upcoming";
}) {
  const classes =
    variant === "overdue"
      ? "bg-red-500/15 text-red-300"
      : variant === "today"
        ? "bg-brand-gold/15 text-brand-gold"
        : "bg-white/10 text-gray-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${classes}`}
    >
      {text}
    </span>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-white/5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3">
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="h-4 flex-1 animate-pulse rounded bg-white/5" />
          ))}
        </div>
      ))}
    </div>
  );
}
