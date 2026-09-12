import { __decorate } from "tslib";
import { LitElement, css, html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { ImprovSerial } from "improv-wifi-serial-sdk/dist/serial.js";
import { flash } from "./flash.js";
import { downloadManifest } from "./util/manifest.js";
const MAX_CONTROLLERS = 16;
export class MultiInstall extends LitElement {
    constructor() {
        super(...arguments);
        this.controllers = [];
        this.loading = true;
        this.flashing = false;
        this.provisioning = false;
        this.ssid = "";
        this.wifiPassword = "";
        this.logging = false;
        this.logTitle = "";
        this.logText = "";
        this.manifestPath = "";
        this.landscapeManifestPath = "";
        this.stockWledManifestPath = "";
        this.serialChanged = () => void this.refreshPorts();
    }
    connectedCallback() {
        var _a, _b, _c, _d, _e;
        super.connectedCallback();
        this.manifestPath = (_a = this.getAttribute("manifest")) !== null && _a !== void 0 ? _a : "";
        this.landscapeManifestPath = (_b = this.getAttribute("landscape-manifest")) !== null && _b !== void 0 ? _b : "";
        this.stockWledManifestPath = (_c = this.getAttribute("stock-wled-manifest")) !== null && _c !== void 0 ? _c : "";
        void this.initialize();
        (_d = navigator.serial) === null || _d === void 0 ? void 0 : _d.addEventListener("connect", this.serialChanged);
        (_e = navigator.serial) === null || _e === void 0 ? void 0 : _e.addEventListener("disconnect", this.serialChanged);
    }
    disconnectedCallback() {
        var _a, _b;
        void this.stopLogs();
        (_a = navigator.serial) === null || _a === void 0 ? void 0 : _a.removeEventListener("connect", this.serialChanged);
        (_b = navigator.serial) === null || _b === void 0 ? void 0 : _b.removeEventListener("disconnect", this.serialChanged);
        super.disconnectedCallback();
    }
    async initialize() {
        if (!("serial" in navigator) || !window.isSecureContext) {
            this.pageError = "Use Chrome or Edge from the secure flasher URL.";
            this.loading = false;
            return;
        }
        try {
            this.manifest = await downloadManifest(this.manifestPath);
            await this.refreshPorts();
        }
        catch (err) {
            this.pageError = `Could not load firmware: ${err.message}`;
        }
        finally {
            this.loading = false;
        }
    }
    async refreshPorts() {
        if (!("serial" in navigator) || this.flashing)
            return;
        const ports = (await navigator.serial.getPorts()).slice(0, MAX_CONTROLLERS);
        this.controllers = ports.map((port) => {
            var _a;
            return (_a = this.controllers.find((item) => item.port === port)) !== null && _a !== void 0 ? _a : {
                port,
                status: "ready",
                message: "Ready",
            };
        });
    }
    async authorizeController() {
        if (this.controllers.length >= MAX_CONTROLLERS)
            return;
        try {
            const port = await navigator.serial.requestPort();
            if (!this.controllers.some((item) => item.port === port)) {
                this.controllers = [
                    ...this.controllers,
                    { port, status: "ready", message: "Ready" },
                ];
            }
        }
        catch (err) {
            if (err.name !== "NotFoundError")
                this.pageError = err.message;
        }
    }
    updateController(port, change) {
        this.controllers = this.controllers.map((item) => item.port === port ? { ...item, ...change } : item);
    }
    label(controller, index) {
        var _a;
        const info = controller.port.getInfo();
        const usb = info.usbVendorId === undefined
            ? "USB serial device"
            : `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${((_a = info.usbProductId) !== null && _a !== void 0 ? _a : 0).toString(16).padStart(4, "0")}`;
        return { name: `Controller ${index + 1}`, usb };
    }
    async flashOne({ port }) {
        this.updateController(port, {
            status: "opening",
            message: "Opening port…",
        });
        try {
            await flash((current) => {
                const error = current.state === "error" /* FlashStateType.ERROR */;
                const done = current.state === "finished" /* FlashStateType.FINISHED */;
                this.updateController(port, {
                    status: error ? "error" : done ? "complete" : "flashing",
                    message: current.message,
                    progress: current.state === "writing" /* FlashStateType.WRITING */
                        ? current.details.percentage
                        : done
                            ? 100
                            : undefined,
                });
            }, port, this.manifestPath, this.manifest, true);
        }
        catch (err) {
            this.updateController(port, {
                status: "error",
                message: err.message || "Flash failed",
                progress: undefined,
            });
            try {
                if (port.readable !== null || port.writable !== null)
                    await port.close();
            }
            catch {
                // Already closed or disconnected.
            }
        }
    }
    async flashAll() {
        if (!this.manifest ||
            !this.controllers.length ||
            this.flashing ||
            this.logging)
            return;
        this.flashing = true;
        this.pageError = undefined;
        await Promise.all(this.controllers.map((item) => this.flashOne(item)));
        this.flashing = false;
    }
    async closePort(port) {
        try {
            if (port.readable !== null || port.writable !== null)
                await port.close();
        }
        catch {
            // The device may have disconnected while an operation was ending.
        }
    }
    async provisionOne(controller) {
        const { port } = controller;
        this.updateController(port, {
            networkStatus: "Connecting to firmware…",
            networkUrl: undefined,
        });
        let improv;
        try {
            await port.open({ baudRate: 115200 });
            improv = new ImprovSerial(port, console);
            await improv.initialize(5000);
            this.updateController(port, { networkStatus: "Joining Wi-Fi…" });
            await improv.provision(this.ssid, this.wifiPassword, 45000);
            this.updateController(port, {
                networkStatus: "Online",
                networkUrl: improv.nextUrl,
            });
        }
        catch (err) {
            this.updateController(port, {
                networkStatus: `Wi-Fi failed: ${err.message || err}`,
            });
        }
        finally {
            try {
                await (improv === null || improv === void 0 ? void 0 : improv.close());
            }
            catch {
                // Continue with closing the serial port.
            }
            await this.closePort(port);
        }
    }
    async connectAllWifi() {
        if (!this.ssid.trim() ||
            !this.controllers.length ||
            this.flashing ||
            this.provisioning)
            return;
        await this.stopLogs();
        this.provisioning = true;
        this.pageError = undefined;
        await Promise.all(this.controllers.map((controller) => this.provisionOne(controller)));
        this.provisioning = false;
        this.wifiPassword = "";
    }
    async startLogs(controller, index) {
        var _a;
        if (this.flashing || this.provisioning)
            return;
        await this.stopLogs();
        const { port } = controller;
        this.logPort = port;
        this.logTitle = `Controller ${index + 1}`;
        this.logText = "Opening serial log…\n";
        this.logging = true;
        try {
            await port.open({ baudRate: 115200 });
            const reader = port.readable.getReader();
            this.logReader = reader;
            await port.setSignals({ dataTerminalReady: false, requestToSend: true });
            await new Promise((resolve) => setTimeout(resolve, 250));
            await port.setSignals({ dataTerminalReady: false, requestToSend: false });
            const decoder = new TextDecoder();
            this.logText = "";
            while (this.logReader === reader) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                if (value) {
                    this.logText = (this.logText + decoder.decode(value, { stream: true })).slice(-30000);
                }
            }
        }
        catch (err) {
            if (this.logging)
                this.logText += `\n[Log stopped: ${err.message || err}]\n`;
        }
        finally {
            try {
                (_a = this.logReader) === null || _a === void 0 ? void 0 : _a.releaseLock();
            }
            catch {
                // The reader may have been released while stopping.
            }
            this.logReader = undefined;
            await this.closePort(port);
            if (this.logPort === port)
                this.logging = false;
        }
    }
    async stopLogs() {
        const reader = this.logReader;
        const port = this.logPort;
        this.logReader = undefined;
        this.logPort = undefined;
        this.logging = false;
        this.logTitle = "";
        try {
            await (reader === null || reader === void 0 ? void 0 : reader.cancel());
        }
        catch {
            // The stream may already be closed.
        }
        try {
            reader === null || reader === void 0 ? void 0 : reader.releaseLock();
        }
        catch {
            // The read loop may have already released the lock.
        }
        if (port)
            await this.closePort(port);
    }
    async selectFirmware(event) {
        const nextPath = event.target.value;
        if (nextPath === this.manifestPath || this.flashing)
            return;
        this.loading = true;
        this.pageError = undefined;
        try {
            this.manifest = await downloadManifest(nextPath);
            this.manifestPath = nextPath;
            this.reset();
        }
        catch (err) {
            this.pageError = `Could not load firmware: ${err.message}`;
        }
        finally {
            this.loading = false;
        }
    }
    reset() {
        this.controllers = this.controllers.map((item) => ({
            ...item,
            status: "ready",
            message: "Ready",
            progress: undefined,
        }));
    }
    render() {
        var _a;
        const complete = this.controllers.filter((c) => c.status === "complete").length;
        const failed = this.controllers.filter((c) => c.status === "error").length;
        return html `
      ${this.pageError
            ? html `<div class="alert">${this.pageError}</div>`
            : nothing}
      <div class="firmware-select">
        <label for="firmware">Firmware profile</label>
        <select
          id="firmware"
          .value=${this.manifestPath}
          @change=${this.selectFirmware}
          ?disabled=${this.flashing || this.loading}
        >
          <option value=${(_a = this.getAttribute("manifest")) !== null && _a !== void 0 ? _a : ""}>
            Standard — SHL-2.0.6
          </option>
          ${this.landscapeManifestPath
            ? html `<option value=${this.landscapeManifestPath}>
                Landscape — SHL-2.0.7
              </option>`
            : nothing}
          ${this.stockWledManifestPath
            ? html `<option value=${this.stockWledManifestPath}>
                Stock WLED — 0.14.0 SHL r2 (4×200 SK6812 RGBW)
              </option>`
            : nothing}
        </select>
        <small> Selection applies to every controller in this batch. </small>
      </div>
      <div class="toolbar">
        <span
          ><strong>${this.controllers.length} / 16</strong> controllers
          authorized</span
        >
        <div>
          <button @click=${this.refreshPorts} ?disabled=${this.flashing}>
            Refresh
          </button>
          <button
            @click=${this.authorizeController}
            ?disabled=${this.flashing ||
            this.controllers.length >= MAX_CONTROLLERS}
          >
            Add controller
          </button>
        </div>
      </div>
      ${this.controllers.length
            ? html `<div class="list">
            ${this.controllers.map((controller, index) => {
                const port = this.label(controller, index);
                return html `<div class="row ${controller.status}">
                <span class="dot"></span>
                <div class="identity">
                  <strong>${port.name}</strong><small>${port.usb}</small>
                </div>
                <div class="result">
                  <span>${controller.message}</span>
                  ${controller.progress === undefined
                    ? nothing
                    : html `<progress
                        max="100"
                        .value=${controller.progress}
                      ></progress>`}
                </div>
                <div class="controller-tools">
                  ${controller.networkStatus
                    ? html `<small>${controller.networkStatus}</small>`
                    : nothing}
                  ${controller.networkUrl
                    ? html `<a
                        href=${controller.networkUrl}
                        target="_blank"
                        rel="noopener"
                        >Open controller</a
                      >`
                    : nothing}
                  <button
                    @click=${() => this.startLogs(controller, index)}
                    ?disabled=${this.flashing || this.provisioning}
                  >
                    View logs
                  </button>
                </div>
              </div>`;
            })}
          </div>`
            : html `<div class="empty">
            Connect the powered USB hub, then select
            <strong>Add controller</strong>
            once for each COM port.
          </div>`}
      <section class="wifi-tools" aria-labelledby="wifi-heading">
        <div>
          <strong id="wifi-heading">Post-flash Wi-Fi</strong>
          <small
            >Credentials are sent directly over USB and cleared after this
            batch.</small
          >
        </div>
        <label>
          Network name (SSID)
          <input
            autocomplete="off"
            .value=${this.ssid}
            @input=${(event) => (this.ssid = event.target.value)}
          />
        </label>
        <label>
          Wi-Fi password
          <input
            type="password"
            autocomplete="new-password"
            .value=${this.wifiPassword}
            @input=${(event) => (this.wifiPassword = event.target.value)}
          />
        </label>
        <button
          class="primary"
          @click=${this.connectAllWifi}
          ?disabled=${this.flashing ||
            this.provisioning ||
            !this.controllers.length ||
            !this.ssid.trim()}
        >
          ${this.provisioning
            ? `Connecting ${this.controllers.length}…`
            : `Connect all to Wi-Fi (${this.controllers.length})`}
        </button>
      </section>
      ${this.logTitle
            ? html `<section class="log-viewer">
            <div class="log-header">
              <strong>Serial logs — ${this.logTitle}</strong>
              <div>
                <button
                  @click=${() => navigator.clipboard.writeText(this.logText)}
                >
                  Copy
                </button>
                <button @click=${this.stopLogs}>
                  ${this.logging ? "Stop" : "Close"}
                </button>
              </div>
            </div>
            <pre>${this.logText || "Waiting for controller output…"}</pre>
          </section>`
            : nothing}
      <div class="actions">
        <small>
          ${this.flashing
            ? "Do not disconnect the hub."
            : complete || failed
                ? `${complete} complete${failed ? `, ${failed} failed` : ""}`
                : "All selected controllers will be erased and programmed."}
        </small>
        <div>
          ${!this.flashing && (complete || failed)
            ? html `<button @click=${this.reset}>Reset results</button>`
            : nothing}
          <button
            class="primary"
            @click=${this.flashAll}
            ?disabled=${this.loading ||
            this.flashing ||
            this.provisioning ||
            this.logging ||
            !this.controllers.length ||
            Boolean(this.pageError)}
          >
            ${this.flashing
            ? `Flashing ${this.controllers.length}…`
            : `Flash all (${this.controllers.length})`}
          </button>
        </div>
      </div>
    `;
    }
}
MultiInstall.styles = css `
    :host {
      display: block;
      color: #202124;
      font:
        14px -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }
    button {
      padding: 9px 14px;
      border: 1px solid #c8cdd3;
      border-radius: 5px;
      background: #fff;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .firmware-select {
      display: grid;
      grid-template-columns: 140px minmax(240px, 1fr);
      align-items: center;
      gap: 7px 12px;
      margin-bottom: 18px;
      padding: 14px;
      border: 1px solid #d7dbe0;
      border-radius: 5px;
      background: #f7f8f9;
    }
    .firmware-select label {
      font-weight: 600;
    }
    .firmware-select select {
      width: 100%;
      padding: 9px 10px;
      border: 1px solid #aeb4bb;
      border-radius: 4px;
      color: #202124;
      background: #fff;
      font: inherit;
    }
    .firmware-select small {
      grid-column: 2;
    }
    .primary {
      border-color: #1769e0;
      color: #fff;
      background: #1769e0;
    }
    .toolbar,
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .toolbar {
      padding-bottom: 16px;
    }
    .toolbar > div,
    .actions > div {
      display: flex;
      gap: 8px;
    }
    .list {
      overflow: hidden;
      border: 1px solid #d7dbe0;
      border-radius: 5px;
    }
    .row {
      display: grid;
      grid-template-columns: 12px minmax(135px, 0.8fr) minmax(180px, 1.2fr) minmax(
          125px,
          auto
        );
      align-items: center;
      gap: 12px;
      min-height: 58px;
      padding: 8px 14px;
      border-bottom: 1px solid #e4e7ea;
    }
    .row:last-child {
      border-bottom: 0;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #87909a;
    }
    .flashing .dot,
    .opening .dot {
      background: #1769e0;
    }
    .complete .dot {
      background: #27864b;
    }
    .error .dot {
      background: #c73c35;
    }
    .identity,
    .result,
    .controller-tools {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .controller-tools {
      align-items: flex-end;
    }
    .controller-tools a {
      color: #1769e0;
      font-weight: 600;
    }
    .controller-tools button {
      padding: 6px 10px;
    }
    small,
    .identity small,
    .result span {
      color: #656c75;
      font-size: 12px;
    }
    progress {
      width: 100%;
      height: 6px;
      accent-color: #1769e0;
    }
    .empty {
      padding: 28px 18px;
      border: 1px dashed #c8cdd3;
      border-radius: 5px;
      color: #616871;
      text-align: center;
    }
    .actions {
      padding-top: 18px;
    }
    .wifi-tools {
      display: grid;
      grid-template-columns: 1.2fr 1fr 1fr auto;
      align-items: end;
      gap: 12px;
      margin-top: 18px;
      padding: 14px;
      border: 1px solid #d7dbe0;
      border-radius: 5px;
      background: #f7f8f9;
    }
    .wifi-tools > div,
    .wifi-tools label {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .wifi-tools input {
      min-width: 0;
      padding: 9px 10px;
      border: 1px solid #aeb4bb;
      border-radius: 4px;
      font: inherit;
    }
    .log-viewer {
      margin-top: 18px;
      overflow: hidden;
      border: 1px solid #343a40;
      border-radius: 5px;
      background: #16191d;
    }
    .log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      color: #fff;
      background: #292e34;
    }
    .log-header > div {
      display: flex;
      gap: 8px;
    }
    .log-viewer pre {
      min-height: 180px;
      max-height: 360px;
      margin: 0;
      padding: 12px;
      overflow: auto;
      color: #d8e1ea;
      white-space: pre-wrap;
      word-break: break-word;
      font:
        12px/1.45 Consolas,
        "Courier New",
        monospace;
    }
    .alert {
      margin-bottom: 16px;
      padding: 11px 13px;
      border: 1px solid #e3aa42;
      border-radius: 5px;
      color: #614400;
      background: #fff8e6;
    }
    @media (max-width: 650px) {
      .toolbar,
      .actions {
        align-items: stretch;
        flex-direction: column;
      }
      .row {
        grid-template-columns: 12px 1fr;
      }
      .result {
        grid-column: 2;
      }
      .firmware-select {
        grid-template-columns: 1fr;
      }
      .firmware-select small {
        grid-column: 1;
      }
      .wifi-tools {
        grid-template-columns: 1fr;
      }
      .controller-tools {
        grid-column: 2;
        align-items: flex-start;
      }
    }
  `;
__decorate([
    state()
], MultiInstall.prototype, "controllers", void 0);
__decorate([
    state()
], MultiInstall.prototype, "loading", void 0);
__decorate([
    state()
], MultiInstall.prototype, "flashing", void 0);
__decorate([
    state()
], MultiInstall.prototype, "provisioning", void 0);
__decorate([
    state()
], MultiInstall.prototype, "pageError", void 0);
__decorate([
    state()
], MultiInstall.prototype, "ssid", void 0);
__decorate([
    state()
], MultiInstall.prototype, "wifiPassword", void 0);
__decorate([
    state()
], MultiInstall.prototype, "logging", void 0);
__decorate([
    state()
], MultiInstall.prototype, "logTitle", void 0);
__decorate([
    state()
], MultiInstall.prototype, "logText", void 0);
customElements.define("shl-multi-install", MultiInstall);
