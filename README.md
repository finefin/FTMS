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

### Opening it from another device

The server binds all interfaces by default, so a phone, tablet or headset on the same
network can reach it. On startup it prints the exact URLs to use:

```
[ftms] listening on all interfaces:3000
       local    http://localhost:3000/
       network  http://192.168.1.42:3000/        (ride view: /ride)
```

Use the `network` address — `localhost` on another device means *that* device. The
page and the WebSocket both derive their URL from `location.host`, so nothing needs
configuring.

If it still will not connect, in likely order:

1. **Windows Firewall.** It blocks inbound connections to Node by default, and
   silently so if the first-run prompt was dismissed. Allow the port from an
   administrator terminal:

   ```powershell
   netsh advfirewall firewall add rule name="FTMS 3000" dir=in action=allow protocol=TCP localport=3000
   ```

   Windows also blocks far more aggressively when the network profile is set to
   *Public*; set the network to *Private* if it is not already.
2. **Check the server is actually reachable** from the other device: open
   `http://<ip>:3000/api/status`. It returns JSON with no WebSocket or BLE involved,
   so it isolates networking from everything else.
3. **Client isolation / guest Wi-Fi.** Many routers stop devices on the network from
   talking to each other. A guest SSID almost always does, and the two devices must be
   on the same subnet — 2.4 GHz and 5 GHz bands on the same router are usually fine,
   a mesh guest network usually is not.
4. **`HOST` is set.** If `HOST=127.0.0.1` is in the environment or a `.env`, the server
   is deliberately private. The startup log says so explicitly.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `HOST` | *(all interfaces)* | Bind address. Leave unset to accept connections from the local network; set `127.0.0.1` to keep the server private |
| `AUTO_CONNECT` | `true` | Automatically connect to the first FTMS device found; set to `false` to only scan |
| `DEBUG_BLE` | *(off)* | Set to `1` to log every discovered BLE peripheral and its advertised services |

## REST endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Serve the dashboard |
| `GET` | `/ride` | Serve the 3D / VR ride view (synthwave canyon) |
| `GET` | `/space` | Serve the 3D / VR flight view (Earth → Moon) |
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
- `npm run build` — compile to `dist/` and copy `src/server/public` into it
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

### Front-ends

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

  **Tuning the visuals.** Three knobs, in the order you are most likely to want them:

  | Knob | File | Meaning |
  | --- | --- | --- |
  | `POWER_MAX` | `ride.js` | Watts that read as "full". Scales the terrain height, the radial gauge and the sparkline together, and the demo signal is derived from it so it always spans a comparable range. |
  | `WALL_MAXH` | `ride-landscape.js` | World height of a full-power sample. |
  | `TERRAIN_CONTRAST` | `ride-landscape.js` | Exaggerates the swing between peaks and valleys. |

  `TERRAIN_CONTRAST` pushes the normalized value through a symmetric S-curve, so
  power below mid-range sinks toward the valley floor and power above it climbs
  toward the peak. The curve is monotonic and preserves both endpoints — 0 W is still
  flat ground, `POWER_MAX` still reaches exactly `WALL_MAXH` — it only steepens the
  middle. `1` disables it. Note it deliberately suppresses the bottom of the range: if
  your typical effort sits in the *lower* half of `POWER_MAX` the terrain will read as
  mostly flat, and the fix is to lower `POWER_MAX` rather than to raise the contrast.

  Wall height and canyon width are coupled: raising `WALL_MAXH` without pushing
  `WALL_RIDGE_X`/`WALL_X_HALF` out to match turns the walls into vertical curtains that
  run off the top of the frame, and the power silhouette stops being readable. Keeping
  `WALL_MAXH / WALL_RIDGE_X` near 1.8 keeps it looking like a mountain range.

- `/space` — flight view (`space.html` + three scripts). A transit from Earth to the
  Moon at **true distances**: 1 world unit = 1000 km, and every radius and separation
  is the real figure (Earth 6,371 km, Moon 1,737 km, 384,400 km apart). The Moon
  therefore subtends ~0.55° at departure — its real apparent size from Earth — and
  grows to ~38° on arrival.

  Speed is real km/h × `WARP_FACTOR` (50,000), so 30 km/h at the pedals is 1.5 million
  km/h, about 0.14% of light speed, crossing the 359,400 km leg in roughly 15 minutes.
  Power drives thrust. The ship stays at the origin and the system slides past, which
  keeps float precision sane over 384,400 km.

  **The warp streaks are the one deliberate lie, and they have to be.** At true scale
  even 1.5 million km/h is 0.4 units/s, which reads as completely motionless, so streak
  speed is its own mapping (`STREAK_UNITS_PER_KMH`) tuned purely for legibility.
  Distance travelled, ETA, progress and the Moon's growth all stay honest. On arrival
  the transit velocity eases to zero rather than continuing to report a burn that is no
  longer happening, leaving a slow orbital drift in the starfield.

  The level is a single leg today; body positions are plain kilometre offsets along the
  flight axis, so adding further legs is a matter of adding bodies and an arrival
  point.

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

**Duplicated VR panel mechanics.** `ride-hud.js` and `space-hud.js` each carry their
own copy of the head-anchored curved-panel code — geometry, lazy yaw follow, mode
gating, repaint throttle — differing only in what they draw. It was duplicated rather
than shared to avoid destabilising the working ride view while adding the flight view;
extracting a `vr-panel.js` the two draw into is the obvious follow-up.

**Unwired code.** `setSpinDownControl` and `setLatitudeAndLongitude` are implemented
in `ftms/encoder.ts` but exposed neither on `FTMSClient` nor from `index.ts`; the
`equipment/*` snapshot helpers are exported for library users but unused by the app,
and cover four of the six equipment types. (The dead `ride-tick` and `hud-punch`
components and the duplicate `id="hud"` in the ride view have since been fixed.)

**Static assets were missing from the build** (fixed). `tsc` only emits `.js` for `.ts`
inputs, so `src/server/public` never reached `dist/`. Since `http.ts` resolves the
dashboard and ride view relative to its own directory, `npm run build && npm start`
served 500 for `/` and `/ride` and 404 for every script — only `npm run dev` worked.
`npm run build` now copies the directory, and a missing asset reports the path it
looked for rather than a generic hint.

**Connection state reporting** (fixed). Three defects in the same path: `deviceName`
was consumed by `main.ts`, `ws.ts`, the dashboard and the ride HUD but never produced —
`BleConnection.setState` only ever emitted `deviceId`, so every client showed
"No device" while connected. `FTMSClient._deviceInfo` was declared and exposed but
never assigned, so `/api/status` always returned `device: null`. And `_status` was set
only inside `connect()`/`disconnect()`, so an unsolicited drop left it reading
"connected" forever — which also wedged the reconnect poll in `main.ts`, since that
returns early while connected. The client now mirrors the transport's lifecycle.

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
