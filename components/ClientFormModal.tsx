"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BILLING_METHOD_PRESETS, Client } from "@/lib/clients";

type Props = {
  open: boolean;
  client?: Client | null; // null/undefined = create; provided = edit
  onClose: () => void;
  onSaved: () => void;
};

type FormState = {
  business_name: string;
  uses_ghl: boolean;
  retainer: string;
  bill_date: string;
  active: boolean;
  billing_method_choice: string; // one of presets or "Other"
  billing_method_other: string;
  ad_spend_dates: string;
};

function initialState(client?: Client | null): FormState {
  if (!client) {
    return {
      business_name: "",
      uses_ghl: false,
      retainer: "",
      bill_date: "",
      active: true,
      billing_method_choice: "PayPal",
      billing_method_other: "",
      ad_spend_dates: "",
    };
  }
  const method = client.billing_method ?? "";
  const isPreset = (BILLING_METHOD_PRESETS as readonly string[]).includes(method);
  return {
    business_name: client.business_name,
    uses_ghl: client.uses_ghl,
    retainer: String(client.retainer),
    bill_date: client.bill_date ?? "",
    active: client.active,
    billing_method_choice: method === "" ? "PayPal" : isPreset ? method : "Other",
    billing_method_other: isPreset || method === "" ? "" : method,
    ad_spend_dates: client.ad_spend_dates ?? "",
  };
}

export function ClientFormModal({ open, client, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => initialState(client));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!client;

  useEffect(() => {
    if (open) {
      setForm(initialState(client));
      setError(null);
      setSubmitting(false);
    }
  }, [open, client]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = form.business_name.trim();
    if (!name) {
      setError("Business name is required.");
      return;
    }
    const retainerNum = Number(form.retainer);
    if (!Number.isFinite(retainerNum) || retainerNum < 0) {
      setError("Retainer must be a non-negative number.");
      return;
    }

    const method =
      form.billing_method_choice === "Other"
        ? form.billing_method_other.trim() || null
        : form.billing_method_choice;

    const payload = {
      business_name: name,
      uses_ghl: form.uses_ghl,
      retainer: retainerNum,
      bill_date: form.bill_date.trim() === "" ? null : form.bill_date.trim(),
      active: form.active,
      billing_method: method,
      ad_spend_dates: form.ad_spend_dates.trim() === "" ? null : form.ad_spend_dates.trim(),
    };

    setSubmitting(true);
    try {
      const url = isEdit ? `/api/clients/${client!.id}` : "/api/clients";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.error ?? `Request failed (${res.status})`;
        setError(message);
        toast.error(message);
        setSubmitting(false);
        return;
      }
      onSaved();
      onClose();
      toast.success(isEdit ? `Updated ${name}` : `Created ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div className="relative flex min-h-full w-full max-w-lg flex-col border-white/10 bg-brand-card p-6 shadow-2xl sm:my-8 sm:min-h-0 sm:rounded-lg sm:border">
        <h3 className="text-lg font-semibold text-brand-gold">
          {isEdit ? "Edit Client" : "New Client"}
        </h3>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Business Name" required>
            <input
              type="text"
              value={form.business_name}
              onChange={(e) => update("business_name", e.target.value)}
              className={inputClass}
              required
              autoFocus
            />
          </Field>

          <Toggle
            label="Uses GHL"
            checked={form.uses_ghl}
            onChange={(v) => update("uses_ghl", v)}
          />

          <Field label="Retainer" required>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                $
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.retainer}
                onChange={(e) => update("retainer", e.target.value)}
                className={`${inputClass} pl-7`}
                required
              />
            </div>
          </Field>

          <Field label="Bill Date">
            <input
              type="text"
              value={form.bill_date}
              onChange={(e) => update("bill_date", e.target.value)}
              placeholder="e.g., 12th or 1st/15th or tbd"
              className={inputClass}
            />
          </Field>

          <Toggle
            label="Active"
            checked={form.active}
            onChange={(v) => update("active", v)}
          />

          <Field label="Billing Method">
            <select
              value={form.billing_method_choice}
              onChange={(e) => update("billing_method_choice", e.target.value)}
              className={inputClass}
            >
              {BILLING_METHOD_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="Other">Other</option>
            </select>
            {form.billing_method_choice === "Other" && (
              <input
                type="text"
                value={form.billing_method_other}
                onChange={(e) => update("billing_method_other", e.target.value)}
                placeholder="Custom billing method"
                className={`${inputClass} mt-2`}
              />
            )}
          </Field>

          <Field label="Ad Spend Dates">
            <input
              type="text"
              value={form.ad_spend_dates}
              onChange={(e) => update("ad_spend_dates", e.target.value)}
              placeholder="e.g., 17th-17th, leave blank if none"
              className={inputClass}
            />
          </Field>

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-white/10 px-4 py-2 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-brand-gold px-4 py-2 text-sm font-semibold text-brand-navy hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-white/10 bg-brand-navy px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-brand-gold focus:outline-none focus:ring-1 focus:ring-brand-gold";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
        {required && <span className="ml-0.5 text-brand-gold">*</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-brand-gold" : "bg-white/10"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
