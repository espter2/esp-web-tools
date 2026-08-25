import type { InstallButton } from "./install-button.js";

export const connect = async (button: InstallButton) => {
  import("./install-dialog.js");
  let port: SerialPort | undefined;
  try {
    port = await navigator.serial.requestPort();
  } catch (err: any) {
    if ((err as DOMException).name === "NotFoundError") {
      import("./no-port-picked/index").then((mod) =>
        mod.openNoPortPickedDialog(() => connect(button)),
      );
      return;
    }
    alert(`Error: ${err.message}`);
    return;
  }

  if (!port) {
    return;
  }

  try {
    await port.open({ baudRate: 115200 });
  } catch (err: any) {
    alert(err.message);
    return;
  }

  const el = document.createElement("ewt-install-dialog");
  el.port = port;
  el.manifestPath = button.manifest || button.getAttribute("manifest")!;
  el.overrides = button.overrides;
  el.addEventListener(
    "closed",
    async () => {
      try {
        if (port!.readable !== null || port!.writable !== null) {
          await port!.close();
        }
      } catch (err) {
        // The controller may already have been unplugged.
        console.debug("Serial port was already closed.", err);
      }
    },
    { once: true },
  );
  document.body.appendChild(el);
};
