// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(__dirname, "../../timewarp-site/dist/consent.js"), "utf8");

// Load the page with consent.js the way the site does: a blocking script in <head>.
function load({ stored, banner }: { stored?: object; banner?: "off" } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://timewarpdev.com/",
    runScripts: "outside-only",
  });
  const { window } = dom;
  if (stored) window.localStorage.setItem("timewarp-consent", JSON.stringify(stored));
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  const beacon = vi.fn(() => true);
  Object.assign(window, { fetch, Request, Response });
  Object.defineProperty(window.navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  const script = window.document.createElement("script");
  if (banner) script.setAttribute("data-banner", banner);
  Object.defineProperty(window.document, "currentScript", { value: script, configurable: true });
  window.eval(source);
  const banners = () =>
    [...window.document.querySelectorAll<HTMLElement>(".consent")].filter((el) => !el.hidden);
  const click = (selector: string) => window.document.querySelector<HTMLElement>(selector)!.click();
  return { window, document: window.document, fetch, beacon, banners, click };
}

describe("cookie consent", () => {
  it("holds the analytics cookie and requests until the visitor chooses", async () => {
    const page = load();
    expect(page.banners()).toHaveLength(1);

    page.document.cookie = "session-id=abc; Max-Age=1800; path=/; secure";
    page.document.cookie = "theme=light; path=/";
    expect(page.document.cookie).toBe("theme=light");

    const held = await page.window.fetch("/__l5e/trackevents", { method: "POST", body: "{}" });
    expect(held.status).toBe(202);
    expect(page.window.navigator.sendBeacon("/__l5e/trackevents", "{}")).toBe(true);
    const xhr = new page.window.XMLHttpRequest();
    xhr.open("POST", "/~api/analytics", true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send('{"action":"page_hit"}');
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.beacon).not.toHaveBeenCalled();

    // Other requests are untouched.
    await page.window.fetch("/download-config.js");
    expect(page.fetch).toHaveBeenCalledTimes(1);

    page.click('[data-consent="accept"]');
    expect(page.banners()).toHaveLength(0);
    expect(page.document.cookie).toContain("session-id=abc");
    expect(page.beacon).toHaveBeenCalledWith("/__l5e/trackevents", "{}");
    expect(page.fetch).toHaveBeenCalledWith("/__l5e/trackevents", { method: "POST", body: "{}" });
    expect(page.fetch).toHaveBeenCalledWith("/~api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"action":"page_hit"}',
    });
    expect(JSON.parse(page.window.localStorage.getItem("timewarp-consent")!)).toMatchObject({
      v: 1,
      analytics: true,
    });
  });

  it("drops held requests on reject and deletes the analytics cookie when consent is withdrawn", async () => {
    const page = load();
    await page.window.fetch("/__l5e/trackevents", { method: "POST", body: "{}" });
    page.click('[data-consent="reject"]');
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.window.localStorage.getItem("timewarp-consent")).toContain('"analytics":false');

    const accepted = load({ stored: { v: 1, analytics: true, at: new Date().toISOString() } });
    expect(accepted.banners()).toHaveLength(0);
    accepted.document.cookie = "session-id=abc; path=/";
    expect(accepted.document.cookie).toBe("session-id=abc");
    accepted.document.body.innerHTML =
      '<button type="button" data-cookie-settings>Cookie settings</button>';
    accepted.click("[data-cookie-settings]");
    expect(accepted.document.querySelector(".consent-state")!.textContent).toBe("Analytics is on.");
    accepted.click('[data-consent="reject"]');
    expect(accepted.document.cookie).toBe("");
  });

  it("asks again after 12 months, and keeps the guard without a banner on sign-in pages", async () => {
    const old = new Date(Date.now() - 366 * 864e5).toISOString();
    expect(load({ stored: { v: 1, analytics: true, at: old } }).banners()).toHaveLength(1);

    const signIn = load({ banner: "off" });
    expect(signIn.banners()).toHaveLength(0);
    await signIn.window.fetch("/~api/analytics", { method: "POST" });
    expect(signIn.fetch).not.toHaveBeenCalled();
  });
});
