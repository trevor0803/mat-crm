export type Client = {
  id: number;
  business_name: string;
  uses_ghl: boolean;
  retainer: number;
  bill_date: string | null;
  active: boolean;
  billing_method: string | null;
  ad_spend_dates: string | null;
  created_at: string;
};

export type ClientFormValues = {
  business_name: string;
  uses_ghl: boolean;
  retainer: number;
  bill_date: string | null;
  active: boolean;
  billing_method: string | null;
  ad_spend_dates: string | null;
};

export const BILLING_METHOD_PRESETS = ["PayPal", "Stripe", "Chase Link"] as const;

export function parseBillDays(billDate: string | null | undefined): number[] {
  if (!billDate) return [];
  return billDate
    .split("/")
    .map((part) => part.trim().toLowerCase().replace(/(st|nd|rd|th)$/i, "").trim())
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
}

export function formatCurrency(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

// Returns the day-of-month for each date in [today, today+7], paired with
// how many days from today that date is (0 = today, 7 = a week out).
export function upcomingWindow(today: Date = new Date()): Array<{ day: number; daysUntil: number }> {
  const out: Array<{ day: number; daysUntil: number }> = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    out.push({ day: d.getDate(), daysUntil: i });
  }
  return out;
}

// For a given client, returns the closest daysUntil their bill day falls
// within the 7-day window, or null if none match.
export function daysUntilNextBill(
  billDate: string | null,
  window: Array<{ day: number; daysUntil: number }>,
): number | null {
  const days = parseBillDays(billDate);
  if (days.length === 0) return null;
  let best: number | null = null;
  for (const w of window) {
    if (days.includes(w.day) && (best === null || w.daysUntil < best)) {
      best = w.daysUntil;
    }
  }
  return best;
}
