/* Zero-dependency 60 fps Canvas Interactive Mini-Map for ClioPlay Link v3.0.
 * Matches ClioPlay clio040.c exact RGB565 Day/Night palette:
 *   C_ROUTE magenta/pink + dark casing, C_ROUTE_FUTURE lavender, C_CAR orange chevron,
 *   progressive raster map tiles ONLY when online & enabled, plus sleek offline grid fallback. */

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

const PALETTES = {
  dark: {
    bg: "#041214",
    grid: "rgba(100, 160, 178, 0.10)",
    gridMajor: "rgba(100, 160, 178, 0.20)",
    route: "#ff66b5",
    routeCasing: "#58133a",
    future: "#a575ff",
    futureCasing: "#39246c",
    car: "#f79c42",
    carRim: "#ffffff",
    pinBg: "#121f28",
    pinRing: "#639eff",
    hazard: "#f59e0b",
    place: "#38bdf8",
    text: "#f0f7fa"
  },
  light: {
    bg: "#eceae0",
    grid: "rgba(60, 88, 108, 0.10)",
    gridMajor: "rgba(60, 88, 108, 0.18)",
    route: "#e62a84",
    routeCasing: "#ffffff",
    future: "#7b5fd6",
    futureCasing: "#ffffff",
    car: "#eb701a",
    carRim: "#ffffff",
    pinBg: "#ffffff",
    pinRing: "#0373dd",
    hazard: "#d97706",
    place: "#0284c7",
    text: "#102831"
  }
};

