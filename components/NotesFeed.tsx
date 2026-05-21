"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Note } from "@/lib/notes";

const NOTE_TIMESTAMP_FORMAT = "MMM d, yyyy 'at' h:mm a";

type Props = {
  notes: Note[] | null;
  showBusinessName: boolean;
  emptyMessage?: string;
  className?: string;
};

export function NotesFeed({
  notes,
  showBusinessName,
  emptyMessage,
  className = "",
}: Props) {
  if (notes === null) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg bg-brand-card/60"
          />
        ))}
      </div>
    );
  }
  if (notes.length === 0) {
    const fallback = showBusinessName
      ? "No chatter notes yet."
      : "No notes yet. Post the first one.";
    return (
      <div
        className={`rounded-lg border border-white/5 bg-brand-card p-5 text-sm text-gray-500 ${className}`}
      >
        {emptyMessage ?? fallback}
      </div>
    );
  }
  return (
    <div className={`space-y-3 ${className}`}>
      {notes.map((n) => (
        <article
          key={n.id}
          className="rounded-lg border border-white/5 bg-brand-card p-4"
        >
          <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {showBusinessName ? (
              <Link
                href={`/clients/${n.client_id}`}
                className="text-sm font-semibold text-brand-gold hover:underline"
              >
                {n.business_name}
              </Link>
            ) : (
              <span />
            )}
            <time
              dateTime={n.created_at}
              className="text-xs text-gray-500"
              title={n.created_at}
            >
              {format(new Date(n.created_at), NOTE_TIMESTAMP_FORMAT)}
            </time>
          </header>
          <p className="whitespace-pre-wrap text-sm text-gray-200">{n.note}</p>
        </article>
      ))}
    </div>
  );
}
