import { decodeQrImageData } from "./qr-decode.js";
import { parseConnectQrUrl, parseSyncFrame, QrSyncAssembler } from "./qr-sync.js";

/**
 * Fullscreen in-app optical QR scanner for ClioPlay Link v3.0.
 * - Uses hardware-accelerated BarcodeDetector where available (Android Chrome)
 * - Falls back seamlessly to zero-dependency offline pure-JS qr-decode.js (iOS Safari)
 * - Drives closed-loop BT-ACK stacked sync (`CLP3:Q:S` -> `CLP3:Q:A:<next>` -> `CLP3:Q:D`)
 *   and also accepts static Connect QRs (`#q=C1...`) from P_PAIR / P_PHONE_ACTIONS.
 */
export class QrScannerController {
  constructor({ modalEl, videoEl, canvasEl, statusEl, dotsEl, closeBtn, transport, t, onConnect, onSyncBundle }) {
    this.modalEl = modalEl;
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.statusEl = statusEl;
    this.dotsEl = dotsEl;
    this.closeBtn = closeBtn;
    this.transport = transport;
    this.t = t || (k => k);
    this.onConnect = onConnect || (() => {});
    this.onSyncBundle = onSyncBundle || (() => {});

    this.stream = null;
    this.active = false;
    this.scanTimer = null;
    this.detector = null;
    this.assembler = new QrSyncAssembler();
    this.syncMode = false;
    this.lastAckedIndex = -1;
    this.ctx = null;

    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        this.detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        this.detector = null;
      }
    }
    this.closeBtn?.addEventListener("click", () => this.close(true));
  }

  async open({ triggerCarPill = true } = {}) {
    if (this.active) return;
    this.active = true;
    this.syncMode = triggerCarPill;
    this.assembler.reset();
    this.lastAckedIndex = -1;
    this.modalEl.hidden = false;
    this._renderDots(0, 0);
    this._setStatus(triggerCarPill ? this.t("scanner_starting_car") : this.t("scanner_point_car"));

    // Fire CLP3:Q:S immediately inside the user tap gesture so iOS Safari allows MediaSession!
    let btPillOk = false;
    if (triggerCarPill && this.transport) {
      try {
        const res = await this.transport.startQrSync();
        btPillOk = res.ok;
      } catch {
        btPillOk = false;
      }
    }

    if (!this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this._setStatus(this.t("scanner_no_camera"));
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false
      });
      if (!this.active) {
        this._stopStream();
        return;
      }
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this._setStatus(
        triggerCarPill
          ? (btPillOk ? this.t("scanner_point_pill") : this.t("scanner_point_pill_fallback"))
          : this.t("scanner_point_car")
      );
      this._scheduleScan();
    } catch {
      this._setStatus(this.t("scanner_permission_denied"));
    }
  }

  close(sendCancel = false) {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.scanTimer);
    this.scanTimer = null;
    this._stopStream();
    this.modalEl.hidden = true;
    if (sendCancel && this.transport?.sessionOpen) {
      this.transport.closeSession();
    }
  }

  _stopStream() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.videoEl) {
      try { this.videoEl.pause(); this.videoEl.srcObject = null; } catch { }
    }
  }

  _setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  _renderDots(received, total) {
    if (!this.dotsEl) return;
    if (!total) {
      this.dotsEl.replaceChildren();
      this.dotsEl.hidden = true;
      return;
    }
    this.dotsEl.hidden = false;
    const nodes = [];
    for (let i = 0; i < total; i++) {
      const dot = document.createElement("span");
      dot.className = `scan-dot${this.assembler.frames.has(i) ? " done" : ""}`;
      nodes.push(dot);
    }
    const label = document.createElement("span");
    label.className = "scan-count";
    label.textContent = `${received} / ${total}`;
    nodes.push(label);
    this.dotsEl.replaceChildren(...nodes);
  }

  _scheduleScan() {
    if (!this.active) return;
    this.scanTimer = setTimeout(() => this._tick(), 110);
  }

  async _tick() {
    if (!this.active || !this.videoEl || this.videoEl.readyState < 2) {
      this._scheduleScan();
      return;
    }
    let decoded = null;
    try {
      if (this.detector) {
        const hits = await this.detector.detect(this.videoEl);
        if (hits && hits.length && hits[0].rawValue) decoded = hits[0].rawValue;
      }
      if (!decoded) {
        const vw = this.videoEl.videoWidth || 640;
        const vh = this.videoEl.videoHeight || 480;
        const scale = Math.min(1, 520 / Math.max(vw, vh));
        const cw = Math.max(160, Math.round(vw * scale));
        const ch = Math.max(160, Math.round(vh * scale));
        if (this.canvasEl.width !== cw || this.canvasEl.height !== ch) {
          this.canvasEl.width = cw;
          this.canvasEl.height = ch;
        }
        if (!this.ctx) this.ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
        this.ctx.drawImage(this.videoEl, 0, 0, cw, ch);
        const img = this.ctx.getImageData(0, 0, cw, ch);
        decoded = decodeQrImageData(img);
      }
    } catch { }

    if (decoded && this.active) {
      const handled = await this._handlePayload(decoded);
      if (handled) return;
    }
    this._scheduleScan();
  }

  async _handlePayload(text) {
    // 1. Static Connect QR (#q=C1...)
    const connect = parseConnectQrUrl(text);
    if (connect) {
      try { navigator.vibrate?.([14, 30, 14]); } catch { }
      this.close(true);
      this.onConnect(connect);
      return true;
    }

    // 2. Stacked Sync QR frame (CS1:sid:idx/tot:b64url)
    const frame = parseSyncFrame(text);
    if (!frame) return false;
    const state = this.assembler.addFrame(frame);
    if (!state.accepted) return false;

    this._renderDots(state.received, state.total);
    if (state.isNew) {
      try { navigator.vibrate?.(10); } catch { }
    }

    if (state.complete) {
      const bundle = this.assembler.assemble();
      if (!bundle) {
        this._setStatus(this.t("scanner_checksum_retry"));
        this.assembler.reset();
        this._renderDots(0, 0);
        return false;
      }
      this._setStatus(this.t("scanner_synced"));
      try { navigator.vibrate?.([16, 40, 20]); } catch { }
      if (this.transport?.sessionOpen) {
        await this.transport.finishQrSync().catch(() => {});
      }
      this.close(false);
      this.onSyncBundle(bundle);
      return true;
    }

    this._setStatus(this.t("scanner_progress", { n: state.received, total: state.total }));
    if (state.nextMissing >= 0 && state.nextMissing !== this.lastAckedIndex && this.transport?.sessionOpen) {
      this.lastAckedIndex = state.nextMissing;
      this.transport.ackQrFrame(state.nextMissing).catch(() => {});
    }
    return false;
  }
}
