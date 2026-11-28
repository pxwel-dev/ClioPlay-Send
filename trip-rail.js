import { haversineMeters, formatDistance, formatDuration } from "./protocol.js";

/**
 * Compute live phone GPS progress along an ordered multi-stop itinerary.
 * Returns passed-stop flags, active leg index, fractional progress [0..1] along
 * the active leg, and straight-line distance from live GPS to each remaining stop.
 */
export function computeItineraryProgress(stops, phoneGps, passedSet = new Set()) {
  if (!Array.isArray(stops) || !stops.length) {
    return { activeIndex: 0, legProgress: 0, stopDistances: [], passedIndices: new Set() };
  }
  const passed = new Set(passedSet);
  const stopDistances = stops.map(s =>
    phoneGps ? haversineMeters(phoneGps.lat, phoneGps.lon, s.lat, s.lon) : null
  );

  // Auto-mark a stop as passed if live GPS came within 120 m (except final destination until reached)
  if (phoneGps) {
    for (let i = 0; i < stops.length; i++) {
      if (stopDistances[i] !== null && stopDistances[i] <= 120) {
        passed.add(i);
      }
    }
  }

  let activeIndex = 0;
  while (activeIndex < stops.length - 1 && passed.has(activeIndex)) {
    activeIndex++;
  }

  // Compute fractional progress [0..1] along the active segment (prevStop -> activeStop)
  let legProgress = 0;
  if (phoneGps) {
    const dest = stops[activeIndex];
    const distToDest = stopDistances[activeIndex];
    if (activeIndex > 0) {
      const prev = stops[activeIndex - 1];
      const legLen = Math.max(1, haversineMeters(prev.lat, prev.lon, dest.lat, dest.lon));
      const distFromPrev = haversineMeters(phoneGps.lat, phoneGps.lon, prev.lat, prev.lon);
      legProgress = Math.max(0.08, Math.min(0.95, distFromPrev / Math.max(legLen, distFromPrev + distToDest)));
    } else {
      // Approaching Stop 1 from current phone location
      const refLen = dest.legDistM || Math.max(1000, distToDest * 1.4);
      legProgress = Math.max(0.08, Math.min(0.92, 1 - Math.min(1, distToDest / Math.max(1, refLen))));
    }
  }

  return { activeIndex, legProgress, stopDistances, passedIndices: passed };
}

/**
 * Render the Carminat P_TRIP-style vertical itinerary progress rail.
 * Mirrors ClioPlay's circular completed/future nodes, hollow cyan active node,
 * square destination node, and live orange car-position pill on the rail.
 */
export function renderTripRail(listEl, {
  stops,
  phoneGps,
  passedIndices,
  sending,
  activeSendStopIndex,
  completedSendIndices,
  imperial,
  t,
  icons,
  onSelectStop,
  onMoveStop,
  onRemoveStop
}) {
  const prog = computeItineraryProgress(stops, phoneGps, passedIndices);
  listEl.replaceChildren();

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const isFinal = i === stops.length - 1;
    const isPassed = prog.passedIndices.has(i);
    const isActive = i === prog.activeIndex && !isPassed;
    const isTxDone = completedSendIndices?.has(i);
    const isTxActive = i === activeSendStopIndex;

    const li = document.createElement("li");
    li.className = "rail-row";
    if (isPassed) li.classList.add("is-passed");
    if (isActive) li.classList.add("is-active");
    if (isTxDone) li.classList.add("tx-done");
    if (isTxActive) li.classList.add("tx-active");

    // Left vertical rail track (top stem + Carminat node + bottom stem + live GPS dot!)
    const track = document.createElement("div");
    track.className = "rail-track";
    track.setAttribute("aria-hidden", "true");

    const topStem = document.createElement("span");
    topStem.className = `rail-stem top${i === 0 ? " hidden-stem" : ""}${i <= prog.activeIndex ? " travelled" : ""}`;

    const node = document.createElement("span");
    node.className = `rail-node${isFinal ? " final" : ""}${isActive ? " active" : ""}${isPassed || isTxDone ? " done" : ""}`;
    if (isPassed || isTxDone) node.textContent = "✓";
    else if (!isActive) node.textContent = String(i + 1);

    const botStem = document.createElement("span");
    botStem.className = `rail-stem bottom${isFinal ? " hidden-stem" : ""}${i < prog.activeIndex ? " travelled" : ""}`;

    track.append(topStem, node, botStem);

    // Live phone GPS marker riding along the rail right ahead of the active stop
    if (phoneGps && i === prog.activeIndex) {
      const liveDot = document.createElement("span");
      liveDot.className = "rail-live-car";
      liveDot.title = t("live_gps_position");
      track.appendChild(liveDot);
    }

    // Center stop card copy (tapping focuses the stop on the Mini-Map)
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "rail-copy";
    copyBtn.addEventListener("click", () => onSelectStop?.(i, stop));

    const title = document.createElement("strong");
    title.textContent = stop.name;

    const metaParts = [];
    if (isPassed) metaParts.push(t("trip_passed"));
    else if (isFinal) metaParts.push(t("trip_destination"));
    else metaParts.push(t("trip_stop_n", { n: i + 1 }));

    const liveDist = prog.stopDistances[i];
    if (stop.legDistM && stop.legDurS) {
      metaParts.push(`${formatDistance(stop.legDistM, imperial)} · ~${formatDuration(stop.legDurS)}`);
    } else if (liveDist !== null) {
      metaParts.push(formatDistance(liveDist, imperial));
    } else {
      metaParts.push(`${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}`);
    }

    const sub = document.createElement("small");
    sub.textContent = metaParts.join(" · ");
    copyBtn.append(title, sub);

    // Right reorder / remove controls
    const ctrls = document.createElement("div");
    ctrls.className = "trip-row-controls";

    const mkBtn = (action, icon, disabled, danger, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `trip-ctrl-btn${danger ? " danger" : ""}`;
      b.innerHTML = icon;
      b.disabled = disabled;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", () => {
        if (action === "up") onMoveStop?.(i, -1);
        else if (action === "down") onMoveStop?.(i, 1);
        else onRemoveStop?.(i);
      });
      return b;
    };

    ctrls.append(
      mkBtn("up", icons.up, sending || i === 0, false, t("move_up")),
      mkBtn("down", icons.down, sending || isFinal, false, t("move_down")),
      mkBtn("remove", icons.close, sending, true, t("remove"))
    );

    li.append(track, copyBtn, ctrls);
    listEl.appendChild(li);
  }
  return prog;
}
