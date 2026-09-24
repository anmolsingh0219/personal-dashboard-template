// Everything specific to one person's dashboard lives here: time zone, the portfolios and
// markets they follow, and news sources. SETUP_WITH_CLAUDE.md walks Claude through filling
// it in. The scheduled refresh's instructions (email, calendar, rates) are in
// scripts/refresh-brief.md.

/** IANA time zone the owner lives in. Deadline alerts go out at 8 AM and 7 PM here. */
export const HOME_TZ = "America/New_York";

export interface PortfolioConfig {
  /** Label on the portfolio switch, e.g. "US". */
  label: string;
  /** Used in "No US holdings yet". */
  adjective: string;
  /** ISO 4217 currency and the locale used to format it ("en-IN" groups in lakhs and crores). */
  currency: string;
  locale: string;
  /** Exchange name and regular trading session, in the exchange's own time zone. */
  exchange: string;
  tz: string;
  tzLabel: string;
  /** Minutes after local midnight. */
  open: number;
  close: number;
  /**
   * Yahoo Finance ticker suffixes that belong to this market (".NS" for NSE, ".L" for London…).
   * A holding's suffix decides its portfolio. The first suffix is added to bare tickers typed
   * into this portfolio. Leave empty for the market whose tickers have no suffix (the US).
   */
  suffixes: string[];
  tickerExample: string;
  /** UTC cron that saves this portfolio's daily snapshot after the close. List it in wrangler.jsonc "crons" too. */
  snapshotCron: string;
}

/**
 * The owner's portfolios. The Portfolio panel shows whichever market is open (or closed most
 * recently) and offers a switch when there's more than one. Delete the ones you don't need.
 */
export const PORTFOLIOS = {
  us: {
    label: "US",
    adjective: "US",
    currency: "USD",
    locale: "en-US",
    exchange: "US market",
    tz: "America/New_York",
    tzLabel: "ET",
    open: 9 * 60 + 30,
    close: 16 * 60,
    suffixes: [],
    tickerExample: "AAPL",
    snapshotCron: "15 21 * * 1-5",
  },
  india: {
    label: "India",
    adjective: "Indian",
    currency: "INR",
    locale: "en-IN",
    exchange: "NSE",
    tz: "Asia/Kolkata",
    tzLabel: "IST",
    open: 9 * 60 + 15,
    close: 15 * 60 + 30,
    suffixes: [".NS", ".BO"],
    tickerExample: "NTPC",
    snapshotCron: "15 10 * * 1-5",
  },
} satisfies Record<string, PortfolioConfig>;

export type PortfolioId = keyof typeof PORTFOLIOS;
export const PORTFOLIO_IDS = Object.keys(PORTFOLIOS) as PortfolioId[];

/**
 * Tiles on the Markets panel, as Yahoo Finance symbols (search finance.yahoo.com for others,
 * e.g. "^FTSE", "^N225", "EURUSD=X", "BTC-USD"). `currency`/`unit` label commodity prices.
 */
export const MARKET_TILES: { symbol: string; name: string; currency: string | null; unit: string | null }[] = [
  { symbol: "^GSPC", name: "S&P 500", currency: null, unit: null },
  { symbol: "^IXIC", name: "Nasdaq", currency: null, unit: null },
  { symbol: "^NSEI", name: "Nifty 50", currency: null, unit: null },
  { symbol: "^BSESN", name: "Sensex", currency: null, unit: null },
  { symbol: "CL=F", name: "WTI crude", currency: "$", unit: "bbl" },
  { symbol: "BZ=F", name: "Brent crude", currency: "$", unit: "bbl" },
  { symbol: "GC=F", name: "Gold", currency: "$", unit: "oz" },
];

/** RSS feeds for the Markets panel's headlines (newest first, a few from each). */
export const NEWS_FEEDS: { source: string; url: string }[] = [
  // CNBC: investing, and finance.
  { source: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069" },
  { source: "CNBC", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  // Economic Times: the Indian economy (RBI, growth, inflation).
  { source: "Economic Times", url: "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms" },
];
