import { buildPacket } from "./parser.js";
import {
  buildClp3Dest, buildClp3Prefs, buildClp3Fave, buildClp3Cancel,
  buildClp3SkipStop, buildClp3Clock, buildClp3QrStart, buildClp3QrAck,
  buildClp3QrDone, buildClp3Ping
} from "./protocol.js";
import { buildTripPackets, buildClp3TripPackets } from "./trip-store.js";

/**
 * Make a PCM 16-bit mono 8 kHz silent WAV blob to hold MediaSession / AVRCP
 * open on iOS Safari & Android Chrome across single or multi-packet transfers.
 */
export function makeSilentWav(seconds) {
  const sec = Math.max(2, Math.min(180, Math.ceil(Number(seconds) || 4)));
  const sampleRate = 8000;
  const samples = sampleRate * sec;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Blob([buffer], { type: "audio/wav" });
}

export function mediaSupported() {
  return typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    typeof window !== "undefined" &&
    "MediaMetadata" in window;
}

/**
 * Bidirectional CLP3 AVRCP Transport Engine with automatic v2.2 fallback.
 * - Keeps ONE silent WAV audio element playing across an entire burst so iOS/Android
 *   never drop MediaSession focus between consecutive packets.
 * - Registers MediaSession `nexttrack` (0x4b -> ACK) and `previoustrack` (0x4c -> NACK)
 *   to resolve packets in ~250-350 ms on ClioPlay v3.0.
 * - Automatically degrades cleanly to the timed v2.2 window if no ACK arrives.
 */
export class ClioTransport {
  constructor({ audioEl, nextSeq, getLegacySeconds, getForceLegacy, onStateChange }) {
    this.audioEl = audioEl;
    this.nextSeq = nextSeq;
    this.getLegacySeconds = getLegacySeconds || (() => 4);
    this.getForceLegacy = getForceLegacy || (() => false);
    this.onStateChange = onStateChange || (() => {});

    this.audioUrl = null;
    this.busy = false;
    this.cancelled = false;
    this.sessionOpen = false;
    this.pendingAck = null; // { resolve, timer, sentAt }
    this.lastAckAt = 0;
    this.lastRttMs = 0;
    this.clp3Confirmed = false;
    this.batchSeq = 1;
    this.clockSyncedThisSession = false;
    this.keepAliveTimer = null;
  }

