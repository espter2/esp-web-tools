# SHL Controller Firmware Installer

Browser-based production firmware installer for 16 MB SHL ESP32 controllers.
On Windows, technicians only need Microsoft Edge or Google Chrome and a
data-capable USB cable. VS Code, PlatformIO, Python, and esptool are not needed
on the flashing PC.

## Use on Windows

1. Open the deployed HTTPS installer in Microsoft Edge or Google Chrome.
2. Connect a powered USB hub and up to 16 controllers using data-capable cables.
3. Select **Add controller** once for each COM port. Chrome or Edge requires one
   explicit permission approval for every new USB serial device.
4. Confirm that the expected controller count is shown, then select **Flash all**.
5. Keep the hub connected until every row shows **All done!** or an individual
   error. Previously approved ports are detected automatically on future visits.
6. Enter the production Wi-Fi credentials and select **Connect all to Wi-Fi**.
7. Use **Open controller** to inspect a controller's settings, or **View logs**
   to restart that controller and capture its USB serial output.

All selected controllers are erased and flashed concurrently. Use a powered hub
with enough current for all attached controllers; an unpowered hub can cause
random disconnects or failed writes when many controllers operate at once.
Wi-Fi credentials remain in the browser tab, are sent directly to each
controller over USB using Improv Serial, and the password field is cleared when
the batch finishes.

If the controller cannot be initialized, close applications that may have the
COM port open. Hold the controller's BOOT button while starting installation,
then release it when writing begins.

The site must be served through HTTPS (or localhost during development). It
will not flash when `index.html` is opened directly from the Windows filesystem.

## Packaged release

The current package includes three classic ESP32 firmware profiles:

- Standard: `SHL-2.0.6` (`firmware/manifest.json`)
- Landscape: `SHL-2.0.7` (`firmware/manifest-landscape.json`)
- Stock WLED: `0.14.0-SHL-r2` (`firmware/manifest-wled-0.14.0.json`), preset
  with four SK6812 RGBW outputs on GPIO 15, 16, 17, and 18; 200 LEDs per
  output; RGB color order; Accurate automatic white calculation; and the
  automatic brightness limiter disabled

The operator selects one profile before starting a batch. The selection applies
to all controllers in that batch. Stock WLED uses the official WLED 4 MB layout
and is intended for the separate stock-WLED customer controllers.

The Stock WLED application is built from the official WLED 0.14.0 source with
the SHL output defaults listed above. Its boot package comes from the official
WLED release. WLED 0.14.0 source and release details are available at
<https://github.com/wled/WLED/releases/tag/v0.14.0>.

| File                              | Flash offset |
| --------------------------------- | -----------: |
| `firmware/bootloader.bin`         |     `0x1000` |
| `firmware/partitions.bin`         |     `0x8000` |
| `firmware/boot_app0.bin`          |     `0xE000` |
| `firmware/firmware.bin`           |    `0x10000` |
| `firmware/firmware-landscape.bin` |    `0x10000` |

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
