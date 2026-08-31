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
| `GET` | `/ride` | Serve the 3D / VR ride view |
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

## Project analysis

A short review of the codebase as it stands (~3.2k lines: ~1.7k TypeScript, ~1.5k browser JS/HTML).

### Architecture

Cleanly layered, one direction of dependency:

```
ble/connection.ts   raw GATT: scan, connect, subscribe, read, write
      ↓
ftms/               protocol: constants → decoder/encoder → FTMSClient (EventEmitter)
      ↓
server/             http.ts (Hono REST + static) and ws.ts (broadcast) — both take a client
      ↓
public/             two independent front-ends over the same /ws stream
```

`main.ts` is the only place that wires the pieces together; `index.ts` re-exports the
same modules as a library, so the protocol layer is usable without the server. The
decoders are straightforward flag-walk parsers over the FTMS bit fields, and the
encoders return plain `Buffer`s — both are pure functions with no BLE dependency,
which is the main reason the layering holds.

`WsServer` caches the last `data` and `state` message and replays them to each new
client, so a browser that connects mid-workout renders immediately instead of waiting
for the next notification.

### Two front-ends

- `/` — dashboard (`index.html`, single file): status bar, scan/connect, metric grid,
  Chart.js live plot. Equipment-aware: metric labels and chart series are chosen from
  the `equipment` field in the WS message.
- `/ride` — VR/3D ride view (`ride.html` + three scripts). An A-Frame synthwave world
  where live telemetry drives the scene: power → mountain height (the canyon *is* a
  scrolling graph of your power curve, one row per sample), speed → world scroll rate,
  heart rate → sun-glow pulse. `ride.js` owns the WebSocket and publishes to a global
  `window.RideState`; `ride-landscape.js` and `ride-hud.js` are A-Frame components that
  read it in `tick()`. Values are smoothed (`VALUE_SMOOTH`, `SPEED_SMOOTH`) so the world
  glides between the ~1 Hz BLE samples rather than stepping.

  The canyon scrolls with the classic treadmill trick: rows are fixed in the group's
  local space and read the sample ring at *integer* offsets, while the group slides
  forward by the fractional part of a sample. When the fraction wraps, the group snaps
  back one row-spacing at the same moment every row inherits its far neighbour's
  height, so motion is seamless and the vertex buffers are only rewritten when the
  profile actually changes (or when the sample index advances).

  Two details exist specifically to make the motion *visible*, and both matter:

  - The walls are built as two separate sides starting at the corridor edge, with no
    geometry across the corridor. Lines lying flat on the ground and running along the
    travel axis cannot show motion — a line parallel to `z`, translated along `z`,
    projects to the same screen line at any speed — so they read as a permanently
    static grid. The ground grid is the only floor; its rungs cross the travel axis
    and therefore do scroll visibly.
  - Every 6th sample row is drawn as a brightened marker rung, keyed to the *absolute*
    sample index so it travels one row toward the player per sample. Without it, a
    constant power output produces a uniform canyon, and rigidly translating a uniform
    canyon looks completely still.

  Two HUDs, never both at once, sharing one design — radial power gauge, speed and
  heart pods, corner brackets, and a sparkline of the same power history the terrain
  is built from. The windowed one is DOM/CSS; the VR one draws that design to a 2D
  canvas mapped onto a panel curved around the viewer (~40° of wrap at 2.2 m), which
  reproduces the arcs, gradients and glow exactly in a single draw call. Both read
  from `window.RideState`, which `ride.js` publishes on every update.

  The VR panel repaints at ~15 Hz rather than headset framerate — the readouts and
  heartbeat do not need more, and each repaint re-uploads a ~2.7 MB texture. A repaint
  costs ~0.54 ms of canvas work; ticks in between are effectively free. `REPAINT_MS`
  in `ride-hud.js` is the knob if a standalone headset needs the texture bandwidth
  back.

  The in-scene HUD takes over for **both** immersive VR and A-Frame's desktop
  fullscreen — anything that puts the scene into `vr-mode`. Fullscreen is not a
  cosmetic case: with no headset connected A-Frame calls `requestFullscreen()` on the
  *canvas element itself*, and a fullscreen element renders only its own descendants.
  The DOM HUD is a sibling of `<a-scene>`, so the browser stops drawing it entirely.
  The in-scene panel lives inside the canvas and is the only HUD that can survive
  there. Gating it on `sceneEl.xrSession` — as an earlier version did, to keep
  fullscreen on the DOM HUD — meant no HUD at all on a desktop without a headset.

  The check is re-run every tick rather than only on the enter/exit events, so a mode
  change the events miss still resolves on the next frame instead of leaving the HUD
  hidden for the whole session.

  The panel's wrap angle depends on which mode it is in: ~40° in a headset, where that
  sits comfortably inside the field of view, and ~60° on a flat fullscreen monitor,
  where the headset-sized panel reads as a small floating card. Height is derived from
  the arc length in both cases so the curve always matches the canvas aspect rather
  than stretching it.

  The panel is anchored to the **head**, not to the rig. A-Frame requires the
  `local-floor` reference space, which puts the origin on the floor at the centre of
  the play space — so the viewer starts wherever they happen to be standing, facing
  wherever they happen to be facing. A panel at a fixed rig position is only in front
  of you if you are stood on the origin looking down `-Z`; measured from realistic
  standing poses it landed 45°, 79° and 152° off centre (behind the viewer in the last
  case). Anchoring to the head puts it within ~1° of centre from any pose.

  Head tracking is yaw-only and lazy: the panel holds still for glances under ~17° and
  eases into place past that, so it is always findable without being welded to your
  face. `PANEL_RADIUS`, `PANEL_DROP`, `PANEL_ARC` and `FOLLOW_DEADZONE` in
  `ride-hud.js` tune the ergonomics; `ride-hud="forceVisible: true"` shows the panel
  without a headset for layout work.

### Findings

**Platform.** The BLE layer is Windows-only in practice. `src/ble/connection.ts`
imports `noble-winrt` unconditionally — there is no runtime branch to classic `noble`,
contrary to the Requirements section above. On macOS/Linux the import itself is the
failure point, so `npm run dev` cannot connect there. Either add the fallback or
narrow the documented support.

**Unwired code.** `setSpinDownControl` and `setLatitudeAndLongitude` are implemented
in `ftms/encoder.ts` but exposed neither on `FTMSClient` nor from `index.ts`; the
`equipment/*` snapshot helpers are exported for library users but unused by the app,
and cover four of the six equipment types. (The dead `ride-tick` and `hud-punch`
components and the duplicate `id="hud"` in the ride view have since been fixed.)

**API shape.** Every REST route is a `GET`, including the state-changing
`/api/connect`, `/api/control`, and `/api/disconnect`, and there is no auth. Fine for
a localhost tool; not safe to expose on a LAN as-is. `createApp` also takes a `ws`
parameter it never uses.

**Types.** `DiscoveredDevice.serviceData` is declared `Buffer` but is assigned
`advertisement.serviceUuids` (a string array). The BLE layer's `any` aliases for the
noble types keep the compiler quiet about it.

**Tooling.** No tests, linter, or CI. The decoders are pure functions over `Buffer`s —
the easiest thing in the project to test, and the place where a spec misreading would
be silent.