  _bindHandlers() {
    if (!mediaSupported()) return;
    try {
      navigator.mediaSession.setActionHandler("nexttrack", () => this._onAvrcpSignal(true));
      navigator.mediaSession.setActionHandler("previoustrack", () => this._onAvrcpSignal(false));
      // Keep play/pause no-op during active burst so iOS displays transport controls cleanly
      navigator.mediaSession.setActionHandler("play", () => {
        if (this.sessionOpen) this.audioEl?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler("pause", () => {});
    } catch { }
  }

  _unbindHandlers() {
    if (!mediaSupported()) return;
    for (const action of ["nexttrack", "previoustrack", "play", "pause"]) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch { }
    }
  }

  _onAvrcpSignal(ok) {
    if (!this.pendingAck) return;
    const p = this.pendingAck;
    this.pendingAck = null;
    clearTimeout(p.timer);
    const rtt = Math.max(10, Math.round(performance.now() - p.sentAt));
    this.lastAckAt = Date.now();
    this.lastRttMs = rtt;
    this.clp3Confirmed = true;
    p.resolve({ status: ok ? "ack" : "nack", rttMs: rtt });
  }

  _publishMetadata(packet, durationSec = 4) {
    if (!mediaSupported()) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: packet.title,
      artist: packet.artist,
      album: packet.album
    });
    try { navigator.mediaSession.playbackState = "playing"; } catch { }
    try {
      navigator.mediaSession.setPositionState?.({
        duration: Math.max(1, durationSec),
        playbackRate: 1,
        position: 0
      });
    } catch { }
  }

  _clearMediaSession() {
    if (!mediaSupported()) return;
    this._unbindHandlers();
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    } catch { }
  }

  async _openSession(firstPacket, totalSeconds = 12) {
    if (!mediaSupported() || !this.audioEl) {
      throw new Error("Browser does not support Bluetooth MediaSession");
    }
    clearTimeout(this.keepAliveTimer);
    this._bindHandlers();
    if (!this.sessionOpen || this.audioEl.paused || this.audioEl.ended) {
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = URL.createObjectURL(makeSilentWav(Math.max(8, totalSeconds)));
      this.audioEl.src = this.audioUrl;
      this.audioEl.loop = true;
      this.audioEl.volume = 1;
      this._publishMetadata(firstPacket, totalSeconds);
      await this.audioEl.play();
      this._publishMetadata(firstPacket, totalSeconds);
      this.sessionOpen = true;
    } else {
      this._publishMetadata(firstPacket, totalSeconds);
    }
  }

  closeSession() {
    clearTimeout(this.keepAliveTimer);
    if (this.pendingAck) {
      const p = this.pendingAck;
      this.pendingAck = null;
      clearTimeout(p.timer);
      p.resolve({ status: "cancelled", rttMs: 0 });
    }
    this.sessionOpen = false;
    try {
      if (this.audioEl) {
        this.audioEl.loop = false;
        this.audioEl.pause();
        this.audioEl.currentTime = 0;
      }
    } catch { }
    this._clearMediaSession();
  }

  cancel() {
    if (!this.busy) return;
    this.cancelled = true;
    this.closeSession();
  }

  /**
   * Send a single CLP3 packet over an already-open session and wait for AVRCP ACK/NACK
   * (or timeout -> legacy fallback). Retries once on timeout if retryOnce is true.
   */
  async _sendOne(packet, { ackTimeoutMs = 1500, legacyFallbackMs = 0, retryOnce = false } = {}) {
    if (this.cancelled) return { status: "cancelled", rttMs: 0 };
    const waitOnce = timeoutMs => new Promise(resolve => {
      const sentAt = performance.now();
      const timer = setTimeout(() => {
        if (this.pendingAck && this.pendingAck.resolve === resolve) {
          this.pendingAck = null;
          resolve({ status: "timeout", rttMs: Math.round(performance.now() - sentAt) });
        }
      }, timeoutMs);
      this.pendingAck = { resolve, timer, sentAt };
      this._publishMetadata(packet, Math.max(4, Math.ceil(timeoutMs / 1000)));
    });

    let res = await waitOnce(ackTimeoutMs);
    if (res.status === "timeout" && retryOnce && !this.cancelled) {
      // Idempotent retry with same seq; clioa2dp caches last ACK for same seq
      res = await waitOnce(ackTimeoutMs);
    }
    if (res.status === "timeout" && legacyFallbackMs > ackTimeoutMs && !this.cancelled) {
      const extra = legacyFallbackMs - ackTimeoutMs;
      await new Promise(r => setTimeout(r, extra));
      return { status: "legacy", rttMs: legacyFallbackMs };
    }
    return res;
  }

  async _maybeSyncClockInOpenSession() {
    if (this.clockSyncedThisSession || this.cancelled || !this.clp3Confirmed) return;
    const utcSec = Math.floor(Date.now() / 1000);
    const tzMin = -new Date().getTimezoneOffset();
    const pkt = buildClp3Clock(utcSec, tzMin, this.nextSeq());
    const res = await this._sendOne(pkt, { ackTimeoutMs: 900 });
    if (res.status === "ack") this.clockSyncedThisSession = true;
  }

  async _runBurst(fn, { keepSessionOpen = false } = {}) {
    if (this.busy) return { ok: false, status: "busy" };
    this.busy = true;
    this.cancelled = false;
    try {
      return await fn();
    } finally {
      this.busy = false;
      if (!keepSessionOpen || this.cancelled) this.closeSession();
    }
  }

  async ping() {
    return this._runBurst(async () => {
      const pkt = buildClp3Ping(this.nextSeq());
      await this._openSession(pkt, 6);
      const res = await this._sendOne(pkt, { ackTimeoutMs: 1400 });
      if (res.status === "ack") {
        await this._maybeSyncClockInOpenSession();
        return { ok: true, status: "ack", rttMs: res.rttMs };
      }
      return { ok: false, status: res.status, rttMs: res.rttMs };
    });
  }

  async sendDestination(lat, lon, name, action = "N", { onProgress } = {}) {
    const forceLegacy = this.getForceLegacy();
    const legacyMs = this.getLegacySeconds() * 1000;
    return this._runBurst(async () => {
      const pkt = forceLegacy
        ? buildPacket(lat, lon, name, this.nextSeq(), action)
        : buildClp3Dest(lat, lon, name, this.nextSeq(), action);
      await this._openSession(pkt, Math.max(6, this.getLegacySeconds() + 2));

      if (forceLegacy) {
        await this._waitTimed(legacyMs, onProgress);
        return { ok: !this.cancelled, status: this.cancelled ? "cancelled" : "legacy", rttMs: legacyMs };
      }

      // Start progress animation while waiting for instant ACK (~300ms) or fallback window
      const start = performance.now();
      let raf = 0;
      const tick = () => {
        if (!this.busy || this.cancelled) return;
        const pct = Math.min(95, ((performance.now() - start) / legacyMs) * 100);
        onProgress?.(pct, Math.max(1, Math.ceil((legacyMs - (performance.now() - start)) / 1000)));
        raf = requestAnimationFrame(tick);
      };
      if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(tick);
      try {
        const res = await this._sendOne(pkt, { ackTimeoutMs: 1600, legacyFallbackMs: legacyMs });
        if (res.status === "ack") {
          onProgress?.(100, 0);
          await this._maybeSyncClockInOpenSession();
          return { ok: true, status: "ack", rttMs: res.rttMs };
        }
        if (res.status === "nack") {
          return { ok: false, status: "nack", reason: "out_of_map", rttMs: res.rttMs };
        }
        if (res.status === "legacy") {
          // Also publish CLP2 packet briefly for ClioPlay v2.2.x receivers that ignore CLP3!
          const v2 = buildPacket(lat, lon, name, this.nextSeq(), action);
          this._publishMetadata(v2, this.getLegacySeconds());
          await this._waitTimed(legacyMs, onProgress);
          return { ok: !this.cancelled, status: this.cancelled ? "cancelled" : "legacy", rttMs: legacyMs };
        }
        return { ok: false, status: res.status, rttMs: res.rttMs };
      } finally {
        if (raf) cancelAnimationFrame(raf);
      }
    });
  }

  async sendTrip(stops, { onStep } = {}) {
    const forceLegacy = this.getForceLegacy();
    const legacyMs = this.getLegacySeconds() * 1000;
    return this._runBurst(async () => {
      if (!stops.length) return { ok: false, status: "empty" };
      if (forceLegacy) {
        return this._sendLegacyTrip(stops, legacyMs, onStep);
      }
      this.batchSeq = (this.batchSeq % 255) + 1;
      const schedule = buildClp3TripPackets(stops, this.nextSeq, this.batchSeq);
      await this._openSession(schedule[0].packet, Math.max(12, schedule.length * 4));

      for (let i = 0; i < schedule.length; i++) {
        if (this.cancelled) return { ok: false, status: "cancelled" };
        const entry = schedule[i];
        onStep?.(i, schedule.length, entry.stopIndex, "sending");
        const res = await this._sendOne(entry.packet, { ackTimeoutMs: 1600, retryOnce: i > 0 });
        if (res.status === "ack") {
          onStep?.(i, schedule.length, entry.stopIndex, "done");
          continue;
        }
        if (res.status === "nack") {
          return { ok: false, status: "nack", failedIndex: entry.stopIndex, stop: entry.stop };
        }
        if (i === 0 && res.status === "timeout" && !this.clp3Confirmed) {
          // Head unit is likely ClioPlay v2.2.x -> seamlessly fall back to timed CLP2 trip!
          return this._sendLegacyTrip(stops, legacyMs, onStep, true);
        }
        return { ok: false, status: res.status, failedIndex: entry.stopIndex };
      }
      await this._maybeSyncClockInOpenSession();
      return { ok: true, status: "ack", count: schedule.length };
    });
  }

  async _sendLegacyTrip(stops, legacyMs, onStep, sessionAlreadyOpen = false) {
    const schedule = buildTripPackets(stops, this.nextSeq);
    if (!sessionAlreadyOpen) {
      await this._openSession(schedule[0].packet, schedule.length * (legacyMs / 1000) + 2);
    }
    for (let i = 0; i < schedule.length; i++) {
      if (this.cancelled) return { ok: false, status: "cancelled" };
      const entry = schedule[i];
      onStep?.(i, schedule.length, entry.stopIndex, "sending");
      this._publishMetadata(entry.packet, legacyMs / 1000);
      await this._waitTimed(legacyMs);
      if (this.cancelled) return { ok: false, status: "cancelled" };
      onStep?.(i, schedule.length, entry.stopIndex, "done");
    }
    return { ok: true, status: "legacy", count: schedule.length };
  }

  async sendPrefs(prefs) {
    return this._runBurst(async () => {
      const pkt = buildClp3Prefs(prefs, this.nextSeq());
      await this._openSession(pkt, 6);
      const res = await this._sendOne(pkt, { ackTimeoutMs: 1600, retryOnce: true });
      if (res.status === "ack") await this._maybeSyncClockInOpenSession();
      return { ok: res.status === "ack", status: res.status, rttMs: res.rttMs };
    });
  }

  async syncChanges({ faveOps = [], clearAllFaves = false, prefs = null, onProgress } = {}) {
    return this._runBurst(async () => {
      const packets = [];
      if (clearAllFaves) packets.push({ kind: "fave", packet: buildClp3Fave(4, 0, 0, "CLEAR", this.nextSeq()) });
      for (const item of faveOps) {
        packets.push({
          kind: "fave",
          item,
          packet: buildClp3Fave(item.op, item.place.lat, item.place.lon, item.place.name, this.nextSeq())
        });
      }
      if (prefs) packets.push({ kind: "prefs", packet: buildClp3Prefs(prefs, this.nextSeq()) });
      if (!packets.length) return { ok: true, status: "noop", sent: 0 };

      await this._openSession(packets[0].packet, Math.max(10, packets.length * 2));
      let sent = 0;
      for (let i = 0; i < packets.length; i++) {
        if (this.cancelled) return { ok: false, status: "cancelled", sent };
        onProgress?.(i, packets.length);
        const res = await this._sendOne(packets[i].packet, { ackTimeoutMs: 1500, retryOnce: true });
        if (res.status !== "ack") return { ok: false, status: res.status, sent };
        sent++;
      }
      onProgress?.(packets.length, packets.length);
      await this._maybeSyncClockInOpenSession();
      return { ok: true, status: "ack", sent };
    });
  }

  async sendControl(kind) {
    return this._runBurst(async () => {
      let pkt;
      if (kind === "cancel") pkt = buildClp3Cancel(this.nextSeq());
      else if (kind === "skip") pkt = buildClp3SkipStop(this.nextSeq());
      else if (kind === "clock") {
        pkt = buildClp3Clock(Math.floor(Date.now() / 1000), -new Date().getTimezoneOffset(), this.nextSeq());
      } else throw new Error(`Unknown control ${kind}`);
      await this._openSession(pkt, 6);
      const res = await this._sendOne(pkt, { ackTimeoutMs: 1500 });
      if (kind === "clock" && res.status === "ack") this.clockSyncedThisSession = true;
      return { ok: res.status === "ack", status: res.status, rttMs: res.rttMs };
    });
  }

  /* Optical QR Sync closed-loop control commands (keeps session alive across frames!). */
  async startQrSync() {
    if (this.busy) return { ok: false, status: "busy" };
    this.busy = true;
    this.cancelled = false;
    try {
      const pkt = buildClp3QrStart(this.nextSeq());
      await this._openSession(pkt, 30);
      const res = await this._sendOne(pkt, { ackTimeoutMs: 1500 });
      return { ok: res.status === "ack", status: res.status, rttMs: res.rttMs };
    } finally {
      this.busy = false;
      // Leave audio session open so subsequent Q:A:<idx> and Q:D fire in ~200 ms!
    }
  }

  async ackQrFrame(nextIdx) {
    if (!this.sessionOpen || this.busy) return { ok: false, status: "closed" };
    this.busy = true;
    try {
      const pkt = buildClp3QrAck(nextIdx, this.nextSeq());
      const res = await this._sendOne(pkt, { ackTimeoutMs: 900 });
      return { ok: res.status === "ack", status: res.status, rttMs: res.rttMs };
    } finally {
      this.busy = false;
    }
  }

  async finishQrSync() {
    if (!this.sessionOpen) return { ok: false, status: "closed" };
    this.busy = true;
    try {
      const pkt = buildClp3QrDone(this.nextSeq());
      const res = await this._sendOne(pkt, { ackTimeoutMs: 1200 });
      return { ok: res.status === "ack", status: res.status, rttMs: res.rttMs };
    } finally {
      this.busy = false;
      this.closeSession();
    }
  }

  async _waitTimed(ms, onProgress) {
    const start = performance.now();
    return new Promise(resolve => {
      const tick = () => {
        if (this.cancelled) { resolve(); return; }
        const elapsed = performance.now() - start;
        const pct = Math.min(100, (elapsed / ms) * 100);
        onProgress?.(pct, Math.max(1, Math.ceil((ms - elapsed) / 1000)));
        if (elapsed >= ms) { resolve(); return; }
        setTimeout(tick, 60);
      };
      tick();
    });
  }
}
