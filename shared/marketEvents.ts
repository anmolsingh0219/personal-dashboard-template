// Major market-moving events since 2020, drawn on the market charts. Each event belongs to
// a region: Indian indices show "india" + "global" events, everything else "us" + "global".
// Weekend dates are drawn at the next trading bar.

export type EventKind = "covid" | "rates" | "war" | "tariffs" | "election" | "policy" | "crisis" | "other";
export type EventRegion = "global" | "us" | "india";

export interface MarketEvent {
  date: string;
  region: EventRegion;
  kind: EventKind;
  label: string;
  detail: string;
}

/** Colors are the dark-mode categorical slots from the dataviz palette; every event is also labeled in text. */
export const EVENT_KINDS: Record<EventKind, { label: string; color: string }> = {
  rates: { label: "Central bank", color: "#3987e5" },
  war: { label: "War", color: "#e66767" },
  covid: { label: "COVID", color: "#d55181" },
  tariffs: { label: "Tariffs", color: "#c98500" },
  election: { label: "Election", color: "#9085e9" },
  policy: { label: "Budget & tax", color: "#008300" },
  crisis: { label: "Crisis", color: "#d95926" },
  other: { label: "Other", color: "#199e70" },
};

const INDIA_SYMBOLS = new Set(["^NSEI", "^BSESN", "^NSEBANK"]);

export const regionFor = (symbol: string): Exclude<EventRegion, "global"> =>
  INDIA_SYMBOLS.has(symbol) || /\.(NS|BO)$/i.test(symbol) ? "india" : "us";

export const eventsFor = (symbol: string) => {
  const region = regionFor(symbol);
  return MARKET_EVENTS.filter((e) => e.region === "global" || e.region === region);
};

