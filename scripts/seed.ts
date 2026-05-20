import { sql } from "../lib/db";

type ClientSeed = {
  business_name: string;
  uses_ghl: boolean;
  retainer: number;
  bill_date: string;
  active: boolean;
  billing_method: string;
  ad_spend_dates: string | null;
};

const clients: ClientSeed[] = [
  { business_name: "National Relo",                    uses_ghl: false, retainer: 1000, bill_date: "12th/27th", active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Mcgrath Roofing",                  uses_ghl: false, retainer: 200,  bill_date: "12th",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "JJs Decks",                        uses_ghl: false, retainer: 350,  bill_date: "12th",      active: true,  billing_method: "Stripe",     ad_spend_dates: null },
  { business_name: "Checkmark",                        uses_ghl: false, retainer: 400,  bill_date: "14th",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "464 Cleaning",                     uses_ghl: false, retainer: 300,  bill_date: "23rd",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Palma Landscaping",                uses_ghl: false, retainer: 300,  bill_date: "tbd",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "All in One (Ideal)",               uses_ghl: false, retainer: 250,  bill_date: "1st",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "McGrath Remodel",                  uses_ghl: false, retainer: 300,  bill_date: "1st",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "B&H",                              uses_ghl: true,  retainer: 500,  bill_date: "10th",      active: false, billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Tile Guy",                         uses_ghl: true,  retainer: 600,  bill_date: "21st",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "America Pool Plastering",          uses_ghl: true,  retainer: 400,  bill_date: "16th",      active: true,  billing_method: "Stripe",     ad_spend_dates: null },
  { business_name: "Treasure Coast Thermal Solutions", uses_ghl: true,  retainer: 750,  bill_date: "4th",       active: false, billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Edwins",                           uses_ghl: true,  retainer: 500,  bill_date: "6th",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Get It Done Construction",         uses_ghl: false, retainer: 350,  bill_date: "12th",      active: true,  billing_method: "Chase Link", ad_spend_dates: null },
  { business_name: "Insulflo",                         uses_ghl: true,  retainer: 650,  bill_date: "19th",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Unseen",                           uses_ghl: false, retainer: 1000, bill_date: "28th",      active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Cisco",                            uses_ghl: false, retainer: 300,  bill_date: "28th",      active: false, billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Bowie Hockey",                     uses_ghl: false, retainer: 500,  bill_date: "tbd",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Certified Water Pros",             uses_ghl: true,  retainer: 650,  bill_date: "tbd",       active: true,  billing_method: "paypal",     ad_spend_dates: null },
  { business_name: "Consumer Buzz",                    uses_ghl: true,  retainer: 3006, bill_date: "18th",      active: false, billing_method: "paypal",     ad_spend_dates: "17th-17th" },
  { business_name: "Local Voice Search",               uses_ghl: true,  retainer: 1500, bill_date: "20th",      active: true,  billing_method: "paypal",     ad_spend_dates: "19th-19th" },
  { business_name: "Summit Media",                     uses_ghl: true,  retainer: 300,  bill_date: "5th",       active: true,  billing_method: "paypal",     ad_spend_dates: "4th-4th" },
];

async function seed() {
  let inserted = 0;
  for (const c of clients) {
    const result = await sql`
      INSERT INTO clients
        (business_name, uses_ghl, retainer, bill_date, active, billing_method, ad_spend_dates)
      VALUES
        (${c.business_name}, ${c.uses_ghl}, ${c.retainer}, ${c.bill_date}, ${c.active}, ${c.billing_method}, ${c.ad_spend_dates})
      ON CONFLICT (business_name) DO NOTHING
    `;
    if (result.rowCount && result.rowCount > 0) inserted++;
  }
  console.log(`Seed complete. ${inserted} inserted, ${clients.length - inserted} skipped (already existed).`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
