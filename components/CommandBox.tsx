"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CornerDownLeft,
  Loader2,
  Mic,
  Square,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  emitCrmChanged,
  formatDateLong,
  toLocalDateString,
  type ExecuteResponse,
  type ParseResponse,
  type PlannedAction,
} from "@/lib/command";

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const EXAMPLES = [
  "add a task for McGrath Plumbing to check the landing page due tomorrow for Trevor",
  "mark the McGrath landing page task done",
  "note on McGrath: they want to pause ads in September",
  "what's due today?",
];

type Phase = "idle" | "listening" | "parsing" | "preview" | "saving";

// How long a gap in speech has to be before the recording is treated as
// finished. Long enough to think mid-sentence, short enough to feel instant.
const SILENCE_MS = 3500;
// Safety net so a misbehaving mic can't restart in a tight loop forever.
const MAX_RESTARTS = 40;

export function CommandBox() {
  const router = useRouter();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<ParseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Text already in the box when the mic started, so dictation appends
  // rather than replacing what was typed.
  const baseTextRef = useRef("");
  // Finalised speech from earlier recognition sessions in this same recording
  // (Chrome ends a session on its own; we restart and keep stacking).
  const committedRef = useRef("");
  const heardRef = useRef("");
  // Cleared when the user stops the mic by hand, so cancelling doesn't submit.
  const autoSubmitRef = useRef(true);
  // While true, an unexpected `onend` restarts recognition instead of finishing.
  const keepAliveRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartsRef = useRef(0);

  const busy = phase === "parsing" || phase === "saving";

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
    );
  }, []);

  // Cmd/Ctrl+K from anywhere focuses the box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Stop any in-flight dictation if the component goes away.
  useEffect(() => {
    return () => {
      autoSubmitRef.current = false;
      keepAliveRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  const submit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setPhase("parsing");
    setError(null);
    setPlan(null);

    const now = new Date();
    try {
      const res = await fetch("/api/command/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          today: toLocalDateString(now),
          weekday: WEEKDAYS[now.getDay()],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Couldn't read that command.");
        setPhase("idle");
        return;
      }
      const parsed = data as ParseResponse;
      setPlan(parsed);
      setPhase("preview");
      if (parsed.actions.length === 0 && !parsed.answer && !parsed.note) {
        setError("I couldn't turn that into a CRM change. Try naming the client and what to do.");
        setPhase("idle");
      }
    } catch {
      setError("Network error — check your connection and try again.");
      setPhase("idle");
    }
  }, []);

  /* ---------------------------- dictation ---------------------------- */

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // Restarted on every phrase. Only a genuine SILENCE_MS gap ends the recording,
  // so thinking mid-sentence doesn't cut you off.
  function armSilenceTimer() {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      keepAliveRef.current = false;
      recognitionRef.current?.stop();
    }, SILENCE_MS);
  }

  function buildRecognition(): SpeechRecognitionLike | null {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return null;

    const rec = new Ctor();
    rec.lang = "en-US";
    // continuous keeps the session open across pauses; without it Chrome ends
    // the moment you take a breath.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let out = "";
      for (let i = 0; i < event.results.length; i++) {
        out += event.results[i][0].transcript;
      }
      heardRef.current = out;
      setText(baseTextRef.current + committedRef.current + out);
      armSilenceTimer();
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" just means a quiet stretch — onend will restart us.
      if (event.error === "no-speech" || event.error === "aborted") return;
      keepAliveRef.current = false;
      autoSubmitRef.current = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow it in the address bar, then try again.");
      } else if (event.error === "audio-capture") {
        setError("No microphone found. Check it's plugged in and selected in Windows.");
      } else {
        setError(`Microphone error: ${event.error}`);
      }
    };

    rec.onend = () => {
      // Chrome ends the session on its own every so often. If the user hasn't
      // stopped and the silence timer hasn't fired, pick straight back up.
      if (keepAliveRef.current && restartsRef.current < MAX_RESTARTS) {
        restartsRef.current += 1;
        if (heardRef.current.trim()) {
          committedRef.current = `${committedRef.current}${heardRef.current.trim()} `;
          heardRef.current = "";
        }
        const next = buildRecognition();
        if (next) {
          recognitionRef.current = next;
          try {
            next.start();
            return;
          } catch {
            /* fall through to finishing below */
          }
        }
      }

      clearSilenceTimer();
      recognitionRef.current = null;
      keepAliveRef.current = false;
      setPhase((p) => (p === "listening" ? "idle" : p));
      const heard = `${committedRef.current}${heardRef.current}`.trim();
      if (autoSubmitRef.current && heard) {
        void submit(baseTextRef.current + heard);
      }
    };

    return rec;
  }

  function startListening() {
    const rec = buildRecognition();
    if (!rec) return;

    baseTextRef.current = text.trim() ? `${text.trim()} ` : "";
    committedRef.current = "";
    heardRef.current = "";
    autoSubmitRef.current = true;
    keepAliveRef.current = true;
    restartsRef.current = 0;

    recognitionRef.current = rec;
    setError(null);
    setPhase("listening");
    try {
      rec.start();
      armSilenceTimer();
    } catch {
      recognitionRef.current = null;
      keepAliveRef.current = false;
      clearSilenceTimer();
      setPhase("idle");
      setError("Couldn't start the microphone. Try again.");
    }
  }

  function stopListening(submitWhatWasHeard: boolean) {
    autoSubmitRef.current = submitWhatWasHeard;
    keepAliveRef.current = false;
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }

  /* ------------------------------ editing ----------------------------- */

  function patchPayload(actionId: string, patch: Record<string, unknown>) {
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            actions: prev.actions.map((a) =>
              a.id === actionId ? { ...a, payload: { ...a.payload, ...patch } } : a,
            ),
          }
        : prev,
    );
  }

  function dropAction(actionId: string) {
    setPlan((prev) => {
      if (!prev) return prev;
      const actions = prev.actions.filter((a) => a.id !== actionId);
      if (actions.length === 0 && !prev.answer) return null;
      return { ...prev, actions };
    });
  }

  function discard() {
    setPlan(null);
    setError(null);
    setPhase("idle");
  }

  /* ------------------------------ saving ------------------------------ */

  async function save() {
    if (!plan || plan.actions.length === 0) return;
    setPhase("saving");
    try {
      const res = await fetch("/api/command/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actions: plan.actions.map((a) => ({ id: a.id, kind: a.kind, payload: a.payload })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Failed to save.");
        setPhase("preview");
        return;
      }

      const result = data as ExecuteResponse;
      for (const r of result.results) {
        if (r.ok) toast.success(r.message);
        else toast.error(r.message);
      }

      if (result.ok) {
        setPlan(null);
        setText("");
        setPhase("idle");
      } else {
        // Keep the failures on screen so they can be fixed and retried.
        setPlan((prev) =>
          prev
            ? {
                ...prev,
                actions: prev.actions.filter(
                  (a) => result.results.find((r) => r.id === a.id)?.ok === false,
                ),
              }
            : prev,
        );
        setPhase("preview");
      }

      emitCrmChanged();
      router.refresh();
    } catch {
      setError("Network error while saving. Nothing may have been written — check before retrying.");
      setPhase("preview");
    }
  }

  /* ------------------------------ render ------------------------------ */

  const listening = phase === "listening";

  return (
    <div className="border-b border-brand-card bg-brand-navy/80">
      <div className="mx-auto w-full max-w-6xl px-6 py-3">
        <div
          className={`flex items-start gap-2 rounded-xl border bg-brand-card px-3 py-2 transition-colors ${
            listening
              ? "border-red-500/60 ring-1 ring-red-500/30"
              : "border-white/10 focus-within:border-brand-gold/50"
          }`}
        >
          <Sparkles className="mt-2 h-4 w-4 shrink-0 text-brand-gold" aria-hidden />

          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(text);
              }
              if (e.key === "Escape") discard();
            }}
            placeholder={
              listening
                ? "Listening… say what you need"
                : "Tell the CRM what to do — e.g. add a task for McGrath Plumbing to check the landing page due tomorrow"
            }
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none disabled:opacity-60"
          />

          {speechSupported && (
            <button
              type="button"
              onClick={() => (listening ? stopListening(true) : startListening())}
              disabled={busy}
              title={listening ? "Stop and run it" : "Speak your command"}
              aria-label={listening ? "Stop recording" : "Start recording"}
              className={`mt-0.5 rounded-lg p-2 transition-colors disabled:opacity-40 ${
                listening
                  ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                  : "text-gray-400 hover:bg-white/10 hover:text-brand-gold"
              }`}
            >
              {listening ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => void submit(text)}
            disabled={busy || listening || text.trim() === ""}
            title="Run (Enter)"
            aria-label="Run command"
            className="mt-0.5 rounded-lg bg-brand-gold/15 p-2 text-brand-gold transition-colors hover:bg-brand-gold/25 disabled:opacity-30"
          >
            {phase === "parsing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {listening && (
          <div className="mt-1.5 flex items-center gap-2 px-1 text-xs text-red-300">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
            Listening — take your time. Stops after a few seconds of quiet, or hit the
            square to run it now.
            <button
              type="button"
              onClick={() => stopListening(false)}
              className="text-gray-400 underline underline-offset-2 hover:text-gray-200"
            >
              cancel
            </button>
          </div>
        )}

        {!listening && !plan && !error && phase === "idle" && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
            <span className="text-xs text-gray-500">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setText(ex);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-gray-400 transition-colors hover:border-brand-gold/40 hover:text-brand-gold"
              >
                {ex.length > 46 ? `${ex.slice(0, 44)}…` : ex}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="text-red-300/70 hover:text-red-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {plan && (plan.actions.length > 0 || plan.answer || plan.note) && (
          <div className="mt-3 space-y-2">
            {plan.answer && (
              <div className="rounded-xl border border-brand-gold/30 bg-brand-card px-4 py-3">
                <p className="whitespace-pre-wrap text-sm text-gray-200">{plan.answer}</p>
                <button
                  type="button"
                  onClick={discard}
                  className="mt-2 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-300"
                >
                  Dismiss
                </button>
              </div>
            )}

            {plan.note && plan.actions.length > 0 && (
              <p className="px-1 text-xs text-gray-400">{plan.note}</p>
            )}

            {plan.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                clients={plan.clients}
                team={plan.team}
                disabled={phase === "saving"}
                onPatch={(patch) => patchPayload(action.id, patch)}
                onDrop={() => dropAction(action.id)}
              />
            ))}

            {plan.actions.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={phase === "saving"}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-brand-navy transition-opacity hover:brightness-110 disabled:opacity-60"
                >
                  {phase === "saving" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {phase === "saving"
                    ? "Saving…"
                    : plan.actions.length === 1
                      ? "Save"
                      : `Save all ${plan.actions.length}`}
                </button>
                <button
                  type="button"
                  onClick={discard}
                  disabled={phase === "saving"}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-60"
                >
                  Discard
                </button>
                <span className="text-xs text-gray-500">Nothing is saved until you hit Save.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */

type ActionCardProps = {
  action: PlannedAction;
  clients: ParseResponse["clients"];
  team: ParseResponse["team"];
  disabled: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onDrop: () => void;
};

function ActionCard({ action, clients, team, disabled, onPatch, onDrop }: ActionCardProps) {
  const editable = action.kind === "create_task";
  const p = action.payload;

  return (
    <div
      className={`rounded-xl border bg-brand-card px-4 py-3 ${
        action.destructive ? "border-red-500/40" : "border-white/10"
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            action.destructive
              ? "bg-red-500/15 text-red-300"
              : "bg-brand-gold/15 text-brand-gold"
          }`}
        >
          {action.title}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDrop}
          disabled={disabled}
          title="Remove this change"
          aria-label="Remove this change"
          className="text-gray-500 transition-colors hover:text-red-300 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {editable ? (
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={String(p.title ?? "")}
            disabled={disabled}
            onChange={(e) => onPatch({ title: e.target.value })}
            aria-label="Task title"
            className="w-full rounded-lg border border-white/10 bg-brand-navy px-3 py-2 text-sm font-medium text-gray-100 focus:border-brand-gold/50 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Client">
              {typeof p.new_client_name === "string" && p.new_client_name && !p.client_id ? (
                // Attached to a client this same command is creating — it has
                // no id to pick from the list yet.
                <div
                  className={`${SELECT_CLASS} truncate text-brand-gold`}
                  title={`${p.new_client_name} — being created by this command`}
                >
                  {p.new_client_name} (new)
                </div>
              ) : (
                <select
                  value={
                    p.client_id === null || p.client_id === undefined ? "" : String(p.client_id)
                  }
                  disabled={disabled}
                  onChange={(e) =>
                    onPatch({
                      client_id: e.target.value === "" ? null : Number(e.target.value),
                      new_client_name: null,
                    })
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.business_name}
                      {c.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Assigned to">
              <select
                value={p.assignee_id === undefined ? "" : String(p.assignee_id)}
                disabled={disabled}
                onChange={(e) => onPatch({ assignee_id: Number(e.target.value) })}
                className={SELECT_CLASS}
              >
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due">
              <input
                type="date"
                value={(p.due_date as string | null) ?? ""}
                disabled={disabled}
                onChange={(e) => onPatch({ due_date: e.target.value === "" ? null : e.target.value })}
                className={SELECT_CLASS}
              />
            </Field>
            <Field label="Priority">
              <select
                value={String(p.priority ?? "medium")}
                disabled={disabled}
                onChange={(e) => onPatch({ priority: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          </div>
          {typeof p.description === "string" && p.description !== "" && (
            <p className="text-xs text-gray-400">{p.description}</p>
          )}
          {p.due_date ? (
            <p className="text-xs text-gray-500">{formatDateLong(p.due_date as string)}</p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-1.5 text-sm font-medium text-gray-100">{action.summary}</p>
          {action.fields.length > 0 && (
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {action.fields.map((f) => (
                <div key={f.label} className="flex gap-2 text-xs">
                  <dt className="shrink-0 text-gray-500">{f.label}</dt>
                  <dd className="truncate text-gray-300">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {action.warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {action.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-xs text-amber-300/90">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SELECT_CLASS =
  "w-full rounded-lg border border-white/10 bg-brand-navy px-2 py-1.5 text-xs text-gray-100 focus:border-brand-gold/50 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}
