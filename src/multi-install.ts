import { LitElement, css, html, nothing } from "lit";
import { state } from "lit/decorators.js";
import { ImprovSerial } from "improv-wifi-serial-sdk/dist/serial.js";
import { FlashState, FlashStateType, Manifest } from "./const.js";
import { flash } from "./flash.js";
import { downloadManifest } from "./util/manifest.js";

const MAX_CONTROLLERS = 16;
type Status = "ready" | "opening" | "flashing" | "complete" | "error";
interface Controller {
  port: SerialPort;
  status: Status;
  message: string;
  progress?: number;
  networkStatus?: string;
  networkUrl?: string;
}

export class MultiInstall extends LitElement {
  @state() private controllers: Controller[] = [];
  @state() private loading = true;
  @state() private flashing = false;
  @state() private provisioning = false;
  @state() private pageError?: string;
  @state() private ssid = "";
  @state() private wifiPassword = "";
  @state() private logging = false;
  @state() private logTitle = "";
  @state() private logText = "";
  private logPort?: SerialPort;
  private logReader?: ReadableStreamDefaultReader<Uint8Array>;
  private manifest?: Manifest;
  private manifestPath = "";
  private landscapeManifestPath = "";
  private stockWledManifestPath = "";

  connectedCallback() {
    super.connectedCallback();
    this.manifestPath = this.getAttribute("manifest") ?? "";
    this.landscapeManifestPath = this.getAttribute("landscape-manifest") ?? "";
    this.stockWledManifestPath = this.getAttribute("stock-wled-manifest") ?? "";
    void this.initialize();
    navigator.serial?.addEventListener("connect", this.serialChanged);
    navigator.serial?.addEventListener("disconnect", this.serialChanged);
  }

  disconnectedCallback() {
    void this.stopLogs();
    navigator.serial?.removeEventListener("connect", this.serialChanged);
    navigator.serial?.removeEventListener("disconnect", this.serialChanged);
    super.disconnectedCallback();
  }

  private serialChanged = () => void this.refreshPorts();

  private async initialize() {
    if (!("serial" in navigator) || !window.isSecureContext) {
      this.pageError = "Use Chrome or Edge from the secure flasher URL.";
      this.loading = false;
      return;
    }
    try {
      this.manifest = await downloadManifest(this.manifestPath);
      await this.refreshPorts();
    } catch (err: any) {
      this.pageError = `Could not load firmware: ${err.message}`;
    } finally {
      this.loading = false;
    }
  }

  private async refreshPorts() {
    if (!("serial" in navigator) || this.flashing) return;
    const ports = (await navigator.serial.getPorts()).slice(0, MAX_CONTROLLERS);
    this.controllers = ports.map(
      (port) =>
        this.controllers.find((item) => item.port === port) ?? {
          port,
          status: "ready",
          message: "Ready",
        },
    );
  }

  private async authorizeController() {
    if (this.controllers.length >= MAX_CONTROLLERS) return;
    try {
      const port = await navigator.serial.requestPort();
      if (!this.controllers.some((item) => item.port === port)) {
        this.controllers = [
          ...this.controllers,
          { port, status: "ready", message: "Ready" },
        ];
      }
    } catch (err: any) {
      if ((err as DOMException).name !== "NotFoundError")
        this.pageError = err.message;
    }
  }

  private updateController(port: SerialPort, change: Partial<Controller>) {
    this.controllers = this.controllers.map((item) =>
      item.port === port ? { ...item, ...change } : item,
    );
  }

  private label(controller: Controller, index: number) {
    const info = controller.port.getInfo();
    const usb =
      info.usbVendorId === undefined
        ? "USB serial device"
        : `USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")}`;
    return { name: `Controller ${index + 1}`, usb };
  }

  private async flashOne({ port }: Controller) {
    this.updateController(port, {
      status: "opening",
      message: "Opening port…",
    });
    try {
      await flash(
        (current: FlashState) => {
          const error = current.state === FlashStateType.ERROR;
          const done = current.state === FlashStateType.FINISHED;
          this.updateController(port, {
            status: error ? "error" : done ? "complete" : "flashing",
            message: current.message,
            progress:
              current.state === FlashStateType.WRITING
                ? current.details.percentage
                : done
                  ? 100
                  : undefined,
          });
        },
        port,
        this.manifestPath,
        this.manifest!,
        true,
      );
    } catch (err: any) {
      this.updateController(port, {
        status: "error",
        message: err.message || "Flash failed",
        progress: undefined,
      });
      try {
        if (port.readable !== null || port.writable !== null)
          await port.close();
      } catch {
        // Already closed or disconnected.
      }
    }
  }

  private async flashAll() {
    if (
      !this.manifest ||
      !this.controllers.length ||
      this.flashing ||
      this.logging
    )
      return;
    this.flashing = true;
    this.pageError = undefined;
    await Promise.all(this.controllers.map((item) => this.flashOne(item)));
    this.flashing = false;
  }

  private async closePort(port: SerialPort) {
    try {
      if (port.readable !== null || port.writable !== null) await port.close();
    } catch {
      // The device may have disconnected while an operation was ending.
    }
  }

