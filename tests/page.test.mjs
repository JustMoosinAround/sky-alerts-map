// Page tests for the public sky map. Run: node public_site/tests/page.test.mjs
// Serves public_site/site from a fake origin with tests/fixtures/data mounted
// as data/; OpenStreetMap tile requests are aborted (no network in tests).
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..", "site");
const FIXTURES = join(HERE, "fixtures", "data");
const SHOTS = process.env.SHOT_DIR || join(HERE, "shots");
const ORIGIN = "http://skymap.test";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const SPOT = "Hatcher Pass <North> & Gap";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const INDEX = fixture("index.json");

/** A fresh index (updated an hour ago) unless the test supplies its own. */
function freshIndex() {
  return { ...INDEX, updated: new Date(Date.now() - 3600e3).toISOString() };
}

async function serve(page, { index = freshIndex(), indexStatus = 200 } = {}) {
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  await page.route(`${ORIGIN}/**`, async (route) => {
    let path = new URL(route.request().url()).pathname;
    if (path.endsWith("/")) path += "index.html";
    if (path === "/data/index.json") {
      if (indexStatus !== 200) return route.fulfill({ status: indexStatus, body: "error" });
      return route.fulfill({ status: 200, contentType: TYPES[".json"], body: JSON.stringify(index) });
    }
    const file = path.startsWith("/data/")
      ? join(FIXTURES, normalize(path.slice(6)))
      : join(SITE, normalize(path.slice(1)));
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] || "application/octet-stream",
      body: readFileSync(file) });
  });
}

let browser;
async function open(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, ...(opts.context || {}) });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e));
  if (opts.init) await page.addInitScript(opts.init);
  if (opts.fixedTime) await page.clock.setFixedTime(opts.fixedTime);
  await serve(page, opts);
  await page.goto(`${ORIGIN}/`);
  return { page, context, errors };
}

const waitDots = (page) => page.waitForSelector("#map[data-dots]", { timeout: 5000 });
const activeTab = (page) => page.locator('#tabs [role="tab"][aria-selected="true"]').textContent();

/** The fixture dot drawn on top: highest q, last in file order among ties. */
function topDot(file) {
  const spot = INDEX.spots[0];
  const dots = fixture(file).dots.filter((d) => d[2] !== "blocked"
    && Math.hypot(d[0] - spot.lat, d[1] - spot.lon) > 0.4);
  return dots.reduce((best, d) => (d[4] >= best[4] ? d : best));
}

