# FTMS

Fitness Machine Service (FTMS) BLE client for Node.js with a live web dashboard.

This project connects to Bluetooth Low Energy (BLE) fitness machines that expose the
[Fitness Machine Service](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/)
(`0x1826`), decodes the real-time telemetry, and streams it to a browser via WebSocket.

## Features

- Scan for FTMS-enabled devices (treadmill, indoor bike, cross trainer, rower, step/stair climber)
- Spec-compliant decoding of all FTMS data characteristics (`0x2ACD`–`0x2AD2`)
- Control point operations: request control, start/resume, stop/pause, set speed/incline/resistance/power/HR targets
- Hono HTTP server serving a minimal live dashboard and REST endpoints
- WebSocket server pushing real-time decoded data to the browser
- TypeScript throughout, reusable library (`src/index.ts`) plus an app (`src/main.ts`)

## Requirements

- Node.js 20+
- BLE adapter. The BLE layer adapts to the platform:
  - **Windows 10+**: uses the native Windows Bluetooth LE stack via `noble-winrt` (no extra drivers/dongles needed for a GATT client). Requires Windows `>= 10.0.15014`.
  - **Linux/macOS**: falls back to the classic `noble` bindings. On Linux add `cap_net_raw` or run with `sudo`:
    ```bash
    sudo setcap cap_net_raw+eip $(readlink -f $(which node))
    ```

## Getting started

```bash
npm install
npm run dev          # start the server (default http://localhost:3000)
```

Then open http://localhost:3000 in a browser.

The server scans for a compatible FTMS device, connects to the first one found,
and the dashboard updates live as data arrives.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `AUTO_CONNECT` | `true` | Automatically connect to the first FTMS device found; set to `false` to only scan |
| `DEBUG_BLE` | *(off)* | Set to `1` to log every discovered BLE peripheral and its advertised services |

## REST endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Serve the dashboard |
| `GET` | `/api/status` | Connection and equipment status as JSON |
| `GET` | `/api/devices` | Scan (5s) and list FTMS devices |
| `GET` | `/api/connect?id=<deviceId>` | Connect to a device |
| `GET` | `/api/control?op=start` | Control: `start`, `stop`, `pause`, `speed`, `power`, `resistance`, `inclination` (with `value=`) |
| `GET` | `/api/disconnect` | Disconnect the device |
| `WS` | `/ws` | Real-time JSON data stream |

## WebSocket message format

```json
{
  "type": "data",
  "equipment": "indoor_bike",
  "data": {
    "instantaneousSpeed": 25.3,
    "instantaneousCadence": 85,
    "instantaneousPower": 150,
    "totalDistance": 12500,
    "elapsedTime": 1800
  },
  "timestamp": 1725000000000
}
```

State updates use `{ "type": "state", "state": "connected", "deviceName": "..." }`.

## Project structure

```
src/
├── index.ts                 # Public library exports
├── main.ts                  # App entry point (server + BLE)
├── ble/
│   ├── connection.ts        # BLE scan/connect (noble-winrt on Windows, noble elsewhere)
│   └── types.ts
├── ftms/
│   ├── constants.ts         # UUIDs and op codes
│   ├── decoder.ts           # Spec-compliant characteristic decoders
│   ├── encoder.ts           # Control point command builders
│   ├── client.ts            # FTMSClient class
│   └── types.ts
├── equipment/               # Human-readable metric snapshots
└── server/
    ├── http.ts              # Hono routes / REST
    ├── ws.ts                # WebSocket server
    └── public/index.html    # Live dashboard
```

## Use as a library

```ts
import { FTMSClient } from "./src/index.js";

const client = new FTMSClient();
await client.init();

client.on("data", (event) => {
  console.log(event.type, event.data); // decoded metrics
});

const devices = await client.scan(5000);
if (devices.length > 0) {
  await client.connect(devices[0].id);
  await client.startWorkout();
}
```

## Scripts

- `npm run dev` — run via `tsx` (no build step)
- `npm run build` — compile to `dist/`
- `npm start` — run compiled output