  private async provisionOne(controller: Controller) {
    const { port } = controller;
    this.updateController(port, {
      networkStatus: "Connecting to firmware…",
      networkUrl: undefined,
    });
    let improv: ImprovSerial | undefined;
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
    } catch (err: any) {
      this.updateController(port, {
        networkStatus: `Wi-Fi failed: ${err.message || err}`,
      });
    } finally {
      try {
        await improv?.close();
      } catch {
        // Continue with closing the serial port.
      }
      await this.closePort(port);
    }
  }

  private async connectAllWifi() {
    if (
      !this.ssid.trim() ||
      !this.controllers.length ||
      this.flashing ||
      this.provisioning
    )
      return;
    await this.stopLogs();
    this.provisioning = true;
    this.pageError = undefined;
    await Promise.all(
      this.controllers.map((controller) => this.provisionOne(controller)),
    );
    this.provisioning = false;
    this.wifiPassword = "";
  }

  private async startLogs(controller: Controller, index: number) {
    if (this.flashing || this.provisioning) return;
    await this.stopLogs();
    const { port } = controller;
    this.logPort = port;
    this.logTitle = `Controller ${index + 1}`;
    this.logText = "Opening serial log…\n";
    this.logging = true;
    try {
      await port.open({ baudRate: 115200 });
      const reader = port.readable!.getReader();
      this.logReader = reader;
      await port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
      await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      const decoder = new TextDecoder();
      this.logText = "";
      while (this.logReader === reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          this.logText = (
            this.logText + decoder.decode(value, { stream: true })
          ).slice(-30000);
        }
      }
    } catch (err: any) {
      if (this.logging)
        this.logText += `\n[Log stopped: ${err.message || err}]\n`;
    } finally {
      try {
        this.logReader?.releaseLock();
      } catch {
        // The reader may have been released while stopping.
      }
      this.logReader = undefined;
      await this.closePort(port);
      if (this.logPort === port) this.logging = false;
    }
  }

  private async stopLogs() {
    const reader = this.logReader;
    const port = this.logPort;
    this.logReader = undefined;
    this.logPort = undefined;
    this.logging = false;
    this.logTitle = "";
    try {
      await reader?.cancel();
    } catch {
      // The stream may already be closed.
    }
    try {
      reader?.releaseLock();
    } catch {
      // The read loop may have already released the lock.
    }
    if (port) await this.closePort(port);
  }

  private async selectFirmware(event: Event) {
    const nextPath = (event.target as HTMLSelectElement).value;
    if (nextPath === this.manifestPath || this.flashing) return;

    this.loading = true;
    this.pageError = undefined;
    try {
      this.manifest = await downloadManifest(nextPath);
      this.manifestPath = nextPath;
      this.reset();
    } catch (err: any) {
      this.pageError = `Could not load firmware: ${err.message}`;
    } finally {
      this.loading = false;
    }
  }

  private reset() {
    this.controllers = this.controllers.map((item) => ({
      ...item,
      status: "ready",
      message: "Ready",
      progress: undefined,
    }));
  }

  protected render() {
    const complete = this.controllers.filter(
      (c) => c.status === "complete",
    ).length;
    const failed = this.controllers.filter((c) => c.status === "error").length;
    return html`
      ${this.pageError
        ? html`<div class="alert">${this.pageError}</div>`
        : nothing}
      <div class="firmware-select">
        <label for="firmware">Firmware profile</label>
        <select
          id="firmware"
          .value=${this.manifestPath}
          @change=${this.selectFirmware}
          ?disabled=${this.flashing || this.loading}
        >
          <option value=${this.getAttribute("manifest") ?? ""}>
            Standard — SHL-2.0.6
          </option>
          ${this.landscapeManifestPath
            ? html`<option value=${this.landscapeManifestPath}>
                Landscape — SHL-2.0.7
              </option>`
            : nothing}
          ${this.stockWledManifestPath
            ? html`<option value=${this.stockWledManifestPath}>
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
        ? html`<div class="list">
            ${this.controllers.map((controller, index) => {
              const port = this.label(controller, index);
              return html`<div class="row ${controller.status}">
                <span class="dot"></span>
                <div class="identity">
                  <strong>${port.name}</strong><small>${port.usb}</small>
                </div>
                <div class="result">
                  <span>${controller.message}</span>
                  ${controller.progress === undefined
                    ? nothing
                    : html`<progress
                        max="100"
                        .value=${controller.progress}
                      ></progress>`}
                </div>
                <div class="controller-tools">
                  ${controller.networkStatus
                    ? html`<small>${controller.networkStatus}</small>`
                    : nothing}
                  ${controller.networkUrl
                    ? html`<a
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
        : html`<div class="empty">
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
            @input=${(event: Event) =>
              (this.ssid = (event.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Wi-Fi password
          <input
            type="password"
            autocomplete="new-password"
            .value=${this.wifiPassword}
            @input=${(event: Event) =>
              (this.wifiPassword = (event.target as HTMLInputElement).value)}
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
        ? html`<section class="log-viewer">
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
            ? html`<button @click=${this.reset}>Reset results</button>`
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

  static styles = css`
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
}

customElements.define("shl-multi-install", MultiInstall);

declare global {
  interface HTMLElementTagNameMap {
    "shl-multi-install": MultiInstall;
  }
}