const cases = {
  async "renders tabs and dots"(vp) {
    const { page, errors } = await open(vp);
    await waitDots(page);
    const labels = await page.locator('#tabs [role="tab"]').allTextContents();
    assert.deepEqual(labels, ["Sunset", "Aurora"]);
    assert.equal(await activeTab(page), "Sunset");
    assert.ok(await page.locator("#map canvas").count() >= 1, "canvas renderer");
    const when = await page.locator("#when").textContent();
    assert.match(when, /Alaska time/);
    assert.match(when, /^Sunset Tue Nov 3, 4:51 PM/);
    assert.equal(await page.locator("#stale").isVisible(), false);
    assert.equal(await page.locator("#map").getAttribute("data-dots"), String(fixture("sunset.json").dots.length));
    assert.equal(await page.locator(".site-credits").textContent(), INDEX.credits);
    assert.match(await page.locator(".leaflet-control-attribution").textContent(), /© OpenStreetMap contributors/);
    assert.deepEqual(errors, []);
  },

  async "tab choice remembered"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    await page.getByRole("tab", { name: "Aurora" }).click();
    await page.waitForSelector('#map[data-tab="aurora"][data-dots]');
    assert.equal(await activeTab(page), "Aurora");
    assert.match(await page.locator("#when").textContent(), /^Aurora /);
    await page.reload();
    await page.waitForSelector('#map[data-tab="aurora"][data-dots]');
    assert.equal(await activeTab(page), "Aurora");
  },

  async "dot popup"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const dot = topDot("sunset.json");
    const pt = await page.evaluate(([lat, lon]) => {
      window.skyMap.setView([lat, lon], window.skyMap.getZoom(), { animate: false });
      return window.skyMap.latLngToContainerPoint([lat, lon]);
    }, [dot[0], dot[1]]);
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    const popup = page.locator(".leaflet-popup-content");
    await popup.waitFor({ timeout: 3000 });
    const text = await popup.innerText();
    const label = INDEX.legend.sky.find((l) => l[0] === dot[2])[2];
    const grade = dot[5][0].toUpperCase() + dot[5].slice(1);
    assert.ok(text.includes(label), `label ${label} in ${text}`);
    assert.ok(text.includes(grade), `grade ${grade} in ${text}`);
    assert.ok(/Poor|Okay|Good|Exceptional/.test(text));
    if (dot[6]) assert.ok(text.includes("models disagree"));
    assert.ok(text.includes("Sunset Tue 4:51 PM"), text);
    assert.ok(text.includes(`Light blocked ${dot[7].block}% · Cloud canvas ${dot[7].canvas}%`), text);
    assert.ok(text.includes(`Sunset: ${dot[7].chance}% chance`), text);
  },

  async "night popup has no grade word"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    await page.getByRole("tab", { name: "Aurora" }).click();
    await page.waitForSelector('#map[data-tab="aurora"][data-dots]');
    const dot = topDot("aurora.json");
    const pt = await page.evaluate(([lat, lon]) => {
      window.skyMap.setView([lat, lon], window.skyMap.getZoom(), { animate: false });
      return window.skyMap.latLngToContainerPoint([lat, lon]);
    }, [dot[0], dot[1]]);
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    const popup = page.locator(".leaflet-popup-content");
    await popup.waitFor({ timeout: 3000 });
    const text = await popup.innerText();
    assert.ok(text.includes(INDEX.legend.aurora.find((l) => l[0] === dot[2])[2]), text);
    assert.ok(!/Poor|Okay|Good|Exceptional/.test(text), text);
    assert.ok(text.includes(`Cloud overhead ${dot[7].overhead}% · to the north ${dot[7].north}%`), text);
  },

  async "legend toggles"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const toggle = page.locator("#legend-toggle");
    const items = page.locator("#legend-body");
    const startOpen = vp.width >= 700;
    assert.equal(await toggle.getAttribute("aria-expanded"), String(startOpen));
    assert.equal(await items.isVisible(), startOpen);
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), String(!startOpen));
    assert.equal(await items.isVisible(), !startOpen);
    if (!startOpen) {
      const text = await items.innerText();
      for (const [, , label] of INDEX.legend.sky) assert.ok(text.includes(label), label);
      assert.match(text, /bigger dot = better/i);
      assert.match(text, /models disagree/i);
    }
    await toggle.click();
    assert.equal(await items.isVisible(), startOpen);
  },

  async "stale banner"(vp) {
    const updated = Date.parse(INDEX.updated);
    const { page } = await open(vp, { index: INDEX, fixedTime: updated + 13 * 3600e3 });
    await waitDots(page);
    const banner = page.locator("#stale");
    assert.equal(await banner.isVisible(), true);
    assert.match(await banner.textContent(), /This forecast is out of date \(last updated .*\)/);
    assert.equal(await page.locator("#map").getAttribute("data-opacity"), "0.4");
  },

  async "tab error state"(vp) {
    const index = freshIndex();
    index.tabs = index.tabs.map((t) => (t.id === "aurora"
      ? { ...t, file: null, error: "This map could not be drawn." } : t));
    const { page } = await open(vp, { index });
    await waitDots(page);
    assert.equal(await page.locator("#map-note").isVisible(), false);
    await page.getByRole("tab", { name: "Aurora" }).click();
    const note = page.locator("#map-note");
    await note.waitFor({ state: "visible", timeout: 3000 });
    assert.equal(await note.textContent(), "This map could not be drawn.");
    await page.getByRole("tab", { name: "Sunset" }).click();
    await note.waitFor({ state: "hidden", timeout: 3000 });
  },

  async "index load failure"(vp) {
    const { page } = await open(vp, { indexStatus: 500 });
    await page.getByText("The sky forecast is unavailable right now").waitFor({ timeout: 3000 });
    const link = page.getByRole("link", { name: "Contact me" });
    assert.equal(await link.isVisible(), true);
    assert.equal(await link.getAttribute("target"), "_top");
  },

  async "contact link"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const link = page.getByRole("link", { name: INDEX.contact_label });
    assert.equal(await link.getAttribute("target"), "_top");
    assert.equal(await link.getAttribute("href"), INDEX.contact_url);
    assert.match(await link.getAttribute("rel"), /noopener/);
  },

  async "escapes spot names"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const label = page.locator(".spot-label");
    assert.equal(await label.count(), 1);
    assert.equal(await label.textContent(), SPOT);
    assert.equal(await page.locator("north").count(), 0);
    await page.locator(".spot-marker").click();
    const popup = page.locator(".leaflet-popup-content");
    await popup.waitFor({ timeout: 3000 });
    assert.ok((await popup.innerText()).includes(SPOT));
    assert.ok((await popup.innerText()).includes("Sunset Tue 4:51 PM"));
    assert.equal(await page.locator("north").count(), 0);
  },

  async "shows Alaska time in another zone"(vp) {
    const { page } = await open(vp, { context: { timezoneId: "Europe/London" } });
    await waitDots(page);
    assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Europe/London");
    const when = await page.locator("#when").textContent();
    assert.match(when, /^Sunset Tue Nov 3, 4:51 PM · updated .* Alaska time$/);
  },

  async "works when localStorage throws"(vp) {
    const { page, errors } = await open(vp, {
      init: () => Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("denied", "SecurityError"); },
      }),
    });
    await waitDots(page);
    assert.deepEqual(await page.locator('#tabs [role="tab"]').allTextContents(), ["Sunset", "Aurora"]);
    await page.getByRole("tab", { name: "Aurora" }).click();
    await page.waitForSelector('#map[data-tab="aurora"][data-dots]');
    assert.deepEqual(errors, []);
  },

  async "neighbouring dots never overlap"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const dots = fixture("sunset.json").dots;
    // Same-row neighbours (adjacent longitudes at one latitude) with the largest combined q.
    const rows = {};
    for (const d of dots) (rows[d[0]] ||= []).push(d);
    let pair = null;
    for (const row of Object.values(rows)) {
      row.sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < row.length; i++) {
        if (!pair || row[i - 1][4] + row[i][4] > pair[0][4] + pair[1][4]) pair = [row[i - 1], row[i]];
      }
    }
    const big = dots.find((d) => Math.abs(d[4] - 0.95) < 0.01);
    const small = dots.find((d) => Math.abs(d[4] - 0.04) < 0.01);
    assert.ok(pair && big && small, "fixture has a neighbour pair and q 0.95 / 0.04 dots");
    const measure = (zoom) => page.evaluate(([zoom, a, b, big, small, km]) => {
      const map = window.skyMap;
      map.setView([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom, { animate: false });
      const radius = (d) => {
        let r = null;
        map.eachLayer((l) => {
          if (l instanceof L.CircleMarker && l.options.fill !== false) {
            const ll = l.getLatLng();
            if (ll.lat === d[0] && ll.lng === d[1]) r = l.getRadius();
          }
        });
        return r;
      };
      // map.project is unrounded (latLngToContainerPoint rounds to whole pixels).
      const pa = map.project([a[0], a[1]]);
      const pb = map.project([b[0], b[1]]);
      const c = map.getCenter();
      const dLon = km / (111.32 * Math.cos(c.lat * Math.PI / 180));
      const spacing = map.project([c.lat, c.lng + dLon]).x - map.project(c).x;
      return { zoom: map.getZoom(), ra: radius(a), rb: radius(b), dist: pa.distanceTo(pb),
        big: radius(big), small: radius(small), spacing };
    }, [zoom, pair[0], pair[1], big, small, INDEX.dot_spacing_km]);
    for (const zoom of [6, 9]) {
      const m = await measure(zoom);
      assert.equal(m.zoom, zoom);
      assert.ok(m.ra + m.rb < m.dist, `zoom ${zoom}: radii ${m.ra}+${m.rb} >= distance ${m.dist}`);
      // Even at real grid spacing the biggest dots must not touch.
      assert.ok(2 * m.big < m.spacing, `zoom ${zoom}: 2×${m.big} >= spacing ${m.spacing}`);
      if (zoom === 9) assert.ok(m.big > 2 * m.small, `zoom 9: q0.95 r ${m.big} vs q0.04 r ${m.small}`);
    }
  },

  async "initial view fits the whole dot field"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const all = [...fixture("sunset.json").dots, ...fixture("aurora.json").dots];
    const lats = all.map((d) => d[0]), lons = all.map((d) => d[1]);
    const ext = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    const got = await page.evaluate(([s, n, w, e]) => {
      const map = window.skyMap, size = map.getContainer().getBoundingClientRect();
      const sw = map.latLngToContainerPoint([s, w]), ne = map.latLngToContainerPoint([n, e]);
      const nw = map.latLngToContainerPoint([n, w]), se = map.latLngToContainerPoint([s, e]);
      return { w: size.width, h: size.height, mapSize: map.getSize(),
        left: Math.min(sw.x, nw.x), right: Math.max(ne.x, se.x), top: Math.min(nw.y, ne.y),
        bottom: Math.max(sw.y, se.y) };
    }, ext);
    const msg = JSON.stringify(got);
    assert.equal(got.mapSize.x, Math.round(got.w), `Leaflet size is the container size: ${msg}`);
    assert.equal(got.mapSize.y, Math.round(got.h), `Leaflet size is the container size: ${msg}`);
    assert.ok(got.left >= 0 && got.right <= got.w, `dots inside left/right: ${msg}`);
    assert.ok(got.top >= 0 && got.bottom <= got.h, `dots inside top/bottom: ${msg}`);
    const ml = got.left, mr = got.w - got.right;
    assert.ok(Math.abs(ml - mr) <= 0.25 * got.w, `margins ${ml} vs ${mr}: ${msg}`);
  },

  async "no horizontal scroll"(vp) {
    const { page } = await open(vp);
    await waitDots(page);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= vp.width, `scrollWidth ${sw} > ${vp.width}`);
    const mapH = (await page.locator("#map").boundingBox()).height;
    assert.ok(mapH >= 420, `map height ${mapH}`);
  },
};

const once = {
  async "no horizontal scroll at 320 px"() {
    const { page } = await open({ width: 320, height: 700 });
    await waitDots(page);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 320, `scrollWidth ${sw}`);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, "phone-320.png") });
  },
  async "screenshots"() {
    mkdirSync(SHOTS, { recursive: true });
    for (const [name, vp, scheme] of [["phone", PHONE, "light"], ["desktop", DESKTOP, "light"],
      ["phone-dark", PHONE, "dark"]]) {
      const { page } = await open(vp, { context: { colorScheme: scheme } });
      await waitDots(page);
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
    }
  },
};

browser = await chromium.launch();
let failed = 0, passed = 0;
const ONLY = process.env.ONLY;   // optional substring filter on case names
async function run(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split("\n").join("\n     ")}`); }
  finally { for (const c of browser.contexts()) await c.close(); }
}
for (const [name, fn] of Object.entries(cases)) {
  for (const vp of [PHONE, DESKTOP]) await run(`${name} @${vp.width}x${vp.height}`, () => fn(vp));
}
for (const [name, fn] of Object.entries(once)) await run(name, fn);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
