(() => {
  "use strict";
  const DATA = window.TASK1_DATA;
  if (!DATA) throw new Error("Task 1 data is missing. Run build_task1_data.py first.");

  // ---------------------------------------------------------------- data
  const SVG_NS = "http://www.w3.org/2000/svg";
  const fields = DATA.fields;
  const SHORT = { co_gt: "CO", c6h6_gt: "C6H6", nox_gt: "NOx", no2_gt: "NO2", s1_co: "S1 (CO)", s5_o3: "S5 (O3)", t: "T", rh: "RH" };
  const byKey = Object.fromEntries(fields.map((field, index) => [field.key, { ...field, index }]));
  const TIME_BANDS = ["Night 00–05", "Morning 06–11", "Afternoon 12–17", "Evening 18–23"];
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const records = DATA.records.map((row, id) => {
    const [y, m, d] = row[1].split("-").map(Number);
    const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Monday
    return {
      id, date: row[1], hour: row[2], month: row[3], season: row[4], values: row.slice(5),
      yearMonth: row[1].slice(0, 7), weekday,
      dayType: weekday >= 5 ? "Weekend" : "Weekday",
      timeOfDay: TIME_BANDS[Math.floor(row[2] / 6)],
    };
  });
  // Fixed pseudo-random drawing order, so the latest months do not always paint over earlier ones.
  let seed = 20040310;
  const drawRank = records.map(() => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const median = (values) => {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };
  const quantile = (sorted, q) => {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const format = (value) => value == null || !Number.isFinite(value) ? "—"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 });
  const hexA = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  };
  const svgEl = (tag, attrs = {}, text) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text != null) el.textContent = text;
    return el;
  };
  const resize = (canvas) => {
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  };

  // Fixed axis domains over the whole cohort, so views stay comparable when filtering.
  const sortedValues = fields.map((_, i) => records.map((r) => r.values[i]).sort((a, b) => a - b));
  const DOMAINS = {
    minmax: fields.map((field) => DATA.ranges[field.key]),
    p99: sortedValues.map((v) => [quantile(v, 0.01), quantile(v, 0.99)]),
  };

  // ---------------------------------------------------------------- colour
  // Palettes checked with a colour-vision-deficiency palette checker (all pairs, light background).
  // 3 slots pass every check; the 4-slot set is in the CVD warn band, so the
  // legend doubles as a secondary encoding (click to isolate a category).
  const CAT3 = ["#2a78d6", "#eb6834", "#1baf7a"];
  const CAT4 = ["#2a78d6", "#eda100", "#1baf7a", "#e34948"];
  const GREY = "#9fb3c8", INK = "#102a43";
  const SCHEMES = {
    season: { of: (r) => r.season, categories: ["Winter", "Spring", "Summer", "Autumn"], colours: ["#2a78d6", "#1baf7a", "#e34948", "#eda100"] },
    timeOfDay: { of: (r) => r.timeOfDay, categories: TIME_BANDS, colours: CAT4 },
    dayType: { of: (r) => r.dayType, categories: ["Weekday", "Weekend"], colours: CAT3.slice(0, 2) },
  };
  const MAX_GROUPS = CAT3.length;

  const state = {
    start: DATA.range.start, end: DATA.range.end, season: "All", month: 0, dayType: "All", hourFrom: 0, hourTo: 23,
    colourBy: "season", isolated: null, scale: "p99", axisOrder: fields.map((_, i) => i),
    selection: { source: null, ids: new Set(), dates: new Set(), box: null },
    brushes: new Map(), // field index -> [lo, hi] in raw units (±Infinity = open end)
    groups: [],
    x: "co_gt", y: "c6h6_gt",
  };

  const domain = (i) => DOMAINS[state.scale][i];
  const scaled = (i, v) => { const [lo, hi] = domain(i); return hi > lo ? clamp((v - lo) / (hi - lo)) : 0; };

  function groupOf(r) { return state.groups.find((g) => g.ids.has(r.id)) || null; }
  function scheme() {
    if (state.colourBy === "group") {
      return { of: (r) => groupOf(r)?.name ?? null, categories: state.groups.map((g) => g.name), colours: state.groups.map((g) => g.colour) };
    }
    return SCHEMES[state.colourBy] || null;
  }
  function isolatedCategory(sch) { return sch && state.isolated && sch.categories.includes(state.isolated) ? state.isolated : null; }
  function colourOf(r, sch) {
    if (!sch) return INK;
    const cat = sch.of(r);
    if (cat == null || (state.isolated && cat !== state.isolated)) return null;
    return sch.colours[sch.categories.indexOf(cat)];
  }

  // ---------------------------------------------------------------- filtering and selection
  function filtered() {
    return records.filter((r) => r.date >= state.start && r.date <= state.end
      && (state.season === "All" || r.season === state.season)
      && (!state.month || r.month === state.month)
      && (state.dayType === "All" || r.dayType === state.dayType)
      && r.hour >= state.hourFrom && r.hour <= state.hourTo);
  }
  function selected(current) {
    const sel = state.selection;
    if (sel.source === "scatter") return current.filter((r) => sel.ids.has(r.id));
    if (sel.source === "heatmap") return current.filter((r) => sel.dates.has(r.date));
    if (sel.source === "pcp") {
      const brushes = [...state.brushes];
      return current.filter((r) => brushes.every(([i, [lo, hi]]) => r.values[i] >= lo && r.values[i] <= hi));
    }
    return [];
  }
  function resetSelection(source = null) {
    state.selection = { source, ids: new Set(), dates: new Set(), box: null };
    if (source !== "pcp") state.brushes.clear();
  }
  function rangeText(i, lo, hi) {
    const name = SHORT[fields[i].key];
    if (lo === -Infinity) return `${name} ≤ ${format(hi)}`;
    if (hi === Infinity) return `${name} ≥ ${format(lo)}`;
    return `${name} ${format(lo)}–${format(hi)}`;
  }
  function filterText() {
    const parts = [];
    if (state.start !== DATA.range.start || state.end !== DATA.range.end) parts.push(`${state.start} to ${state.end}`);
    if (state.season !== "All") parts.push(state.season);
    if (state.month) parts.push(new Date(Date.UTC(2004, state.month - 1, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" }));
    if (state.dayType !== "All") parts.push(`${state.dayType}s`);
    if (state.hourFrom !== 0 || state.hourTo !== 23) parts.push(`hours ${state.hourFrom}–${state.hourTo}`);
    return parts.length ? `within ${parts.join(", ")}` : "";
  }
  function describeSelection() {
    const sel = state.selection;
    let text = "";
    if (sel.source === "pcp") text = "Brushed: " + [...state.brushes].map(([i, [lo, hi]]) => rangeText(i, lo, hi)).join(", ");
    else if (sel.source === "scatter" && sel.box) text = `Scatter box: ${rangeText(byKey[sel.box.x].index, ...sel.box.xr)} × ${rangeText(byKey[sel.box.y].index, ...sel.box.yr)}`;
    else if (sel.source === "heatmap") text = `Heatmap days: ${[...sel.dates].sort().join(", ")}`;
    const filters = filterText();
    return filters ? `${text} (${filters})` : text;
  }

  // ---------------------------------------------------------------- parallel coordinates
  let pcpGeom = null, pcpDrag = null;

  function renderParallel(current, chosen) {
    const canvas = $("parallel"), { ctx, w, h } = resize(canvas);
    const m = { l: 46, r: 46, t: 56, b: 26 };
    const step = (w - m.l - m.r) / (fields.length - 1);
    const xs = state.axisOrder.map((_, k) => m.l + k * step);
    const y = (s) => h - m.b - s * (h - m.t - m.b);
    pcpGeom = { m, xs, step, w, h, y };
    ctx.clearRect(0, 0, w, h);

    const sch = scheme(), chosenIds = new Set(chosen.map((r) => r.id)), hasSel = state.selection.source !== null;
    const iso = isolatedCategory(sch);
    const shown = iso ? current.filter((r) => sch.of(r) === iso) : current; // isolating hides every other line
    const buckets = new Map(); // stroke style -> records, so each style is stroked once
    const add = (style, r) => { if (!buckets.has(style)) buckets.set(style, []); buckets.get(style).push(r); };
    const back = [], front = [];
    [...shown].sort((a, b) => drawRank[a.id] - drawRank[b.id]).forEach((r) => {
      const colour = colourOf(r, sch);
      if (iso) {
        if (hasSel && !chosenIds.has(r.id)) back.push([hexA(colour, 0.05), r]);
        else front.push([hexA(colour, hasSel ? 0.3 : 0.1), r]);
      } else if (hasSel && !chosenIds.has(r.id)) back.push(["rgba(130,150,170,.025)", r]);
      else if (colour == null) back.push([hasSel ? hexA(GREY, 0.2) : "rgba(130,150,170,.02)", r]);
      else front.push([hexA(colour, hasSel ? 0.25 : 0.03), r]);
    });
    const polyline = (r) => state.axisOrder.forEach((fi, k) => {
      const py = y(scaled(fi, r.values[fi]));
      k ? ctx.lineTo(xs[k], py) : ctx.moveTo(xs[k], py);
    });
    // Stroke in small shuffled chunks so colours interleave instead of one colour sitting on top.
    [back, front].forEach((layer) => {
      for (let i = 0; i < layer.length; i += 250) {
        buckets.clear();
        layer.slice(i, i + 250).forEach(([style, r]) => add(style, r));
        buckets.forEach((rows, style) => {
          ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.beginPath();
          rows.forEach(polyline); ctx.stroke();
        });
      }
    });

    // Median profiles: saved groups (solid) and the current selection (dashed).
    const profile = (rows, colour, dashed) => {
      if (!rows.length) return;
      const pts = state.axisOrder.map((fi, k) => [xs[k], y(scaled(fi, median(rows.map((r) => r.values[fi]))))]);
      ctx.setLineDash(dashed ? [6, 4] : []);
      [["#fff", 6], [colour, 3]].forEach(([stroke, width]) => {
        ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.stroke();
      });
      ctx.setLineDash([]);
    };
    // When a category is isolated, only its own median (and the selected part of it) is drawn.
    state.groups.forEach((g) => { if (!iso || (state.colourBy === "group" && iso === g.name)) profile(current.filter((r) => g.ids.has(r.id)), g.colour, false); });
    if (hasSel) profile(iso ? chosen.filter((r) => sch.of(r) === iso) : chosen, INK, true);

    // Axes, labels and raw-unit end values.
    const clipped = state.scale === "p99";
    state.axisOrder.forEach((fi, k) => {
      const field = fields[fi], x = xs[k], [lo, hi] = domain(fi);
      ctx.strokeStyle = "#829ab1"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y(1)); ctx.lineTo(x, y(0)); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillStyle = INK; ctx.font = "bold 12px Arial";
      ctx.fillText(SHORT[field.key], x, 15);
      ctx.fillStyle = "#627d98"; ctx.font = "11px Arial";
      ctx.fillText(field.unit.replace(" response", ""), x, 29);
      ctx.fillText(`${clipped ? "≥ " : ""}${format(hi)}`, x, m.t - 8);
      ctx.fillText(`${clipped ? "≤ " : ""}${format(lo)}`, x, h - m.b + 15);
      const brush = state.brushes.get(fi);
      if (brush) {
        const top = y(brush[1] === Infinity ? 1 : scaled(fi, brush[1])), bottom = y(brush[0] === -Infinity ? 0 : scaled(fi, brush[0]));
        ctx.fillStyle = "rgba(16,42,67,.16)"; ctx.strokeStyle = INK;
        ctx.fillRect(x - 8, top, 16, bottom - top); ctx.strokeRect(x - 8, top, 16, bottom - top);
      }
    });
    if (pcpDrag?.mode === "brush") {
      const x = xs[state.axisOrder.indexOf(pcpDrag.field)], top = Math.min(pcpDrag.y0, pcpDrag.y1), height = Math.abs(pcpDrag.y1 - pcpDrag.y0);
      ctx.fillStyle = "rgba(16,42,67,.22)"; ctx.fillRect(x - 8, top, 16, height);
    }
    if (pcpDrag?.mode === "axis") {
      ctx.strokeStyle = INK; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pcpDrag.x, y(1)); ctx.lineTo(pcpDrag.x, y(0)); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function bindParallel() {
    const canvas = $("parallel");
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const nearestSlot = (x) => {
      if (!pcpGeom) return null;
      let best = null, dist = Infinity;
      pcpGeom.xs.forEach((ax, k) => { const d = Math.abs(ax - x); if (d < dist) { dist = d; best = k; } });
      return dist <= pcpGeom.step / 2 ? best : null;
    };
    const rawAt = (fi, py) => {
      // Within 5px of an axis end the brush is open-ended, so it also catches clipped values.
      const { m, h } = pcpGeom, s = (h - m.b - py) / (h - m.t - m.b), [lo, hi] = domain(fi);
      if (py <= m.t + 5) return Infinity;
      if (py >= h - m.b - 5) return -Infinity;
      return lo + s * (hi - lo);
    };
    canvas.addEventListener("pointerdown", (e) => {
      const { x, y } = local(e), slot = nearestSlot(x);
      if (slot == null) return;
      if (y < pcpGeom.m.t - 18) pcpDrag = { mode: "axis", slot, x };
      else if (Math.abs(x - pcpGeom.xs[slot]) <= 14) pcpDrag = { mode: "brush", field: state.axisOrder[slot], y0: y, y1: y };
      else return;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pcpDrag) return;
      const { x, y } = local(e);
      if (pcpDrag.mode === "brush") pcpDrag.y1 = Math.max(pcpGeom.m.t, Math.min(pcpGeom.h - pcpGeom.m.b, y));
      else pcpDrag.x = x;
      const current = filtered(); renderParallel(current, selected(current));
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!pcpDrag) return;
      const drag = pcpDrag; pcpDrag = null;
      if (drag.mode === "brush") {
        if (state.selection.source !== "pcp") resetSelection("pcp");
        if (Math.abs(drag.y1 - drag.y0) < 4) state.brushes.delete(drag.field);
        else {
          const a = rawAt(drag.field, Math.max(drag.y0, drag.y1)), b = rawAt(drag.field, Math.min(drag.y0, drag.y1));
          state.brushes.set(drag.field, [a, b]);
        }
        if (!state.brushes.size) resetSelection();
      } else {
        const target = Math.max(0, Math.min(fields.length - 1, Math.round((local(e).x - pcpGeom.m.l) / pcpGeom.step)));
        const [moved] = state.axisOrder.splice(drag.slot, 1);
        state.axisOrder.splice(target, 0, moved);
      }
      render();
    });
  }

  // ---------------------------------------------------------------- scatterplot
  let scatterTransform = null, scatterPoints = [], scatterDrag = null;

  function renderScatter(current, chosen) {
    const canvas = $("scatter"), { ctx, w, h } = resize(canvas), m = { l: 56, r: 18, t: 14, b: 42 };
    ctx.clearRect(0, 0, w, h);
    const x = byKey[state.x], y = byKey[state.y], [xmin, xmax] = DATA.ranges[x.key], [ymin, ymax] = DATA.ranges[y.key];
    const sx = (v) => m.l + (v - xmin) / (xmax - xmin) * (w - m.l - m.r);
    const sy = (v) => h - m.b - (v - ymin) / (ymax - ymin) * (h - m.t - m.b);
    scatterTransform = { sx, sy, m, w, h, xmin, xmax, ymin, ymax };

    ctx.strokeStyle = "#bcccdc"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, h - m.b); ctx.lineTo(w - m.r, h - m.b); ctx.stroke();
    ctx.fillStyle = "#486581"; ctx.font = "11px Arial";
    ctx.textAlign = "center";
    [xmin, (xmin + xmax) / 2, xmax].forEach((v) => ctx.fillText(format(v), sx(v), h - m.b + 14));
    ctx.font = "12px Arial"; ctx.fillText(`${x.label} (${x.unit})`, m.l + (w - m.l - m.r) / 2, h - 8);
    ctx.textAlign = "right"; ctx.font = "11px Arial";
    [ymin, (ymin + ymax) / 2, ymax].forEach((v) => ctx.fillText(format(v), m.l - 6, sy(v) + 4));
    ctx.save(); ctx.translate(14, m.t + (h - m.t - m.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.font = "12px Arial";
    ctx.fillText(`${y.label} (${y.unit})`, 0, 0); ctx.restore();

    const sch = scheme(), chosenIds = new Set(chosen.map((r) => r.id)), hasSel = state.selection.source !== null;
    scatterPoints = [];
    const back = [], front = [];
    const iso = isolatedCategory(sch);
    (iso ? current.filter((r) => sch.of(r) === iso) : current).forEach((r) => {
      const px = sx(r.values[x.index]), py = sy(r.values[y.index]), colour = colourOf(r, sch);
      scatterPoints.push({ r, px, py });
      if (iso && hasSel && !chosenIds.has(r.id)) front.push([px, py, colour, 0.2]); // isolated but unselected: faded group colour
      else if ((hasSel && !chosenIds.has(r.id)) || colour == null) back.push([px, py]);
      else front.push([px, py, colour, hasSel ? 0.85 : 0.5]);
    });
    ctx.fillStyle = "rgba(130,150,170,.18)";
    back.forEach(([px, py]) => ctx.fillRect(px - 1.5, py - 1.5, 3, 3));
    front.forEach(([px, py, colour, alpha]) => { ctx.fillStyle = hexA(colour, alpha); ctx.fillRect(px - 2, py - 2, 4, 4); });
    if (scatterDrag) {
      ctx.strokeStyle = INK; ctx.setLineDash([4, 3]);
      ctx.strokeRect(scatterDrag.x0, scatterDrag.y0, scatterDrag.x1 - scatterDrag.x0, scatterDrag.y1 - scatterDrag.y0);
      ctx.setLineDash([]);
    }
  }

  function bindScatter() {
    const canvas = $("scatter"), tooltip = $("tooltip");
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener("pointerdown", (e) => {
      const p = local(e); scatterDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (scatterDrag) {
        scatterDrag.x1 = p.x; scatterDrag.y1 = p.y; tooltip.hidden = true;
        const current = filtered(); renderScatter(current, selected(current)); return;
      }
      let nearest = null, best = 64;
      scatterPoints.forEach((pt) => { const d = (pt.px - p.x) ** 2 + (pt.py - p.y) ** 2; if (d < best) { best = d; nearest = pt; } });
      if (!nearest) { tooltip.hidden = true; return; }
      const rec = nearest.r, rect = canvas.getBoundingClientRect(), xf = byKey[state.x], yf = byKey[state.y];
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(p.x + 12, rect.width - 230)}px`;
      tooltip.style.top = `${Math.max(4, p.y - 56)}px`;
      tooltip.textContent = `${rec.date} ${String(rec.hour).padStart(2, "0")}:00 (${WEEKDAYS[rec.weekday]}, ${rec.season})\n${xf.label}: ${format(rec.values[xf.index])} ${xf.unit}\n${yf.label}: ${format(rec.values[yf.index])} ${yf.unit}`;
    });
    canvas.addEventListener("pointerup", () => {
      if (!scatterDrag || !scatterTransform) return;
      const d = scatterDrag; scatterDrag = null;
      const loX = Math.min(d.x0, d.x1), hiX = Math.max(d.x0, d.x1), loY = Math.min(d.y0, d.y1), hiY = Math.max(d.y0, d.y1);
      if (hiX - loX > 6 && hiY - loY > 6) {
        const t = scatterTransform;
        const invX = (px) => t.xmin + (px - t.m.l) / (t.w - t.m.l - t.m.r) * (t.xmax - t.xmin);
        const invY = (py) => t.ymin + (t.h - t.m.b - py) / (t.h - t.m.t - t.m.b) * (t.ymax - t.ymin);
        resetSelection("scatter");
        state.selection.ids = new Set(scatterPoints.filter((p) => p.px >= loX && p.px <= hiX && p.py >= loY && p.py <= hiY).map((p) => p.r.id));
        state.selection.box = { x: state.x, y: state.y, xr: [invX(loX), invX(hiX)], yr: [invY(hiY), invY(loY)] };
      }
      render();
    });
    canvas.addEventListener("mouseleave", () => { tooltip.hidden = true; });
  }

  // ---------------------------------------------------------------- daily heatmap
  const seqColour = (s) => {
    const a = [205, 226, 251], b = [13, 54, 107], t = clamp(s);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  };

  function renderHeatmap(current, chosen) {
    const svg = $("heatmap"), byDate = new Map(), selPerDay = new Map();
    current.forEach((r) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); });
    chosen.forEach((r) => selPerDay.set(r.date, (selPerDay.get(r.date) || 0) + 1));
    const threshold = Math.ceil((state.hourTo - state.hourFrom + 1) * 0.75);
    const days = [...byDate.entries()].filter(([, rows]) => rows.length >= threshold).sort((a, b) => a[0].localeCompare(b[0]));
    const bar = 40, left = 80 + bar, top = 28, col = 64, row = 18;
    const width = left + fields.length * col + 8, height = top + Math.max(days.length, 1) * row + 6;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`); svg.setAttribute("width", width); svg.setAttribute("height", height);
    svg.setAttribute("font-family", "Arial, Helvetica, sans-serif");
    svg.replaceChildren();
    svg.append(svgEl("rect", { x: 0, y: 0, width, height, fill: "#fff" }));
    svg.append(svgEl("text", { x: 76 + bar / 2, y: 19, "text-anchor": "middle", "font-size": 10, fill: "#486581" }, "selected"));
    state.axisOrder.forEach((fi, k) => svg.append(svgEl("text", { x: left + k * col + col / 2, y: 19, "text-anchor": "middle", "font-size": 10, fill: "#486581" }, SHORT[fields[fi].key])));
    days.forEach(([date, rows], ri) => {
      const ry = top + ri * row, isSel = state.selection.source === "heatmap" && state.selection.dates.has(date);
      const label = svgEl("text", { x: 72, y: ry + 13, "text-anchor": "end", "font-size": 10, fill: isSel ? INK : "#486581", "font-weight": isSel ? 700 : 400 }, date);
      label.style.cursor = "pointer";
      label.addEventListener("click", () => toggleDay(date));
      svg.append(label);
      const n = selPerDay.get(date) || 0;
      if (n) {
        const bw = Math.max(2, (bar - 4) * n / 24);
        const rect = svgEl("rect", { x: 76, y: ry + 3, width: bw, height: row - 8, fill: INK, rx: 1 });
        rect.append(svgEl("title", {}, `${date}: ${n} selected hour(s)`));
        svg.append(rect);
      }
      state.axisOrder.forEach((fi, k) => {
        const field = fields[fi], value = median(rows.map((r) => r.values[fi])), s = scaled(fi, value);
        const cw = 10 + s * (col - 16), x = left + k * col + (col - cw) / 2;
        const cell = svgEl("rect", { x, y: ry, width: cw, height: row - 2, rx: 1, fill: seqColour(s), stroke: isSel ? INK : "none", "stroke-width": 2 });
        cell.append(svgEl("title", {}, `${date}\n${field.label}: ${format(value)} ${field.unit}\nValid hours: ${rows.length}`));
        cell.style.cursor = "pointer";
        cell.addEventListener("click", () => toggleDay(date));
        svg.append(cell);
      });
    });
  }
  function toggleDay(date) {
    if (state.selection.source !== "heatmap") resetSelection("heatmap");
    const dates = state.selection.dates;
    dates.has(date) ? dates.delete(date) : dates.add(date);
    if (!dates.size) resetSelection();
    render();
  }

  // ---------------------------------------------------------------- selection and group panel
  function compositionSvg(members, current, colour) {
    const W = 640, H = 128, top = 14, base = 98, chartH = base - top;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    const memberIds = new Set(members.map((r) => r.id));
    const months = [...new Set(current.map((r) => r.yearMonth))].sort();
    const panels = [
      { title: "Hour of day", x: 34, width: 250, slots: [...Array(24).keys()], key: (r) => r.hour, name: (s) => `${String(s).padStart(2, "0")}:00`, tick: (s) => (s % 6 === 0 ? String(s).padStart(2, "0") : "") },
      { title: "Weekday", x: 304, width: 100, slots: [...Array(7).keys()], key: (r) => r.weekday, name: (s) => WEEKDAYS[s], tick: (s) => WEEKDAYS[s][0] },
      { title: "Month", x: 424, width: 210, slots: months, key: (r) => r.yearMonth, name: (s) => s, tick: (s) => (s.endsWith("-01") || s === months[0] ? s.slice(0, 4) : "") },
    ];
    [0, 0.5, 1].forEach((v) => {
      const y = base - v * chartH;
      svg.append(svgEl("line", { x1: 30, x2: W - 4, y1: y, y2: y, stroke: "#edf2f7" }));
      svg.append(svgEl("text", { x: 26, y: y + 3, "text-anchor": "end", "font-size": 9, fill: "#829ab1" }, `${v * 100}%`));
    });
    panels.forEach((p) => {
      svg.append(svgEl("text", { x: p.x, y: 9, "font-size": 10, fill: "#486581", "font-weight": 700 }, p.title));
      const totals = new Map(), hits = new Map();
      current.forEach((r) => { const k = p.key(r); totals.set(k, (totals.get(k) || 0) + 1); if (memberIds.has(r.id)) hits.set(k, (hits.get(k) || 0) + 1); });
      const bw = p.width / p.slots.length;
      p.slots.forEach((s, i) => {
        const total = totals.get(s) || 0, hit = hits.get(s) || 0, rate = total ? hit / total : 0;
        const bh = rate * chartH, x = p.x + i * bw;
        const rect = svgEl("rect", { x: x + 1, y: base - bh, width: Math.max(1, bw - 2), height: bh, fill: colour, rx: Math.min(2, bw / 4) });
        rect.append(svgEl("title", {}, `${p.name(s)}: ${hit} of ${total} visible hours in the group (${Math.round(rate * 100)}%)`));
        svg.append(rect);
        const label = p.tick(s);
        if (label) svg.append(svgEl("text", { x: x + bw / 2, y: base + 12, "text-anchor": "middle", "font-size": 9, fill: "#627d98" }, label));
      });
    });
    return svg;
  }

  function groupCard(title, colour, members, current, definedBy) {
    const card = document.createElement("div");
    card.className = "group-card";
    const h3 = document.createElement("h3");
    const swatch = document.createElement("i"); swatch.style.background = colour;
    h3.append(swatch, `${title}: ${members.length.toLocaleString()} visible hours (${current.length ? Math.round(members.length / current.length * 100) : 0}%)`);
    const p = document.createElement("p"); p.className = "defined-by"; p.textContent = definedBy;
    card.append(h3, p, compositionSvg(members, current, colour));
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    ["", ...state.axisOrder.map((fi) => SHORT[fields[fi].key])].forEach((t) => { const th = document.createElement("th"); th.textContent = t; head.append(th); });
    const body = table.createTBody();
    [["Median", members], ["All visible", current]].forEach(([label, rows]) => {
      const tr = body.insertRow(); tr.insertCell().textContent = label;
      state.axisOrder.forEach((fi) => { tr.insertCell().textContent = format(median(rows.map((r) => r.values[fi]))); });
    });
    card.append(table);
    return card;
  }

  function renderGroups(current, chosen) {
    const box = $("groups");
    box.replaceChildren();
    if (state.selection.source !== null) box.append(groupCard("Current selection", INK, chosen, current, describeSelection() || "—"));
    state.groups.forEach((g) => box.append(groupCard(g.name, g.colour, current.filter((r) => g.ids.has(r.id)), current, g.definedBy)));
    if (!box.children.length) {
      const note = document.createElement("p"); note.className = "empty-note";
      note.textContent = "Brush the parallel coordinates, drag a box on the scatterplot or click heatmap days to select hours. Save up to three selections as groups.";
      box.append(note);
    }
  }

  function saveGroup() {
    const current = filtered(), chosen = selected(current);
    if (!chosen.length || state.groups.length >= MAX_GROUPS) return;
    const used = new Set(state.groups.map((g) => g.colour)), slot = CAT3.findIndex((c) => !used.has(c));
    state.groups.push({ name: `Group ${"ABC"[slot]}`, colour: CAT3[slot], ids: new Set(chosen.map((r) => r.id)), definedBy: describeSelection() });
    state.groups.sort((a, b) => a.name.localeCompare(b.name));
    resetSelection();
    state.colourBy = "group"; state.isolated = null; $("colourBy").value = "group";
    render();
  }

  // ---------------------------------------------------------------- legend, status, render
  function renderLegend() {
    const box = $("colourLegend"), sch = scheme();
    box.replaceChildren();
    if (!sch || !sch.categories.length) {
      const hint = document.createElement("span"); hint.className = "hint";
      hint.textContent = state.colourBy === "group" ? "No saved groups yet: save a selection to colour by group." : "Single colour.";
      box.append(hint); return;
    }
    if (state.isolated && !sch.categories.includes(state.isolated)) state.isolated = null;
    sch.categories.forEach((cat, i) => {
      const b = document.createElement("button");
      const sw = document.createElement("i"); sw.style.background = sch.colours[i];
      b.append(sw, cat);
      b.setAttribute("aria-pressed", String(state.isolated === cat));
      if (state.isolated && state.isolated !== cat) b.classList.add("dimmed");
      b.addEventListener("click", () => { state.isolated = state.isolated === cat ? null : cat; render(); });
      box.append(b);
    });
    const hint = document.createElement("span"); hint.className = "hint"; hint.textContent = state.isolated ? "Showing only the isolated category. Click it again to show all." : "Click a category to show only its lines.";
    box.append(hint);
  }

  function updateStatus(current, chosen) {
    $("visibleCount").textContent = `Visible core records: ${current.length.toLocaleString()}`;
    $("selectedCount").textContent = state.selection.source ? `Selected records: ${chosen.length.toLocaleString()}` : "No candidate group selected";
    $("coverageInfo").textContent = `Daily heatmap coverage threshold: ${Math.ceil((state.hourTo - state.hourFrom + 1) * 0.75)} valid hour(s)`;
    $("saveGroup").disabled = !chosen.length || state.groups.length >= MAX_GROUPS;
    $("clearGroups").disabled = !state.groups.length;
  }

  // ---------------------------------------------------------------- Task 2: temporal views
  const DIVERGING = { low: [42, 120, 214], mid: [240, 239, 236], high: [227, 73, 72] }; // blue - grey - red
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c) => `rgb(${c.join(",")})`;
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const MIN_HOURS = 5; // cells with fewer complete hours are marked as unreliable

  function temporalEntities(chosen) {
    const list = state.groups.map((g) => ({ name: g.name, colour: g.colour, ids: g.ids, definedBy: g.definedBy }));
    if (state.selection.source !== null) list.push({ name: "Current selection", colour: INK, ids: new Set(chosen.map((r) => r.id)), definedBy: describeSelection() });
    return list;
  }
  const monthsOf = (current) => [...new Set(current.map((r) => r.yearMonth))].sort();

  function membershipSvg(entity, current) {
    const months = monthsOf(current), cw = 20, ch = 16, left = 62, top = 46;
    const W = left + 24 * cw + 12, H = top + months.length * ch + 40;
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": "Arial, Helvetica, sans-serif" });
    const defs = svgEl("defs"), pat = svgEl("pattern", { id: `hatch-${entity.name.replace(/\W/g, "")}`, width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pat.append(svgEl("rect", { width: 4, height: 4, fill: "#fff" }), svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 4, stroke: "#bcccdc", "stroke-width": 1.5 }));
    defs.append(pat); svg.append(defs);
    svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    svg.append(svgEl("rect", { x: 0, y: 4, width: 12, height: 12, rx: 3, fill: entity.colour }));
    svg.append(svgEl("text", { x: 18, y: 15, "font-size": 13, "font-weight": 700, fill: INK }, entity.name));
    svg.append(svgEl("text", { x: 0, y: 31, "font-size": 10, fill: "#627d98" }, entity.definedBy || ""));
    const totals = new Map(), hits = new Map();
    current.forEach((r) => {
      const k = `${r.yearMonth}|${r.hour}`;
      totals.set(k, (totals.get(k) || 0) + 1);
      if (entity.ids.has(r.id)) hits.set(k, (hits.get(k) || 0) + 1);
    });
    const base = [244, 246, 248], full = hexRgb(entity.colour);
    for (let h = 0; h < 24; h += 3) svg.append(svgEl("text", { x: left + h * cw + cw / 2, y: top - 4, "text-anchor": "middle", "font-size": 9, fill: "#627d98" }, String(h).padStart(2, "0")));
    months.forEach((ym, mi) => {
      const y = top + mi * ch;
      svg.append(svgEl("text", { x: left - 6, y: y + 11, "text-anchor": "end", "font-size": 9, fill: "#486581" }, ym));
      for (let h = 0; h < 24; h++) {
        const total = totals.get(`${ym}|${h}`) || 0, hit = hits.get(`${ym}|${h}`) || 0, rate = total ? hit / total : 0;
        const cell = svgEl("rect", { x: left + h * cw, y, width: cw - 1, height: ch - 1, fill: total ? rgb(mix(base, full, rate)) : `url(#${pat.getAttribute("id")})` });
        cell.append(svgEl("title", {}, total ? `${ym}, ${String(h).padStart(2, "0")}:00: ${hit} of ${total} complete hours (${Math.round(rate * 100)}%)` : `${ym}, ${String(h).padStart(2, "0")}:00: no complete hours`));
        svg.append(cell);
        if (total && total < MIN_HOURS) svg.append(svgEl("circle", { cx: left + h * cw + cw / 2 - 0.5, cy: y + ch / 2 - 0.5, r: 1.6, fill: "#627d98" }));
      }
    });
    // legend
    const ly = top + months.length * ch + 14;
    for (let i = 0; i <= 10; i++) svg.append(svgEl("rect", { x: left + i * 14, y: ly, width: 14, height: 9, fill: rgb(mix(base, full, i / 10)) }));
    svg.append(svgEl("text", { x: left, y: ly + 21, "font-size": 9, fill: "#627d98" }, "0%"));
    svg.append(svgEl("text", { x: left + 154, y: ly + 21, "text-anchor": "end", "font-size": 9, fill: "#627d98" }, "100% of hours in group"));
    svg.append(svgEl("rect", { x: left + 180, y: ly, width: 14, height: 9, fill: `url(#${pat.getAttribute("id")})` }));
    svg.append(svgEl("text", { x: left + 198, y: ly + 8, "font-size": 9, fill: "#627d98" }, "no complete hours"));
    svg.append(svgEl("circle", { cx: left + 300, cy: ly + 4.5, r: 1.6, fill: "#627d98" }));
    svg.append(svgEl("text", { x: left + 306, y: ly + 8, "font-size": 9, fill: "#627d98" }, `fewer than ${MIN_HOURS} hours`));
    return svg;
  }

  function renderMembership(current, entities) {
    const box = $("membership");
    box.replaceChildren();
    if (!entities.length) {
      const note = document.createElement("p"); note.className = "empty-note";
      note.textContent = "Save groups (or make a selection) to see how their membership changes by month and hour.";
      box.append(note); return;
    }
    entities.forEach((e) => box.append(membershipSvg(e, current)));
  }

  function profileSvg(entity, current) {
    const months = monthsOf(current), cw = 64, ch = 18, left = 62, top = 22, nCol = 44;
    const W = left + nCol + state.axisOrder.length * cw + 10, H = top + months.length * ch + 40;
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": "Arial, Helvetica, sans-serif" });
    svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    svg.append(svgEl("text", { x: left + nCol / 2, y: 14, "text-anchor": "middle", "font-size": 10, fill: "#486581" }, "hours"));
    state.axisOrder.forEach((fi, k) => svg.append(svgEl("text", { x: left + nCol + k * cw + cw / 2, y: 14, "text-anchor": "middle", "font-size": 10, "font-weight": 700, fill: "#486581" }, SHORT[fields[fi].key])));
    months.forEach((ym, mi) => {
      const y = top + mi * ch, monthRows = current.filter((r) => r.yearMonth === ym), members = monthRows.filter((r) => entity.ids.has(r.id));
      svg.append(svgEl("text", { x: left - 6, y: y + 12, "text-anchor": "end", "font-size": 9, fill: "#486581" }, ym));
      svg.append(svgEl("text", { x: left + nCol - 6, y: y + 12, "text-anchor": "end", "font-size": 9, fill: members.length < MIN_HOURS ? "#9fb3c8" : "#486581" }, String(members.length)));
      state.axisOrder.forEach((fi, k) => {
        const x = left + nCol + k * cw;
        if (members.length < MIN_HOURS) {
          svg.append(svgEl("rect", { x, y, width: cw - 2, height: ch - 2, fill: "#fff", stroke: "#edf2f7" }));
          return;
        }
        const gm = median(members.map((r) => r.values[fi])), mm = median(monthRows.map((r) => r.values[fi])), [lo, hi] = domain(fi);
        const diff = Math.max(-1, Math.min(1, (gm - mm) / (hi - lo) * 2)); // half the axis range = full colour
        const colour = diff >= 0 ? mix(DIVERGING.mid, DIVERGING.high, diff) : mix(DIVERGING.mid, DIVERGING.low, -diff);
        const cell = svgEl("rect", { x, y, width: cw - 2, height: ch - 2, fill: rgb(colour) });
        cell.append(svgEl("title", {}, `${ym} · ${fields[fi].label}\n${entity.name} median: ${format(gm)} ${fields[fi].unit}\nAll hours that month: ${format(mm)}\n${members.length} hours in the group`));
        svg.append(cell);
        svg.append(svgEl("text", { x: x + (cw - 2) / 2, y: y + 12, "text-anchor": "middle", "font-size": 9, fill: Math.abs(diff) > 0.6 ? "#fff" : INK }, format(gm)));
      });
    });
    const ly = top + months.length * ch + 12, lx = left + nCol;
    for (let i = -5; i <= 5; i++) {
      const t = i / 5, colour = t >= 0 ? mix(DIVERGING.mid, DIVERGING.high, t) : mix(DIVERGING.mid, DIVERGING.low, -t);
      svg.append(svgEl("rect", { x: lx + (i + 5) * 14, y: ly, width: 14, height: 9, fill: rgb(colour) }));
    }
    svg.append(svgEl("text", { x: lx, y: ly + 21, "font-size": 9, fill: "#627d98" }, "lower than other hours that month"));
    svg.append(svgEl("text", { x: lx + 154, y: ly + 21, "font-size": 9, fill: "#627d98" }, "higher"));
    svg.append(svgEl("text", { x: lx + 200, y: ly + 8, "font-size": 9, fill: "#627d98" }, `Numbers are group medians. Blank: fewer than ${MIN_HOURS} hours.`));
    return svg;
  }

  function renderProfile(current, entities) {
    const select = $("profileEntity"), box = $("profile");
    const names = entities.map((e) => e.name), previous = select.value;
    select.replaceChildren(...names.map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n })));
    if (names.includes(previous)) select.value = previous;
    box.replaceChildren();
    const entity = entities.find((e) => e.name === select.value);
    if (!entity) {
      const note = document.createElement("p"); note.className = "empty-note";
      note.textContent = "Save groups (or make a selection) to see which attributes define them in each month.";
      box.append(note); return;
    }
    box.append(profileSvg(entity, current));
  }

  function renderMonthly(current) {
    const canvas = $("monthly"), months = monthsOf(current), perRow = 5, rows = Math.max(1, Math.ceil(months.length / perRow));
    canvas.parentElement.style.height = `${rows * 170 + 10}px`;
    const { ctx, w, h } = resize(canvas);
    ctx.clearRect(0, 0, w, h);
    const pw = w / perRow, ph = (h - 10) / rows, m = { l: 14, r: 14, t: 22, b: 18 };
    const hasSel = state.selection.source !== null, selIds = hasSel ? new Set(selected(current).map((r) => r.id)) : null;
    months.forEach((ym, idx) => {
      const ox = (idx % perRow) * pw, oy = Math.floor(idx / perRow) * ph;
      const step = (pw - m.l - m.r) / (fields.length - 1), xs = state.axisOrder.map((_, k) => ox + m.l + k * step);
      const y = (s) => oy + ph - m.b - s * (ph - m.t - m.b);
      const rows2 = current.filter((r) => r.yearMonth === ym);
      const line = (r) => state.axisOrder.forEach((fi, k) => { const py = y(scaled(fi, r.values[fi])); k ? ctx.lineTo(xs[k], py) : ctx.moveTo(xs[k], py); });
      ctx.lineWidth = 1;
      // Each panel has only a few hundred lines, so they are drawn more opaque than in the main view.
      ctx.strokeStyle = "rgba(130,150,170,.14)"; ctx.beginPath(); rows2.forEach(line); ctx.stroke();
      state.groups.forEach((g) => { ctx.strokeStyle = hexA(g.colour, 0.18); ctx.beginPath(); rows2.filter((r) => g.ids.has(r.id)).forEach(line); ctx.stroke(); });
      if (hasSel) { ctx.strokeStyle = hexA(INK, 0.18); ctx.beginPath(); rows2.filter((r) => selIds.has(r.id)).forEach(line); ctx.stroke(); }
      const profile = (members, colour, dashed) => {
        if (members.length < MIN_HOURS) return;
        ctx.setLineDash(dashed ? [4, 3] : []);
        [["#fff", 4.5], [colour, 2]].forEach(([stroke, width]) => {
          ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.beginPath();
          state.axisOrder.forEach((fi, k) => { const py = y(scaled(fi, median(members.map((r) => r.values[fi])))); k ? ctx.lineTo(xs[k], py) : ctx.moveTo(xs[k], py); });
          ctx.stroke();
        });
        ctx.setLineDash([]);
      };
      state.groups.forEach((g) => profile(rows2.filter((r) => g.ids.has(r.id)), g.colour, false));
      if (hasSel) profile(rows2.filter((r) => selIds.has(r.id)), INK, true);
      ctx.strokeStyle = "#bcccdc"; ctx.lineWidth = 1;
      xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, y(1)); ctx.lineTo(x, y(0)); ctx.stroke(); });
      ctx.fillStyle = INK; ctx.font = "bold 11px Arial"; ctx.textAlign = "left";
      ctx.fillText(`${ym}  (${rows2.length} h)`, ox + m.l, oy + 13);
      ctx.fillStyle = "#627d98"; ctx.font = "8px Arial"; ctx.textAlign = "center";
      state.axisOrder.forEach((fi, k) => ctx.fillText(SHORT[fields[fi].key].replace(/ \(.*\)/, ""), xs[k], oy + ph - 5));
    });
  }

  function renderTemporal(current, chosen) {
    const entities = temporalEntities(chosen);
    renderMembership(current, entities);
    renderProfile(current, entities);
    renderMonthly(current);
  }

  function restoreTask1Groups() {
    Object.assign(state, { start: DATA.range.start, end: DATA.range.end, season: "All", month: 0, dayType: "All", hourFrom: 0, hourTo: 23 });
    $("startDate").value = state.start; $("endDate").value = state.end; $("season").value = "All"; $("month").value = "0";
    $("dayType").value = "All"; $("hourFrom").value = "0"; $("hourTo").value = "23";
    state.groups = [];
    const brushSets = [
      [["co_gt", 3.5, Infinity]],
      [["co_gt", -Infinity, 0.9], ["nox_gt", -Infinity, 90]],
      [["t", 26, Infinity], ["rh", -Infinity, 35]],
    ];
    brushSets.forEach((set) => {
      resetSelection(); // clears any brushes left from earlier exploration
      resetSelection("pcp");
      set.forEach(([key, lo, hi]) => state.brushes.set(byKey[key].index, [lo, hi]));
      saveGroup();
    });
    resetSelection("pcp");
    state.brushes.set(byKey.t.index, [-Infinity, 10]); // Group D is kept as the current selection
    render();
  }

  function render() {
    const current = filtered(), chosen = selected(current);
    updateStatus(current, chosen);
    renderLegend();
    renderParallel(current, chosen);
    renderScatter(current, chosen);
    renderHeatmap(current, chosen);
    renderGroups(current, chosen);
    renderTemporal(current, chosen);
  }

  // ---------------------------------------------------------------- export
  function groupsSvg() {
    const current = filtered(), chosen = selected(current), items = [];
    if (state.selection.source !== null) items.push(["Current selection", INK, chosen, describeSelection() || "—"]);
    state.groups.forEach((g) => items.push([g.name, g.colour, current.filter((r) => g.ids.has(r.id)), g.definedBy]));
    const W = 660, itemH = 236, H = Math.max(1, items.length) * itemH;
    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": "Arial, Helvetica, sans-serif" });
    svg.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
    items.forEach(([title, colour, members, definedBy], k) => {
      const g = svgEl("g", { transform: `translate(10, ${k * itemH + 6})` });
      const share = current.length ? Math.round(members.length / current.length * 100) : 0;
      g.append(svgEl("rect", { x: 0, y: 2, width: 12, height: 12, rx: 3, fill: colour }));
      g.append(svgEl("text", { x: 18, y: 13, "font-size": 13, "font-weight": 700, fill: INK }, `${title}: ${members.length.toLocaleString()} visible hours (${share}%)`));
      g.append(svgEl("text", { x: 0, y: 30, "font-size": 11, fill: "#627d98" }, definedBy));
      const inner = svgEl("svg", { x: 0, y: 38, width: 640, height: 128, viewBox: "0 0 640 128" });
      inner.append(...compositionSvg(members, current, colour).childNodes);
      g.append(inner);
      const colX = (j) => 120 + j * 64;
      state.axisOrder.forEach((fi, j) => g.append(svgEl("text", { x: colX(j), y: 186, "text-anchor": "end", "font-size": 10, "font-weight": 700, fill: "#486581" }, SHORT[fields[fi].key])));
      [["Median", members, INK], ["All visible", current, "#627d98"]].forEach(([label, rows, fill], i) => {
        const y = 202 + i * 16;
        g.append(svgEl("text", { x: 0, y, "font-size": 11, fill }, label));
        state.axisOrder.forEach((fi, j) => g.append(svgEl("text", { x: colX(j), y, "text-anchor": "end", "font-size": 11, fill }, format(median(rows.map((r) => r.values[fi]))))));
      });
      svg.append(g);
    });
    return svg;
  }

  function rasterise(svg, compose) {
    const w = +svg.getAttribute("width"), h = +svg.getAttribute("height");
    const xml = new XMLSerializer().serializeToString(svg);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(compose(img, w, h));
      img.onerror = reject;
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml.includes("xmlns=") ? xml : xml.replace("<svg", `<svg xmlns="${SVG_NS}"`));
    });
  }

  function exportView(name) {
    const titles = { parallel: "Parallel coordinates", scatter: "Pollutant relationships", heatmap: "Daily profile heatmap", groups: "Selection and saved groups",
      membership: "Group membership by month and hour of day", profile: `Group profile by month: ${$("profileEntity").value}`, monthly: "Monthly parallel coordinates" };
    const sch = scheme(), title = `${titles[name]}${filterText() ? " " + filterText() : ""}`;
    const compose = (img, w, h) => {
      const dpr = window.devicePixelRatio || 1, strip = ["groups", "membership", "profile"].includes(name) ? 26 : 44;
      const out = document.createElement("canvas");
      out.width = Math.round(w * dpr); out.height = Math.round((h + strip) * dpr);
      const ctx = out.getContext("2d"); ctx.scale(dpr, dpr);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h + strip);
      ctx.fillStyle = INK; ctx.font = "bold 13px Arial"; ctx.fillText(title, 10, 18);
      let x = 10;
      ctx.font = "12px Arial";
      const legendItems = name === "monthly" ? temporalEntities(selected(filtered())).map((e) => [e.name, e.colour])
        : sch && (name === "parallel" || name === "scatter") ? sch.categories.map((cat, i) => [cat, state.isolated && state.isolated !== cat ? GREY : sch.colours[i]]) : [];
      legendItems.forEach(([cat, colour]) => {
        ctx.fillStyle = colour; ctx.fillRect(x, 28, 10, 10);
        ctx.fillStyle = INK; ctx.fillText(cat, x + 14, 37); x += ctx.measureText(cat).width + 30;
      });
      ctx.drawImage(img, 0, strip, w, h);
      return out.toDataURL("image/png");
    };
    if (name === "heatmap") return rasterise($("heatmap"), compose);
    if (name === "groups") return rasterise(groupsSvg(), compose);
    if (name === "profile") return rasterise($("profile").querySelector("svg"), compose);
    if (name === "membership") {
      const parts = [...$("membership").querySelectorAll("svg")], perRow = 2;
      const cw = Math.max(...parts.map((p) => +p.getAttribute("width"))), chh = Math.max(...parts.map((p) => +p.getAttribute("height")));
      const W = cw * Math.min(perRow, parts.length), H = chh * Math.ceil(parts.length / perRow);
      const all = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      all.append(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fff" }));
      parts.forEach((p, i) => { const c = p.cloneNode(true); c.setAttribute("x", (i % perRow) * cw); c.setAttribute("y", Math.floor(i / perRow) * chh); all.append(c); });
      return rasterise(all, compose);
    }
    const canvas = $(name), rect = canvas.getBoundingClientRect();
    return Promise.resolve(compose(canvas, rect.width, rect.height));
  }
  function download(name) {
    exportView(name).then((url) => {
      const a = document.createElement("a"); a.href = url; a.download = `task1-${name}.png`; a.click();
    });
  }

  // ---------------------------------------------------------------- controls
  function setOptions() {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    months.forEach((label, i) => $("month").insertAdjacentHTML("beforeend", `<option value="${i + 1}">${label}</option>`));
    for (let h = 0; h < 24; h++) {
      const opt = `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`;
      $("hourFrom").insertAdjacentHTML("beforeend", opt); $("hourTo").insertAdjacentHTML("beforeend", opt);
    }
    $("hourTo").value = "23";
    fields.forEach((field) => {
      const opt = `<option value="${field.key}">${field.label}</option>`;
      $("xField").insertAdjacentHTML("beforeend", opt); $("yField").insertAdjacentHTML("beforeend", opt);
    });
    $("xField").value = state.x; $("yField").value = state.y;
    $("startDate").min = $("endDate").min = DATA.range.start;
    $("startDate").max = $("endDate").max = DATA.range.end;
    $("startDate").value = state.start; $("endDate").value = state.end;
    $("cohortNote").textContent = `Core analysis cohort: ${DATA.coreRows.toLocaleString()} complete hourly records (${Math.round(DATA.coreRows / DATA.sourceRows * 100)}% of ${DATA.sourceRows.toLocaleString()}). Hours with any missing attribute are excluded, never filled in.`;
  }

  function bindControls() {
    const sync = () => {
      state.start = $("startDate").value; state.end = $("endDate").value; state.season = $("season").value;
      state.month = +$("month").value; state.dayType = $("dayType").value;
      state.hourFrom = +$("hourFrom").value; state.hourTo = +$("hourTo").value;
      if (state.hourFrom > state.hourTo) { state.hourTo = state.hourFrom; $("hourTo").value = String(state.hourTo); }
      render();
    };
    ["startDate", "endDate", "season", "month", "dayType", "hourFrom", "hourTo"].forEach((id) => $(id).addEventListener("change", sync));
    $("colourBy").addEventListener("change", (e) => { state.colourBy = e.target.value; state.isolated = null; render(); });
    $("scale").addEventListener("change", (e) => { state.scale = e.target.value; render(); });
    $("xField").addEventListener("change", (e) => { state.x = e.target.value; render(); });
    $("yField").addEventListener("change", (e) => { state.y = e.target.value; render(); });
    $("resetAxes").addEventListener("click", () => { state.axisOrder = fields.map((_, i) => i); render(); });
    $("clearSelection").addEventListener("click", () => { resetSelection(); render(); });
    $("saveGroup").addEventListener("click", saveGroup);
    $("clearGroups").addEventListener("click", () => { state.groups = []; if (state.colourBy === "group") state.isolated = null; render(); });
    $("resetFilters").addEventListener("click", () => {
      Object.assign(state, { start: DATA.range.start, end: DATA.range.end, season: "All", month: 0, dayType: "All", hourFrom: 0, hourTo: 23 });
      $("startDate").value = state.start; $("endDate").value = state.end; $("season").value = "All"; $("month").value = "0";
      $("dayType").value = "All"; $("hourFrom").value = "0"; $("hourTo").value = "23";
      render();
    });
    document.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => download(b.dataset.export)));
    $("profileEntity").addEventListener("change", () => { const current = filtered(); renderProfile(current, temporalEntities(selected(current))); });
    $("restoreGroups").addEventListener("click", restoreTask1Groups);
  }

  setOptions(); bindControls(); bindParallel(); bindScatter();
  window.addEventListener("resize", render);
  render();

  // Hook for reproducing documented selections and exporting figures from the console.
  window.task1 = { state, render, exportView, saveGroup, restoreTask1Groups, clearSelection: () => { resetSelection(); render(); },
    brush: (key, lo, hi) => { if (state.selection.source !== "pcp") resetSelection("pcp"); state.brushes.set(byKey[key].index, [lo, hi]); render(); } };
})();
