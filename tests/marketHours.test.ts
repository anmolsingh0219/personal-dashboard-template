import { describe, expect, it } from "vitest";
import { PORTFOLIOS } from "../shared/config";
import { defaultPortfolio, displaySymbol, isOpen, lastClose, marketStatus, nextOpen, portfolioOf, withSuffix, type PortfolioId } from "../shared/marketHours";

const at = (iso: string) => Date.parse(iso);

// Fixed sessions, so these tests don't depend on shared/config.ts.
const us = { tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60, tzLabel: "ET", exchange: "US market" };
const nse = { tz: "Asia/Kolkata", open: 9 * 60 + 15, close: 15 * 60 + 30, tzLabel: "IST", exchange: "NSE" };
// The rest covers the shipped US + India config and is skipped once it's customized.
const shipped = "us" in PORTFOLIOS && "india" in PORTFOLIOS;
const id = (p: string) => p as PortfolioId;

describe("market hours", () => {
  it("knows when each market is open", () => {
    expect(isOpen(nse, at("2026-09-23T04:20:00Z"))).toBe(true); // 09:50 IST Wed
    expect(isOpen(us, at("2026-09-23T04:20:00Z"))).toBe(false); // 00:20 ET
    expect(isOpen(us, at("2026-09-23T18:00:00Z"))).toBe(true); // 14:00 ET
    expect(isOpen(us, at("2026-09-26T15:00:00Z"))).toBe(false); // Saturday
  });

  it.skipIf(!shipped)("defaults to the live market, else the one that closed last", () => {
    expect(defaultPortfolio(at("2026-09-23T04:20:00Z"))).toBe("india"); // NSE open
    expect(defaultPortfolio(at("2026-09-23T18:00:00Z"))).toBe("us"); // NYSE open
    expect(defaultPortfolio(at("2026-09-24T00:00:00Z"))).toBe("us"); // 20:00 ET: US closed most recently
    expect(defaultPortfolio(at("2026-09-23T11:00:00Z"))).toBe("india"); // 07:00 ET: NSE closed at 06:00 ET
    expect(defaultPortfolio(at("2026-09-26T15:00:00Z"))).toBe("us"); // Saturday: Friday's US close is latest
  });

  it("finds the last close and next open in exchange time", () => {
    expect(lastClose(us, at("2026-09-24T00:00:00Z"))).toBe(at("2026-09-23T20:00:00Z")); // 4 PM EDT
    expect(lastClose(nse, at("2026-09-23T11:00:00Z"))).toBe(at("2026-09-23T10:00:00Z")); // 3:30 PM IST
    expect(nextOpen(nse, at("2026-09-26T15:00:00Z"))).toBe(at("2026-09-28T03:45:00Z")); // Mon 9:15 IST
    expect(nextOpen(us, at("2026-11-02T12:00:00Z"))).toBe(at("2026-11-02T14:30:00Z")); // after DST ends: 9:30 EST
  });

  it("describes the market state", () => {
    expect(marketStatus(nse, at("2026-09-23T04:20:00Z"))).toEqual({ open: true, label: "NSE open · closes 3:30 PM IST" });
    expect(marketStatus(us, at("2026-09-23T04:20:00Z"))).toEqual({ open: false, label: "US market closed · opens 9:30 AM ET" });
    expect(marketStatus(nse, at("2026-09-26T15:00:00Z")).label).toBe("NSE closed · opens Mon 9:15 AM IST");
  });

  it.skipIf(!shipped)("sorts tickers into portfolios by exchange suffix", () => {
    expect(portfolioOf("AAPL")).toBe("us");
    expect(portfolioOf("NTPC.NS")).toBe("india");
    expect(portfolioOf("reliance.bo")).toBe("india");
    expect(withSuffix("NTPC", id("india"))).toBe("NTPC.NS");
    expect(withSuffix("NTPC.BO", id("india"))).toBe("NTPC.BO");
    expect(withSuffix("AAPL", id("us"))).toBe("AAPL");
    expect(displaySymbol("RELIANCE.NS")).toBe("RELIANCE");
    expect(displaySymbol("BRK-B")).toBe("BRK-B");
  });
});
