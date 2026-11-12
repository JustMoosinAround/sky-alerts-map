/* Sky Alerts public map. Plain script, no build step.
 * Every piece of text from data/ is set with textContent (or as DOM nodes
 * handed to Leaflet), never parsed as HTML. */
(function () {
  "use strict";

  var ZONE = "America/Anchorage";
  var EXTENT = { south: 59.4, north: 64.1, west: -153.3, east: -145.8 };
  var PAD = 0.5;
  var TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  var STORE_KEY = "skymap.tab";
  var DOT_OPACITY = 0.85;
  var STALE_OPACITY = 0.4;
  // Grey "no good" dots are drawn mostly see-through so the base map stays readable.
  var FAINT_KINDS = { blocked: 1, partly: 1, cloudy: 1, patchy: 1 };
  var FAINT_FILL = 0.3;
  var DEFAULT_SPACING_KM = 5;

  var $ = function (id) { return document.getElementById(id); };

  // localStorage can throw (private browsing, blocked storage): never let it stop the page.
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---- Alaska-time formatting ------------------------------------------------
  var parts = (function () {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE, weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    return function (iso) {
      var out = {};
      f.formatToParts(new Date(iso)).forEach(function (p) { out[p.type] = p.value; });
      return out;
    };
  })();
  function clock(p) { return p.hour + ":" + p.minute + " " + p.dayPeriod; }
  function dayTime(iso) { var p = parts(iso); return p.weekday + " " + p.month + " " + p.day + ", " + clock(p); }
  function weekdayTime(iso) { var p = parts(iso); return p.weekday + " " + clock(p); }
  function timeOnly(iso) { return clock(parts(iso)); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- State ----------------------------------------------------------------
  var index, map, renderer, dotLayer, tabFiles = {}, current = null, loadToken = 0;
  var markers = [];   // [{dot, fill, ring}]
  var opacity = DOT_OPACITY;

  // On-screen px between neighbouring grid dots (dot_spacing_km east-west at the map centre).
  // map.project is unrounded; latLngToContainerPoint would round to whole pixels.
  function spacingPx() {
    var km = (index && index.dot_spacing_km) || DEFAULT_SPACING_KM;
    var c = map.getCenter();
    var dLon = km / (111.32 * Math.cos(c.lat * Math.PI / 180));
    return map.project([c.lat, c.lng + dLon]).x - map.project(c).x;
  }
  function radiusFor(q, spacing) {
    return Math.max(1.5, Math.min(14, spacing * (0.12 + 0.36 * Math.sqrt(q))));
  }
  function ringGap(spacing) { return Math.max(1.5, 0.15 * spacing); }

  // ---- Start ----------------------------------------------------------------
  fetch("data/index.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(start, unavailable);

  function unavailable() {
    $("unavailable").hidden = false;
    $("tabs").hidden = true;
    $("when").hidden = true;
    document.body.classList.add("is-unavailable");
  }

  function start(data) {
    index = data;
    var title = data.title || "Sky Forecast";
    $("title").textContent = title;
    document.title = title;

    setupContact(data);
    $("footer").hidden = false;
    document.querySelector(".site-credits").textContent = data.credits || "";

    var age = Date.now() - Date.parse(data.updated);
    if (age > data.stale_hours * 3600e3) {
      opacity = STALE_OPACITY;
      var stale = $("stale");
      stale.textContent = "This forecast is out of date (last updated " + dayTime(data.updated) + " Alaska time)";
      stale.hidden = false;
    }

    // Everything above the map (tabs, "when" line, banner) is laid out before the map exists: the map box
    // is flex:1, and Leaflet fits the view to the size it measures when it is created.
    var tabs = data.tabs || [];
    var nav = $("tabs");
    tabs.forEach(function (tab) {
      var b = el("button", "tab", tab.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", "false");
      b.dataset.id = tab.id;
      b.addEventListener("click", function () { showTab(tab.id, true); });
      nav.appendChild(b);
    });
    nav.addEventListener("keydown", function (e) {
      var step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step || !current) return;
      var ids = tabs.map(function (t) { return t.id; });
      var next = ids[(ids.indexOf(current.id) + step + ids.length) % ids.length];
      showTab(next, true);
      nav.querySelector('[data-id="' + CSS.escape(next) + '"]').focus();
      e.preventDefault();
    });
    var remembered = store.get(STORE_KEY);
    var chosen = !tabs.length ? null
      : tabs.some(function (t) { return t.id === remembered; }) ? remembered : tabs[0].id;
    if (chosen) setWhen(tabs.filter(function (t) { return t.id === chosen; })[0]);

    $("map-wrap").hidden = false;
    setupMap();
    setupLegend();
    addSpots(data.spots || []);
    if (!chosen) { showNote("No forecast maps are available right now."); return; }
    showTab(chosen, false);
  }

  function setWhen(tab) {
    $("when").textContent = tab.label + " " + dayTime(tab.when) + " · updated " + timeOnly(index.updated) + " Alaska time";
  }

  function setupContact(data) {
    var link = $("contact");
    if (data.contact_label) link.textContent = data.contact_label;
    if (/^https:\/\//.test(data.contact_url || "")) link.href = data.contact_url;
    var root = null;
    try { root = new URL(link.href).origin + "/"; } catch (e) { /* keep none */ }
    if (data.logo) {
      var img = $("logo");
      var logoLink = $("logo-link");
      if (root) logoLink.href = root;
      img.addEventListener("load", function () { logoLink.hidden = false; });
      img.addEventListener("error", function () { logoLink.hidden = true; });
      img.src = data.logo;
    }
  }

  function setupMap() {
    var bounds = L.latLngBounds([EXTENT.south, EXTENT.west], [EXTENT.north, EXTENT.east]);
    var maxBounds = L.latLngBounds([EXTENT.south - PAD, EXTENT.west - PAD], [EXTENT.north + PAD, EXTENT.east + PAD]);
    renderer = L.canvas({ padding: 0.5 });
    map = L.map("map", {
      renderer: renderer, minZoom: 0, maxZoom: 12, zoomSnap: 0.25, zoomDelta: 1,
      maxBounds: maxBounds, maxBoundsViscosity: 1, preferCanvas: true,
    });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.tileLayer(TILES, { maxZoom: 12, attribution: OSM_CREDIT }).addTo(map);
    // Zoom 6 normally, lower when that is the only way the whole area fits (a phone is narrower than z6).
    map.setMinZoom(Math.min(6, map.getBoundsZoom(bounds)));
    map.fitBounds(bounds, { animate: false });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { map.invalidateSize({ animate: false }); }).observe($("map"));
    }
    dotLayer = L.layerGroup().addTo(map);
    map.on("zoomend", resizeDots);
    window.skyMap = map;   // handy for tests and debugging
  }

  // ---- Tabs ------------------------------------------------------------------
  function showTab(id, remember) {
    var tab = index.tabs.filter(function (t) { return t.id === id; })[0];
    if (!tab) return;
    current = tab;
    if (remember) store.set(STORE_KEY, id);
    Array.prototype.forEach.call($("tabs").children, function (b) {
      var on = b.dataset.id === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    setWhen(tab);

    var mapEl = $("map");
    delete mapEl.dataset.dots;
    mapEl.dataset.tab = id;
    map.closePopup();
    clearDots();
    hideNote();

    if (!tab.file) { showNote(tab.error || "This map could not be drawn."); return; }
    var token = ++loadToken;
    loadTab(tab).then(function (file) {
      if (token !== loadToken) return;
      drawDots(tab, file);
    }, function () {
      if (token !== loadToken) return;
      showNote("This map could not be loaded. Please try again later.");
    });
  }

  function loadTab(tab) {
    if (!tabFiles[tab.file]) {
      tabFiles[tab.file] = fetch("data/" + tab.file, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
      tabFiles[tab.file].catch(function () { delete tabFiles[tab.file]; });
    }
    return tabFiles[tab.file];
  }

  function showNote(text) {
    var note = $("map-note");
    note.textContent = text;
    note.hidden = false;
    $("legend").hidden = true;
  }
  function hideNote() { $("map-note").hidden = true; }

  // ---- Dots ------------------------------------------------------------------
  function clearDots() { dotLayer.clearLayers(); markers = []; }

  function drawDots(tab, file) {
    var spacing = spacingPx(), gap = ringGap(spacing);
    var dots = file.dots.map(function (d, i) { return [d, i]; });
    // Better dots on top: ascending q, file order among ties.
    dots.sort(function (a, b) { return a[0][4] - b[0][4] || a[1] - b[1]; });
    dots.forEach(function (pair) {
      var d = pair[0];
      var r = radiusFor(d[4], spacing);
      var faint = !!FAINT_KINDS[d[2]];
      var fill = L.circleMarker([d[0], d[1]], {
        renderer: renderer, radius: r, stroke: false,
        fillColor: d[3], fillOpacity: faint ? opacity * FAINT_FILL : opacity, bubblingMouseEvents: false,
      });
      fill.bindPopup(function () { return dotPopup(tab, file, d, null); }, { maxWidth: 260 });
      dotLayer.addLayer(fill);
      var ring = null;
      if (d[6]) {
        ring = L.circleMarker([d[0], d[1]], {
          renderer: renderer, radius: r + gap, fill: false, color: d[3], weight: 1.25,
          opacity: opacity, dashArray: "3 3", interactive: false,
        });
        dotLayer.addLayer(ring);
      }
      markers.push({ dot: d, fill: fill, ring: ring });
    });
    current.data = file;
    showLegend(file.map_type);
    var mapEl = $("map");
    mapEl.dataset.opacity = String(opacity);
    mapEl.dataset.dots = String(markers.length);
  }

  function resizeDots() {
    var spacing = spacingPx(), gap = ringGap(spacing);
    markers.forEach(function (m) {
      var r = radiusFor(m.dot[4], spacing);
      m.fill.setRadius(r);
      if (m.ring) m.ring.setRadius(r + gap);
    });
  }

  function kindLabel(mapType, kind) {
    var rows = (index.legend && index.legend[mapType]) || [];
    for (var i = 0; i < rows.length; i++) if (rows[i][0] === kind) return rows[i][2];
    return kind;
  }

  function dotPopup(tab, file, d, heading) {
    var box = el("div", "pop");
    if (heading) box.appendChild(el("p", "pop-name", heading));
    var head = el("p", "pop-head");
    var swatch = el("span", "pop-swatch");
    swatch.style.background = d[3];
    head.appendChild(swatch);
    var words = [kindLabel(file.map_type, d[2])];
    if (d[5]) words.push(capital(d[5]));
    if (d[6]) words.push("models disagree");
    head.appendChild(document.createTextNode(words.join(" · ")));
    box.appendChild(head);
    var m = d[7] || {};
    if (typeof m.chance === "number") box.appendChild(el("p", "pop-chance", tab.label + ": " + m.chance + "% chance"));
    box.appendChild(el("p", "pop-when", tab.label + " " + weekdayTime(file.when || tab.when)));
    var metrics = "block" in m
      ? "Light blocked " + m.block + "% · Cloud canvas " + m.canvas + "%"
      : "Cloud overhead " + m.overhead + "% · to the north " + m.north + "%";
    box.appendChild(el("p", "pop-metrics", metrics));
    return box;
  }

  // ---- Public spots ----------------------------------------------------------
  function addSpots(spots) {
    spots.forEach(function (s) {
      var icon = el("span", "spot-inner");
      icon.appendChild(el("span", "spot-star", "★"));
      icon.appendChild(el("span", "spot-label", s.name));
      var marker = L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: "spot-marker", html: icon, iconSize: null, iconAnchor: [7, 9] }),
        title: s.name, alt: s.name, riseOnHover: true, zIndexOffset: 1000,
      }).addTo(map);
      marker.bindPopup(function () { return spotPopup(s); }, { maxWidth: 260 });
    });
  }

  function spotPopup(s) {
    var tab = current, file = tab && tab.data;
    if (!file || !tab.file || !file.dots.length) {
      var box = el("div", "pop");
      box.appendChild(el("p", "pop-name", s.name));
      return box;
    }
    var k = Math.cos(s.lat * Math.PI / 180), best = null, bestD = Infinity;
    file.dots.forEach(function (d) {
      var dy = d[0] - s.lat, dx = (d[1] - s.lon) * k, dist = dx * dx + dy * dy;
      if (dist < bestD) { bestD = dist; best = d; }
    });
    return dotPopup(tab, file, best, s.name);
  }

  // ---- Legend ----------------------------------------------------------------
  function setupLegend() {
    var toggle = $("legend-toggle");
    var wide = window.matchMedia && window.matchMedia("(min-width: 700px)").matches;
    setLegendOpen(!!wide);
    toggle.addEventListener("click", function () {
      setLegendOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    L.DomEvent.disableClickPropagation($("legend"));
    L.DomEvent.disableScrollPropagation($("legend"));
  }

  function setLegendOpen(open) {
    $("legend-toggle").setAttribute("aria-expanded", String(open));
    $("legend-body").hidden = !open;
  }

  function showLegend(mapType) {
    var list = $("legend-list");
    list.textContent = "";
    ((index.legend && index.legend[mapType]) || []).forEach(function (row) {
      var li = el("li");
      var sw = el("span", "legend-swatch");
      if (FAINT_KINDS[row[0]]) { sw.className += " legend-swatch-faint"; sw.style.borderColor = row[1]; sw.style.background = row[1] + "4d"; }
      else sw.style.background = row[1];
      li.appendChild(sw);
      li.appendChild(document.createTextNode(row[2]));
      list.appendChild(li);
    });
    $("legend").hidden = false;
  }
})();
