export type Priority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "done";
export type TaskCategory = "work" | "billing";

export type Task = {
  id: number;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  category: TaskCategory;
  client_id: number | null;
  business_name: string | null;
  assignee_id: number;
  assignee_name: string;
  created_at: string;
  completed_at: string | null;
};

export type TeamMember = {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
};

export function priorityLabel(p: Priority): string {
  if (p === "low") return "Low";
  if (p === "high") return "High";
  return "Medium";
}

// Tailwind classes for the priority pill background + text color.
export function priorityColor(p: Priority): string {
  if (p === "low") return "bg-white/10 text-gray-300";
  if (p === "high") return "bg-red-500/15 text-red-300";
  return "bg-brand-gold/15 text-brand-gold";
}

export type DueBadge = { text: string; variant: "overdue" | "today" | "upcoming" };

// Parses a YYYY-MM-DD due_date string as a local date (midnight),
// so that comparing it against today's midnight gives accurate day deltas.
function parseDueDateLocal(due: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function formatMonthDay(d: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// Returns badge info for a task's due date relative to `now`.
// - Overdue (pending + past due): "Overdue · MMM d"
// - Due today: "Due today"
// - Upcoming: "Due MMM d"
// - No due date: null
export function dueDateBadge(
  due: string | null,
  status: TaskStatus,
  now: Date = new Date(),
): DueBadge | null {
  if (!due) return null;
  const dueDate = parseDueDateLocal(due);
  if (!dueDate) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = dueDate.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffDays < 0 && status === "pending") {
    return { text: `Overdue · ${formatMonthDay(dueDate)}`, variant: "overdue" };
  }
  if (diffDays === 0) {
    return { text: "Due today", variant: "today" };
  }
  return { text: `Due ${formatMonthDay(dueDate)}`, variant: "upcoming" };
}
