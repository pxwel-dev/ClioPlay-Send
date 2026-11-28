import { formatDistance, formatDuration } from "./protocol.js";

/**
 * Render the mobility.h + mobility_ml.h Driving Insights visualiser inside the Car tab.
 * Every place / hotspot / drive card is tappable to plot on the Mini-Map & route in 1 tap.
 */
export function renderInsights(container, insights, { imperial = false, t, onPickPoint } = {}) {
  if (!container) return;
  if (!insights || !insights.journeyCount) {
    container.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "insights-empty";
    empty.textContent = t("insights_empty");
    container.appendChild(empty);
    return;
  }

  container.replaceChildren();

  // 1. Odometer Glass Grid (4 KPI tiles)
  const kpiGrid = document.createElement("div");
  kpiGrid.className = "kpi-grid";
  const kpis = [
    { label: t("insights_total_dist"), value: formatDistance(insights.totalDistM, imperial) },
    { label: t("insights_drives"), value: String(insights.journeyCount) },
    { label: t("insights_time_driven"), value: formatDuration(insights.totalDurS) },
    { label: t("insights_longest"), value: formatDistance(insights.longestDistM, imperial) }
  ];
  for (const k of kpis) {
    const card = document.createElement("div");
    card.className = "kpi-tile";
    const v = document.createElement("strong");
    v.textContent = k.value;
    const l = document.createElement("small");
    l.textContent = k.label;
    card.append(v, l);
    kpiGrid.appendChild(card);
  }
  container.appendChild(kpiGrid);

  // 2. Weekly & 24h Driving Rhythm Bars
  const rhythmWrap = document.createElement("div");
  rhythmWrap.className = "rhythm-grid";

  const dayBox = document.createElement("div");
  dayBox.className = "rhythm-card";
  const dayTitle = document.createElement("span");
  dayTitle.className = "rhythm-title";
  dayTitle.textContent = t("insights_rhythm_week");
  const dayBars = document.createElement("div");
  dayBars.className = "bar-chart days";
  const dayLabels = [
    t("day_mon"), t("day_tue"), t("day_wed"), t("day_thu"),
    t("day_fri"), t("day_sat"), t("day_sun")
  ];
  const maxDay = Math.max(1, ...(insights.dayCounts || [0]));
  for (let i = 0; i < 7; i++) {
    const val = insights.dayCounts?.[i] || 0;
    const col = document.createElement("div");
    col.className = "bar-col";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    fill.style.height = `${Math.max(8, Math.round((val / maxDay) * 100))}%`;
    fill.title = `${dayLabels[i]}: ${val}`;
    const lbl = document.createElement("small");
    lbl.textContent = dayLabels[i];
    col.append(fill, lbl);
    dayBars.appendChild(col);
  }
  dayBox.append(dayTitle, dayBars);

  const hourBox = document.createElement("div");
  hourBox.className = "rhythm-card";
  const hourTitle = document.createElement("span");
  hourTitle.className = "rhythm-title";
  hourTitle.textContent = t("insights_rhythm_day");
  const hourBars = document.createElement("div");
  hourBars.className = "bar-chart hours";
  const maxHour = Math.max(1, ...(insights.hour2Counts || [0]));
  for (let i = 0; i < 12; i++) {
    const val = insights.hour2Counts?.[i] || 0;
    const col = document.createElement("div");
    col.className = "bar-col";
    const fill = document.createElement("span");
    fill.className = "bar-fill accent";
    fill.style.height = `${Math.max(8, Math.round((val / maxHour) * 100))}%`;
    const lbl = document.createElement("small");
    lbl.textContent = i % 3 === 0 ? String(i * 2).padStart(2, "0") : "";
    col.append(fill, lbl);
    hourBars.appendChild(col);
  }
  hourBox.append(hourTitle, hourBars);
  rhythmWrap.append(dayBox, hourBox);
  container.appendChild(rhythmWrap);

  // 3. Learned Road-Class & Cold-Weather Pace Profile
  const paceItems = [
    { label: t("pace_motorway"), pct: insights.clsPace?.motorway || 0 },
    { label: t("pace_aroad"), pct: insights.clsPace?.aRoad || 0 },
    { label: t("pace_broad"), pct: insights.clsPace?.bRoad || 0 },
    { label: t("pace_local"), pct: insights.clsPace?.local || 0 }
  ].filter(p => p.pct > 0);
  if (paceItems.length || insights.coldPace > 0) {
    const paceCard = document.createElement("div");
    paceCard.className = "insight-block";
    const head = document.createElement("h4");
    head.textContent = t("insights_pace_title");
    paceCard.appendChild(head);
    const list = document.createElement("div");
    list.className = "pace-list";
    for (const p of paceItems) {
      const delta = p.pct - 100;
      const row = document.createElement("div");
      row.className = "pace-row";
      const name = document.createElement("span");
      name.textContent = p.label;
      const track = document.createElement("div");
      track.className = "pace-track";
      const bar = document.createElement("span");
      bar.className = `pace-bar${delta >= 0 ? " fast" : " calm"}`;
      bar.style.width = `${Math.max(15, Math.min(100, Math.round((p.pct - 50) / 1.0)))}%`;
      track.appendChild(bar);
      const val = document.createElement("strong");
      val.textContent = delta === 0 ? "100%" : `${delta > 0 ? "+" : ""}${delta}%`;
      row.append(name, track, val);
      list.appendChild(row);
    }
    if (insights.coldPace > 0) {
      const coldNote = document.createElement("small");
      coldNote.className = "cold-pace-note";
      const cd = insights.coldPace - 100;
      coldNote.textContent = t("insights_cold_pace", { delta: `${cd > 0 ? "+" : ""}${cd}%` });
      paceCard.append(list, coldNote);
    } else {
      paceCard.appendChild(list);
    }
    container.appendChild(paceCard);
  }

  // 4. Learned Intelligence Badges
  const badges = [
    insights.learnedRoads > 0 ? t("badge_roads", { n: insights.learnedRoads }) : "",
    insights.learnedParking > 0 ? t("badge_parking", { n: insights.learnedParking }) : "",
    insights.learnedStops > 0 ? t("badge_stops", { n: insights.learnedStops }) : "",
    insights.learnedHazards > 0 ? t("badge_hazards", { n: insights.learnedHazards }) : "",
    (insights.brightDay > 0 || insights.brightNight > 0)
      ? t("badge_brightness", { day: insights.brightDay || "—", night: insights.brightNight || "—" })
      : ""
  ].filter(Boolean);
  if (badges.length) {
    const row = document.createElement("div");
    row.className = "intel-badges";
    for (const text of badges) {
      const span = document.createElement("span");
      span.className = "intel-badge";
      span.textContent = text;
      row.appendChild(span);
    }
    container.appendChild(row);
  }

  // 5. Top Visited Places (tappable -> plot on Mini-Map!)
  if (insights.topPlaces?.length) {
    const sec = document.createElement("div");
    sec.className = "insight-block";
    const h = document.createElement("h4");
    h.textContent = t("insights_top_places");
    sec.appendChild(h);
    const ul = document.createElement("ul");
    ul.className = "insight-list";
    for (const pl of insights.topPlaces) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "insight-row-btn";
      const strong = document.createElement("strong");
      strong.textContent = pl.name || `${pl.lat.toFixed(4)}, ${pl.lon.toFixed(4)}`;
      const pill = document.createElement("span");
      pill.className = "value-pill";
      pill.textContent = t("insights_visits", { n: pl.visits });
      btn.append(strong, pill);
      btn.addEventListener("click", () => onPickPoint?.({
        lat: pl.lat, lon: pl.lon,
        name: pl.name || `${pl.lat.toFixed(4)}, ${pl.lon.toFixed(4)}`,
        kind: "place"
      }));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    container.appendChild(sec);
  }

  // 6. Slowdown Hotspots (tappable -> plot on Mini-Map!)
  if (insights.hazards?.length) {
    const sec = document.createElement("div");
    sec.className = "insight-block";
    const h = document.createElement("h4");
    h.textContent = t("insights_hazards");
    sec.appendChild(h);
    const ul = document.createElement("ul");
    ul.className = "insight-list";
    for (const hz of insights.hazards) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "insight-row-btn hazard";
      const strong = document.createElement("strong");
      strong.textContent = `${hz.lat.toFixed(4)}, ${hz.lon.toFixed(4)}`;
      const pill = document.createElement("span");
      pill.className = "value-pill warn";
      pill.textContent = t("insights_slowdowns", { n: hz.count });
      btn.append(strong, pill);
      btn.addEventListener("click", () => onPickPoint?.({
        lat: hz.lat, lon: hz.lon, name: t("insights_hazard_pin"), kind: "hazard"
      }));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    container.appendChild(sec);
  }

  // 7. Recent Drives
  if (insights.recentDrives?.length) {
    const sec = document.createElement("div");
    sec.className = "insight-block";
    const h = document.createElement("h4");
    h.textContent = t("insights_recent_drives");
    sec.appendChild(h);
    const ul = document.createElement("ul");
    ul.className = "insight-list";
    for (const drv of insights.recentDrives) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "insight-row-btn";
      const left = document.createElement("div");
      left.className = "insight-drive-copy";
      const strong = document.createElement("strong");
      strong.textContent = drv.name || `${drv.lat.toFixed(4)}, ${drv.lon.toFixed(4)}`;
      const sub = document.createElement("small");
      const when = drv.departMs
        ? new Date(drv.departMs).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";
      sub.textContent = [when, formatDistance(drv.distM, imperial), formatDuration(drv.durS)].filter(Boolean).join(" · ");
      left.append(strong, sub);
      btn.appendChild(left);
      btn.addEventListener("click", () => onPickPoint?.({
        lat: drv.lat, lon: drv.lon,
        name: drv.name || `${drv.lat.toFixed(4)}, ${drv.lon.toFixed(4)}`,
        kind: "place"
      }));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    container.appendChild(sec);
  }
}
