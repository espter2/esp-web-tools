# SHL Controller Firmware Installer

Browser-based production firmware installer for 16 MB SHL ESP32 controllers.
On Windows, technicians only need Microsoft Edge or Google Chrome and a
data-capable USB cable. VS Code, PlatformIO, Python, and esptool are not needed
on the flashing PC.

## Use on Windows

1. Open the deployed HTTPS installer in Microsoft Edge or Google Chrome.
2. Connect one controller using a data-capable USB cable.
3. Select **Install firmware** and choose the controller's COM port.
4. Select **Install** and keep the cable connected until installation finishes.

After writing, select **Start check** and then press the controller's physical
RESET button when prompted. The installer watches for the firmware startup
signature and displays a verified message when the new firmware boots. If the
check is inconclusive, the flash is still reported as complete and the check can
be retried or skipped.

If the controller cannot be initialized, close applications that may have the
COM port open. Hold the controller's BOOT button while starting installation,
then release it when writing begins.

The site must be served through HTTPS (or localhost during development). It
will not flash when `index.html` is opened directly from the Windows filesystem.

## Packaged release

The current package is production firmware `SHL-2.0.6` for classic ESP32:

| File                      | Flash offset |
| ------------------------- | -----------: |
| `firmware/bootloader.bin` |     `0x1000` |
| `firmware/partitions.bin` |     `0x8000` |
| `firmware/boot_app0.bin`  |     `0xE000` |
| `firmware/firmware.bin`   |    `0x10000` |

The manifest is `firmware/manifest.json`. Its files and offsets must be kept in
sync with the `esp32dev` PlatformIO environment in the SHL firmware repository.

## Build and preview

Install dependencies and compile the self-contained web bundle:

```sh
npm ci
script/build
```

Preview from the repository root:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. For production, publish the contents of this
repository to an HTTPS static host. The compiled `dist/web` directory is part of
the deployable site.

## Updating the firmware

1. Build the production `esp32dev` environment in the SHL firmware repository.
2. Copy its matching application and partition binaries into `firmware/`.
3. Package the DOUT/40 MHz bootloader and matching Arduino `boot_app0.bin`.
4. Update the version in `firmware/manifest.json` and `index.html`.
5. Run `script/build`, preview the site, and test-flash a controller before
   publishing.

## Upstream project

Allow flashing ESPHome or other ESP-based firmwares via the browser. Will automatically detect the board type and select a supported firmware. [See website for full documentation.](https://esphome.github.io/esp-web-tools/)

```html
<esp-web-install-button
  manifest="firmware_esphome/manifest.json"
></esp-web-install-button>
```

Example manifest:

```json
{
  "name": "ESPHome",
  "version": "2021.10.3",
  "home_assistant_domain": "esphome",
  "funding_url": "https://esphome.io/guides/supporters.html",
  "builds": [
    {
      "chipFamily": "ESP32",
      "parts": [
        { "path": "bootloader_dout_40m.bin", "offset": 4096 },
        { "path": "partitions.bin", "offset": 32768 },
        { "path": "boot_app0.bin", "offset": 57344 },
        { "path": "esp32.bin", "offset": 65536 }
      ]
    },
    {
      "chipFamily": "ESP32-C3",
      "parts": [
        { "path": "bootloader_dout_40m.bin", "offset": 0 },
        { "path": "partitions.bin", "offset": 32768 },
        { "path": "boot_app0.bin", "offset": 57344 },
        { "path": "esp32-c3.bin", "offset": 65536 }
      ]
    },
    {
      "chipFamily": "ESP32-S2",
      "parts": [
        { "path": "bootloader_dout_40m.bin", "offset": 4096 },
        { "path": "partitions.bin", "offset": 32768 },
        { "path": "boot_app0.bin", "offset": 57344 },
        { "path": "esp32-s2.bin", "offset": 65536 }
      ]
    },
    {
      "chipFamily": "ESP32-S3",
      "parts": [
        { "path": "bootloader_dout_40m.bin", "offset": 4096 },
        { "path": "partitions.bin", "offset": 32768 },
        { "path": "boot_app0.bin", "offset": 57344 },
        { "path": "esp32-s3.bin", "offset": 65536 }
      ]
    },
    {
      "chipFamily": "ESP8266",
      "parts": [{ "path": "esp8266.bin", "offset": 0 }]
    }
  ]
}
```

## Development

Run `script/develop`. This starts a server. Open it on http://localhost:5001.

[![ESPHome - A project from the Open Home Foundation](https://www.openhomefoundation.org/badges/esphome.png)](https://www.openhomefoundation.org/)