function latToY(lat) {
  const rad = Math.max(-85.051128, Math.min(85.051128, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

function yToLat(y) {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function lonToX(lon) {
  return (lon + 180) / 360;
}

function xToLon(x) {
  return x * 360 - 180;
}

export class ClioMiniMap {
  constructor(canvas, { onPinMoved, onSelectOverlay, isOnlineAllowed, isDarkTheme } = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") || null;
    this.onPinMoved = onPinMoved || (() => {});
    this.onSelectOverlay = onSelectOverlay || (() => {});
    this.isOnlineAllowed = isOnlineAllowed || (() => true);
    this.isDarkTheme = isDarkTheme || (() => true);

    this.centerLat = 54.9783;
    this.centerLon = -1.6178;
    this.zoom = 13;
    this.pin = null;           // { lat, lon, name, draggable }
    this.stops = [];           // [{ lat, lon, name }]
    this.phoneGps = null;      // { lat, lon, heading, accuracy }
    this.overlayPins = [];     // [{ lat, lon, label, kind: "place"|"hazard" }]
    this.mapBbox = null;       // { minLat, maxLat, minLon, maxLon }

    this.tiles = new Map();
    this.rafId = 0;
    this.pointers = new Map();
    this.draggingPin = false;
    this.panStart = null;
    this.pinchStart = null;
    this.moved = false;

    if (this.canvas) {
      this._bindEvents();
      this.resize();
      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(this.canvas);
      }
    }
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(rect.width));
    const h = Math.max(100, Math.round(rect.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.scheduleDraw();
  }

  setState({ pin, stops, phoneGps, overlayPins, mapBbox, fit = false } = {}) {
    if (pin !== undefined) this.pin = pin;
    if (stops !== undefined) this.stops = stops || [];
    if (phoneGps !== undefined) this.phoneGps = phoneGps;
    if (overlayPins !== undefined) this.overlayPins = overlayPins || [];
    if (mapBbox !== undefined) this.mapBbox = mapBbox;
    if (fit) this.fitContents();
    this.scheduleDraw();
  }

  focusPoint(lat, lon, zoom = 15) {
    this.centerLat = lat;
    this.centerLon = lon;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    this.scheduleDraw();
  }

  fitContents() {
    const pts = [];
    if (this.pin) pts.push(this.pin);
    for (const s of this.stops) pts.push(s);
    for (const o of this.overlayPins) pts.push(o);
    if (this.phoneGps && pts.length <= 1) pts.push(this.phoneGps);
    if (!pts.length) return;
    if (pts.length === 1) {
      this.centerLat = pts[0].lat;
      this.centerLon = pts[0].lon;
      this.zoom = 14.5;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      const x = lonToX(p.lon), y = latToY(p.lat);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    this.centerLon = xToLon((minX + maxX) / 2);
    this.centerLat = yToLat((minY + maxY) / 2);
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const padW = Math.max(80, (this.width || 320) * 0.68);
    const padH = Math.max(80, (this.height || 180) * 0.62);
    const zx = Math.log2(padW / (spanX * TILE_SIZE));
    const zy = Math.log2(padH / (spanY * TILE_SIZE));
    this.zoom = Math.max(MIN_ZOOM, Math.min(16, Math.min(zx, zy)));
  }

  _worldScale() {
    return TILE_SIZE * Math.pow(2, this.zoom);
  }

  project(lat, lon) {
    const scale = this._worldScale();
    const cx = lonToX(this.centerLon) * scale;
    const cy = latToY(this.centerLat) * scale;
    return {
      x: (this.width / 2) + (lonToX(lon) * scale - cx),
      y: (this.height / 2) + (latToY(lat) * scale - cy)
    };
  }

  unproject(px, py) {
    const scale = this._worldScale();
    const cx = lonToX(this.centerLon) * scale;
    const cy = latToY(this.centerLat) * scale;
    const wx = (cx + (px - this.width / 2)) / scale;
    const wy = (cy + (py - this.height / 2)) / scale;
    return {
      lat: Math.max(-85, Math.min(85, yToLat(wy))),
      lon: ((xToLon(wx) + 540) % 360) - 180
    };
  }

  _tileUrl(z, x, y, dark) {
    const sub = "abcd"[(x + y) & 3];
    const style = dark ? "dark_all" : "rastertiles/voyager";
    return `https://${sub}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;
  }

  _getTile(z, x, y, dark) {
    const key = `${dark ? "d" : "l"}:${z}:${x}:${y}`;
    const hit = this.tiles.get(key);
    if (hit) return hit;
    if (!this.isOnlineAllowed() || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
    if (this.tiles.size > 96) {
      const oldest = this.tiles.keys().next().value;
      this.tiles.delete(oldest);
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const entry = { img, loaded: false, failed: false };
    img.onload = () => { entry.loaded = true; this.scheduleDraw(); };
    img.onerror = () => { entry.failed = true; };
    img.src = this._tileUrl(z, x, y, dark);
    this.tiles.set(key, entry);
    return entry;
  }

  scheduleDraw() {
    if (this.rafId || !this.ctx) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  draw() {
    if (!this.ctx || !this.width || !this.height) return;
    const dark = this.isDarkTheme();
    const pal = dark ? PALETTES.dark : PALETTES.light;
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Background + offline sleek cartographic grid
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    this._drawOfflineGrid(ctx, pal);

    // 2. Progressive raster tiles when online & permitted
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(this.zoom)));
    const tileScale = Math.pow(2, this.zoom - z) * TILE_SIZE;
    const maxT = 1 << z;
    const centerTx = lonToX(this.centerLon) * maxT;
    const centerTy = latToY(this.centerLat) * maxT;
    const x0 = Math.floor(centerTx - (this.width / 2) / tileScale) - 1;
    const x1 = Math.ceil(centerTx + (this.width / 2) / tileScale) + 1;
    const y0 = Math.max(0, Math.floor(centerTy - (this.height / 2) / tileScale) - 1);
    const y1 = Math.min(maxT - 1, Math.ceil(centerTy + (this.height / 2) / tileScale) + 1);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wtx = ((tx % maxT) + maxT) % maxT;
        const t = this._getTile(z, wtx, ty, dark);
        if (t && t.loaded && !t.failed) {
          const dx = this.width / 2 + (tx - centerTx) * tileScale;
          const dy = this.height / 2 + (ty - centerTy) * tileScale;
          ctx.drawImage(t.img, dx, dy, tileScale + 0.6, tileScale + 0.6);
        }
      }
    }

    // 3. Optional synced Car Map Coverage boundary
    if (this.mapBbox) {
      const tl = this.project(this.mapBbox.maxLat, this.mapBbox.minLon);
      const br = this.project(this.mapBbox.minLat, this.mapBbox.maxLon);
      ctx.save();
      ctx.strokeStyle = dark ? "rgba(99, 158, 255, 0.35)" : "rgba(3, 115, 221, 0.32)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    // 4. Route itinerary lines (Leg 0 = ClioPlay C_ROUTE pink, future legs = C_ROUTE_FUTURE lavender!)
    const routePts = [];
    if (this.phoneGps && (this.stops.length || this.pin)) {
      routePts.push({ lat: this.phoneGps.lat, lon: this.phoneGps.lon, isOrigin: true });
    }
    if (this.stops.length) {
      for (const s of this.stops) routePts.push(s);
    } else if (this.pin) {
      routePts.push(this.pin);
    }
    if (routePts.length >= 2) {
      for (let i = 0; i < routePts.length - 1; i++) {
        const a = this.project(routePts[i].lat, routePts[i].lon);
        const b = this.project(routePts[i + 1].lat, routePts[i + 1].lon);
        const isFirst = i === 0;
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = isFirst ? pal.routeCasing : pal.futureCasing;
        ctx.lineWidth = isFirst ? 8 : 6.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

        ctx.strokeStyle = isFirst ? pal.route : pal.future;
        ctx.lineWidth = isFirst ? 4.5 : 3.5;
        if (!isFirst) ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
      }
    }

    // 5. Overlay pins (Insights visited places / slowdown hotspots)
    for (const o of this.overlayPins) {
      const pt = this.project(o.lat, o.lon);
      ctx.save();
      ctx.fillStyle = o.kind === "hazard" ? pal.hazard : pal.place;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, o.kind === "hazard" ? 7 : 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 6. Numbered multi-stop itinerary pins
    for (let i = 0; i < this.stops.length; i++) {
      const s = this.stops[i];
      const pt = this.project(s.lat, s.lon);
      const isFinal = i === this.stops.length - 1;
      ctx.save();
      ctx.fillStyle = isFinal ? pal.route : pal.pinRing;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (isFinal) {
        ctx.roundRect?.(pt.x - 10, pt.y - 10, 20, 20, 5) ?? ctx.rect(pt.x - 10, pt.y - 10, 20, 20);
      } else {
        ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), pt.x, pt.y + 0.5);
      ctx.restore();
    }

    // 7. Active destination pin (draggable)
    if (this.pin) {
      const pt = this.project(this.pin.lat, this.pin.lon);
      ctx.save();
      // Drop shadow
      ctx.fillStyle = "rgba(0,0,0,0.34)";
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y + 2, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pin teardrop
      ctx.fillStyle = pal.route;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y - 15, 9.5, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(pt.x, pt.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y - 15, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 8. Live Phone GPS marker (ClioPlay C_CAR orange chevron!)
    if (this.phoneGps) {
      const pt = this.project(this.phoneGps.lat, this.phoneGps.lon);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      const hdg = Number.isFinite(this.phoneGps.heading) ? (this.phoneGps.heading * Math.PI / 180) : 0;
      ctx.fillStyle = "rgba(247, 156, 66, 0.20)";
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(hdg);
      ctx.fillStyle = pal.car;
      ctx.strokeStyle = pal.carRim;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(7.5, 7.5);
      ctx.lineTo(0, 3.8);
      ctx.lineTo(-7.5, 7.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawOfflineGrid(ctx, pal) {
    const spacing = 44;
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    const scale = this._worldScale();
    const ox = -((lonToX(this.centerLon) * scale) % spacing);
    const oy = -((latToY(this.centerLat) * scale) % spacing);
    ctx.beginPath();
    for (let x = ox; x < this.width; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, this.height); }
    for (let y = oy; y < this.height; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(this.width, y); }
    ctx.stroke();
  }

  _bindEvents() {
    const c = this.canvas;
    const getPos = e => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener("pointerdown", e => {
      c.setPointerCapture?.(e.pointerId);
      const pos = getPos(e);
      this.pointers.set(e.pointerId, pos);
      this.moved = false;

      if (this.pointers.size === 1) {
        if (this.pin && this.pin.draggable !== false) {
          const p = this.project(this.pin.lat, this.pin.lon);
          if (Math.hypot(pos.x - p.x, pos.y - (p.y - 12)) < 26) {
            this.draggingPin = true;
            return;
          }
        }
        this.panStart = { x: pos.x, y: pos.y, lat: this.centerLat, lon: this.centerLon };
      } else if (this.pointers.size === 2) {
        this.draggingPin = false;
        this.panStart = null;
        const [a, b] = [...this.pointers.values()];
        this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      }
    });

    c.addEventListener("pointermove", e => {
      if (!this.pointers.has(e.pointerId)) return;
      const pos = getPos(e);
      this.pointers.set(e.pointerId, pos);

      if (this.draggingPin && this.pin) {
        this.moved = true;
        const ll = this.unproject(pos.x, pos.y + 8);
        this.pin = { ...this.pin, lat: ll.lat, lon: ll.lon };
        this.scheduleDraw();
      } else if (this.pointers.size === 2 && this.pinchStart) {
        this.moved = true;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 10 && this.pinchStart.dist > 10) {
          this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.pinchStart.zoom + Math.log2(d / this.pinchStart.dist)));
          this.scheduleDraw();
        }
      } else if (this.panStart && this.pointers.size === 1) {
        const dx = pos.x - this.panStart.x;
        const dy = pos.y - this.panStart.y;
        if (Math.hypot(dx, dy) > 4) this.moved = true;
        const scale = this._worldScale();
        const wx = lonToX(this.panStart.lon) - dx / scale;
        const wy = latToY(this.panStart.lat) - dy / scale;
        this.centerLon = ((xToLon(wx) + 540) % 360) - 180;
        this.centerLat = Math.max(-85, Math.min(85, yToLat(wy)));
        this.scheduleDraw();
      }
    });

    const endPtr = e => {
      const pos = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.draggingPin && this.pin) {
        this.draggingPin = false;
        this.onPinMoved(this.pin.lat, this.pin.lon);
      } else if (!this.moved && pos && this.pointers.size === 0) {
        // Tap on an overlay pin selects it; otherwise tap nudges active pin if one is shown
        for (const o of this.overlayPins) {
          const p = this.project(o.lat, o.lon);
          if (Math.hypot(pos.x - p.x, pos.y - p.y) < 18) {
            this.onSelectOverlay(o);
            return;
          }
        }
        if (this.pin && this.pin.draggable !== false) {
          const ll = this.unproject(pos.x, pos.y);
          this.pin = { ...this.pin, lat: ll.lat, lon: ll.lon };
          this.scheduleDraw();
          this.onPinMoved(ll.lat, ll.lon);
        }
      }
      if (this.pointers.size < 2) this.pinchStart = null;
      if (this.pointers.size === 0) this.panStart = null;
    };
    c.addEventListener("pointerup", endPtr);
    c.addEventListener("pointercancel", endPtr);
    c.addEventListener("wheel", e => {
      e.preventDefault();
      const dz = e.deltaY > 0 ? -0.45 : 0.45;
      this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom + dz));
      this.scheduleDraw();
    }, { passive: false });
  }
}