export const MARKET_EVENTS: MarketEvent[] = [
  // Global
  { date: "2020-02-20", region: "global", kind: "covid", label: "COVID crash", detail: "Global stocks start their fastest fall on record as COVID-19 spreads." },
  { date: "2020-03-11", region: "global", kind: "covid", label: "Pandemic declared", detail: "The WHO declares COVID-19 a pandemic." },
  { date: "2020-11-09", region: "global", kind: "covid", label: "Vaccine news", detail: "Pfizer/BioNTech report over 90% vaccine efficacy." },
  { date: "2022-02-24", region: "global", kind: "war", label: "Russia invades Ukraine", detail: "Oil, gas and gold spike; energy crisis in Europe." },
  { date: "2023-10-07", region: "global", kind: "war", label: "Israel–Hamas war", detail: "Hamas attacks Israel; the war in Gaza begins." },
  { date: "2024-08-05", region: "global", kind: "crisis", label: "Yen carry unwind", detail: "Global selloff as the yen carry trade unwinds; Nikkei −12%." },
  { date: "2025-04-02", region: "global", kind: "tariffs", label: "Liberation Day tariffs", detail: "Sweeping US tariffs on most trading partners, including India." },
  { date: "2025-04-09", region: "global", kind: "tariffs", label: "Tariff pause", detail: "90-day pause on most new US tariffs; global markets rebound." },
  { date: "2025-06-13", region: "global", kind: "war", label: "Israel strikes Iran", detail: "12-day Israel–Iran war; the US strikes Iranian nuclear sites on Jun 22." },
  { date: "2026-02-28", region: "global", kind: "war", label: "US–Iran war begins", detail: "Joint US–Israel strikes on Iran; oil jumps." },
  { date: "2026-03-27", region: "global", kind: "war", label: "Hormuz closed", detail: "Iran's IRGC closes the Strait of Hormuz to US-allied shipping." },
  { date: "2026-05-04", region: "global", kind: "war", label: "Brent peaks at $114", detail: "Oil peaks; major combat ends on May 5." },

  // US (also used for oil and gold)
  { date: "2020-03-16", region: "us", kind: "rates", label: "Fed to 0%", detail: "Emergency cut to 0–0.25% (announced Sunday Mar 15) and restarted QE." },
  { date: "2020-03-23", region: "us", kind: "covid", label: "COVID bottom", detail: "S&P 500 bottoms as the Fed announces unlimited QE." },
  { date: "2020-04-20", region: "us", kind: "crisis", label: "Oil below $0", detail: "WTI futures settle at −$37 a barrel as storage runs out." },
  { date: "2020-11-03", region: "us", kind: "election", label: "US election", detail: "Joe Biden wins the US presidential election." },
  { date: "2022-03-16", region: "us", kind: "rates", label: "Fed starts hiking", detail: "First of 11 hikes in the 2022–23 tightening cycle." },
  { date: "2022-11-30", region: "us", kind: "other", label: "ChatGPT launches", detail: "Kicks off the AI boom that later drives Nvidia and the Nasdaq." },
  { date: "2023-03-10", region: "us", kind: "crisis", label: "SVB collapse", detail: "Silicon Valley Bank fails, setting off regional bank stress." },
  { date: "2023-07-26", region: "us", kind: "rates", label: "Fed's last hike", detail: "Fed funds peak at 5.25–5.50%." },
  { date: "2024-09-18", region: "us", kind: "rates", label: "Fed cuts 50bp", detail: "First Fed cut since 2020." },
  { date: "2024-11-05", region: "us", kind: "election", label: "US election", detail: "Donald Trump wins the US presidential election." },
  { date: "2024-12-18", region: "us", kind: "rates", label: "Hawkish Fed cut", detail: "Fed cuts but signals fewer cuts in 2025; S&P 500 −3%." },
  { date: "2025-01-27", region: "us", kind: "other", label: "DeepSeek shock", detail: "A Chinese AI model triggers a tech selloff; Nvidia −17%." },
  { date: "2025-09-17", region: "us", kind: "rates", label: "Fed cuts 25bp", detail: "First of three 2025 cuts (September, October, December)." },
  { date: "2025-10-29", region: "us", kind: "rates", label: "Fed cuts 25bp", detail: "Second 2025 cut." },
  { date: "2025-12-10", region: "us", kind: "rates", label: "Fed cuts 25bp", detail: "Third 2025 cut, to 3.50–3.75%." },
  { date: "2026-09-16", region: "us", kind: "rates", label: "Fed hikes 25bp", detail: "First Fed hike since 2023, to 3.75–4.00%." },

  // India
  { date: "2020-03-24", region: "india", kind: "covid", label: "Lockdown; Nifty bottom", detail: "Nifty bottoms near 7,500 as India announces a 21-day national lockdown." },
  { date: "2020-03-27", region: "india", kind: "rates", label: "RBI cuts 75bp", detail: "Emergency cut to 4.40% with liquidity support." },
  { date: "2020-05-22", region: "india", kind: "rates", label: "RBI cuts to 4%", detail: "Off-cycle cut to a record-low 4.00%." },
  { date: "2021-02-01", region: "india", kind: "policy", label: "Budget 2021 rally", detail: "Growth-focused budget; Sensex +5% on the day." },
  { date: "2021-04-12", region: "india", kind: "covid", label: "Second COVID wave", detail: "Sensex falls about 1,700 points as the Delta wave surges." },
  { date: "2022-05-04", region: "india", kind: "rates", label: "RBI surprise hike", detail: "Off-cycle 40bp hike to 4.40% starts the tightening cycle." },
  { date: "2023-01-24", region: "india", kind: "crisis", label: "Hindenburg on Adani", detail: "Short-seller report sets off a rout in Adani Group stocks." },
  { date: "2023-02-08", region: "india", kind: "rates", label: "RBI's last hike", detail: "Repo rate peaks at 6.50%." },
  { date: "2024-06-04", region: "india", kind: "election", label: "Election results", detail: "Nifty drops about 6% as the BJP loses its majority, then recovers." },
  { date: "2024-07-23", region: "india", kind: "policy", label: "Capital gains tax hike", detail: "Budget raises LTCG to 12.5% and STCG to 20%." },
  { date: "2024-09-27", region: "india", kind: "other", label: "Nifty record high", detail: "Nifty tops 26,277 before a long foreign-selling correction." },
  { date: "2025-02-01", region: "india", kind: "policy", label: "Income-tax cut budget", detail: "No income tax up to ₹12 lakh under the new regime." },
  { date: "2025-02-07", region: "india", kind: "rates", label: "RBI's first cut in 5 yrs", detail: "Repo cut to 6.25%." },
  { date: "2025-04-09", region: "india", kind: "rates", label: "RBI cuts to 6%", detail: "Second straight 25bp cut." },
  { date: "2025-05-07", region: "india", kind: "war", label: "Operation Sindoor", detail: "India strikes targets in Pakistan; ceasefire on May 10." },
  { date: "2025-06-06", region: "india", kind: "rates", label: "RBI cuts 50bp", detail: "Jumbo cut to 5.50% plus a CRR cut." },
  { date: "2025-08-27", region: "india", kind: "tariffs", label: "US 50% tariff on India", detail: "Extra 25% US tariff (announced Aug 6) takes effect; FIIs sell." },
  { date: "2025-09-22", region: "india", kind: "policy", label: "GST cuts take effect", detail: "GST rates simplified and cut on many consumer goods." },
  { date: "2025-12-05", region: "india", kind: "rates", label: "RBI cuts to 5.25%", detail: "25bp cut; 125bp of easing in 2025. Held there through 2026 so far." },
  { date: "2026-02-01", region: "india", kind: "policy", label: "Budget 2026: STT hike", detail: "Higher securities transaction tax on derivatives; Sensex −1,547 points." },
];
