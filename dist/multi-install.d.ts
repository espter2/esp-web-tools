import { LitElement } from "lit";
export declare class MultiInstall extends LitElement {
    private controllers;
    private loading;
    private flashing;
    private provisioning;
    private pageError?;
    private ssid;
    private wifiPassword;
    private logging;
    private logTitle;
    private logText;
    private logPort?;
    private logReader?;
    private manifest?;
    private manifestPath;
    private landscapeManifestPath;
    private stockWledManifestPath;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private serialChanged;
    private initialize;
    private refreshPorts;
    private authorizeController;
    private updateController;
    private label;
    private flashOne;
    private flashAll;
    private closePort;
    private provisionOne;
    private connectAllWifi;
    private startLogs;
    private stopLogs;
    private selectFirmware;
    private reset;
    protected render(): import("lit-html").TemplateResult<1>;
    static styles: import("lit").CSSResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "shl-multi-install": MultiInstall;
    }
}
