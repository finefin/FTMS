(function () {
  // =====================================================================
  // space.js
  // WebSocket client and controller for the Earth-to-Moon flight view.
  //   * speed -> velocity through space (see WARP_FACTOR in space-scene.js)
  //   * power -> engine thrust
  //   * heart rate -> crew vitals
  //
  // The DOM HUD here is the windowed cockpit; the in-scene panel
  // (space-hud.js) takes over inside a headset and the two never overlap.
  // =====================================================================

  var POWER_MAX = 60;      // watts that read as full thrust
  var SPEED_MAX = 60;      // km/h at the pedals for a full velocity bar
  var HR_MAX = 200;

  var state = {
    speed: 0, power: 0, heartRate: null, cadence: null,
    elapsed: null, equipment: null, device: null,
    connection: 'idle', demo: false
  };

  // Shared with the in-scene VR HUD (space-hud.js).
  window.FlightState = {
    speed: 0, power: 0, heartRate: null, cadence: null, elapsed: null,
    device: null, deviceLabel: 'No device', connection: 'idle', demo: false,
    powerMax: POWER_MAX, speedMax: SPEED_MAX, hrMax: HR_MAX,
    nav: null
  };

  var shown = { kms: 0, power: 0, hr: 0, speed: 0 };
  var sawRealData = false, wsEverOpen = false;

  function $(id) { return document.getElementById(id); }
  function clamp01(v) { return v == null || isNaN(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }

  function deviceLabel() {
    if (state.demo) return 'Demo signal';
    if (state.device) return state.device;
    if (state.connection === 'connected') return 'Connected';
    if (state.connection === 'connecting') return 'Connecting';
    if (state.connection === 'scanning') return 'Scanning';
    if (state.connection === 'error') return 'Link error';
    return 'No device';
  }

  function fmtTime(sec) {
    if (sec == null || isNaN(sec) || !isFinite(sec)) return '--:--';
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (m < 10 && h > 0 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function groupKm(km) {
    if (km == null || isNaN(km)) return '—';
    return Math.round(km).toLocaleString('en-US');
  }

  // -------------------------------------------------------------------
  // Scene link
  // -------------------------------------------------------------------
  function sceneComponent() {
    var el = document.querySelector('[space-scene]');
    return el && el.components ? el.components['space-scene'] : null;
  }

  function pushToScene() {
    var c = sceneComponent();
    if (!c) return;
    c.setFlightData({
      speed: state.speed,
      thrust: clamp01((state.power || 0) / POWER_MAX)
    });
  }

  // Project the Moon to screen space and park the target brackets on it.
  function updateTargetLock(nav) {
    var lock = $('lock');
    var c = sceneComponent();
    var scene = document.querySelector('a-scene');
    if (!lock || !c || !scene || !scene.camera || !c.moon) return;

    var cam = scene.camera;
    var v = new THREE.Vector3();
    c.moon.getWorldPosition(v);
    var distance = v.length();
    v.project(cam);

    // project() wraps around for points behind the camera, so reject those.
    var behind = v.z > 1;
    if (behind || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
      lock.style.display = 'none';
      return;
    }

    var w = window.innerWidth, h = window.innerHeight;
    var sx = (v.x * 0.5 + 0.5) * w;
    var sy = (-v.y * 0.5 + 0.5) * h;

    // Size the brackets to the Moon's apparent size, with a floor so a
    // distant target is still a visible pip.
    var fov = cam.fov * Math.PI / 180;
    var px = Math.max(16, (c.moon.userData.radius / Math.max(distance, 0.001)) /
      Math.tan(fov / 2) * (h / 2) * 1.35);

    lock.style.display = 'block';
    lock.style.left = sx + 'px';
    lock.style.top = sy + 'px';
    var half = px;
    var br = lock.getElementsByClassName('br');
    var offs = [[-half, -half], [half - 12, -half], [-half, half - 12], [half - 12, half - 12]];
    for (var i = 0; i < br.length; i++) {
      br[i].style.left = offs[i][0] + 'px';
      br[i].style.top = offs[i][1] + 'px';
    }
    var tag = $('lock-tag');
    if (tag) {
      tag.style.left = (-half) + 'px';
      tag.style.top = (half + 6) + 'px';
      tag.textContent = 'MOON  ' + groupKm(nav.moonDistanceKm) + ' km';
    }
  }

  // -------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------
  function setText(id, v) { var el = $(id); if (el && el.textContent !== v) el.textContent = v; }

  function updateHUD() {
    var hud = $('hud');
    if (hud && !hud.classList.contains('visible')) hud.classList.add('visible');

    var c = sceneComponent();
    var nav = c ? c.nav() : null;

    shown.power += ((state.power || 0) - shown.power) * 0.18;
    shown.speed += ((state.speed || 0) - shown.speed) * 0.18;
    if (state.heartRate != null) shown.hr += (state.heartRate - shown.hr) * 0.12;
    if (nav) shown.kms += (nav.shipKms - shown.kms) * 0.15;

    setText('v-power', String(Math.round(shown.power)));
    setText('v-cadence', state.cadence == null ? '—' : String(Math.round(state.cadence)));
    setText('v-hr', state.heartRate == null ? '—' : String(Math.round(shown.hr)));
    setText('v-legspeed', shown.speed.toFixed(1));
    setText('v-clock', fmtTime(state.elapsed));
    setText('v-device', deviceLabel());

    var sb = $('bar-speed');
    if (sb) sb.style.width = (clamp01(shown.speed / SPEED_MAX) * 100).toFixed(1) + '%';
    var tb = $('bar-thrust');
    if (tb) tb.style.width = (clamp01(shown.power / POWER_MAX) * 100).toFixed(1) + '%';

    if (nav) {
      setText('v-kms', Math.round(shown.kms).toLocaleString('en-US'));
      setText('v-kmh', groupKm(nav.shipKmh));
      setText('v-c', nav.lightPct.toFixed(3));
      setText('v-remaining', groupKm(nav.remainingKm));
      setText('v-eta', nav.arrived ? 'ARRIVED' : fmtTime(nav.etaSeconds));
      setText('v-progress', String(Math.round(nav.progress * 100)));

      var done = $('track-done');
      if (done) done.style.width = (nav.progress * 100).toFixed(2) + '%';
      var ship = $('track-ship');
      if (ship) ship.style.left = (nav.progress * 100).toFixed(2) + '%';

      var banner = $('arrived');
      if (banner) banner.classList.toggle('show', nav.arrived);

      updateTargetLock(nav);
      window.FlightState.nav = nav;
    }

    var heart = $('heart');
    if (heart) {
      var bpm = state.heartRate;
      if (bpm && bpm > 20) {
        heart.style.animationDuration = (60 / bpm).toFixed(3) + 's';
        heart.classList.add('beating');
      } else heart.classList.remove('beating');
    }

    var lamp = $('lamp');
    if (lamp) lamp.className = 'lamp lamp-' + (state.demo ? 'demo' : state.connection);

    var fs = window.FlightState;
    fs.speed = state.speed; fs.power = state.power; fs.heartRate = state.heartRate;
    fs.cadence = state.cadence; fs.elapsed = state.elapsed; fs.device = state.device;
    fs.deviceLabel = deviceLabel(); fs.connection = state.connection; fs.demo = state.demo;
  }

  // -------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------
  function applyData(equipment, data, isDemo) {
    state.equipment = equipment;
    state.demo = !!isDemo;
    if (data.instantaneousSpeed != null) state.speed = data.instantaneousSpeed;
    if (data.instantaneousPower != null) state.power = data.instantaneousPower;
    if (data.heartRate != null) state.heartRate = data.heartRate;
    if (data.instantaneousCadence != null) state.cadence = data.instantaneousCadence;
    if (data.strokeRate != null) state.cadence = data.strokeRate;
    if (data.elapsedTime != null) state.elapsed = data.elapsedTime;
    pushToScene();
  }

  function handleState(msg) {
    state.demo = false;
    state.connection = msg.state;
    if (msg.deviceName) state.device = msg.deviceName;

    var boot = $('boot'), t = $('boot-text');
    if (!boot) return;
    if (msg.state === 'connected') boot.classList.add('hidden');
    else {
      boot.classList.remove('hidden');
      if (t) {
        t.textContent = msg.state === 'error' ? 'Link error — retrying'
          : (msg.state === 'connecting' || msg.state === 'scanning')
            ? 'Linking flight computer' : 'Awaiting fitness machine';
      }
    }
  }

  function connect() {
    var ws;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    } catch (e) { setTimeout(connect, 3000); return; }
    ws.onopen = function () { wsEverOpen = true; };
    ws.onclose = function () { setTimeout(connect, 3000); };
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'data') { sawRealData = true; applyData(msg.equipment, msg.data || {}, false); }
      else if (msg.type === 'state') handleState(msg);
    };
  }

  // Synthetic flight when there is no server at all, so the view is not a
  // dead starfield. Suppressed the moment a real socket opens.
  function startDemo() {
    if (sawRealData || wsEverOpen) return;
    var boot = $('boot');
    if (boot) boot.classList.add('hidden');
    state.connection = 'demo';
    var t0 = performance.now();
    var timer = setInterval(function () {
      if (sawRealData || wsEverOpen) { clearInterval(timer); state.demo = false; return; }
      var t = (performance.now() - t0) / 1000;
      applyData('indoor_bike', {
        instantaneousPower: Math.max(0, POWER_MAX * 0.55 + POWER_MAX * 0.3 * Math.sin(t * 0.16)
          + POWER_MAX * 0.13 * Math.sin(t * 0.5 + 1.1)),
        instantaneousSpeed: 28 + 9 * Math.sin(t * 0.16) + 2 * Math.sin(t * 0.9),
        heartRate: 124 + 22 * Math.sin(t * 0.13 - 0.6),
        instantaneousCadence: 86 + 7 * Math.sin(t * 0.35),
        elapsedTime: t
      }, true);
    }, 250);
  }

  // -------------------------------------------------------------------
  // VR / windowed
  // -------------------------------------------------------------------
  var scene = null;

  function isPresenting() {
    if (!scene) return false;
    if (scene.xrSession) return true;
    if (scene.is && (scene.is('vr-mode') || scene.is('ar-mode'))) return true;
    var r = scene.renderer;
    return !!(r && r.xr && r.xr.isPresenting);
  }

  function syncVrClass() {
    var want = isPresenting();
    if (want !== document.body.classList.contains('in-vr')) {
      document.body.classList.toggle('in-vr', want);
    }
  }

  AFRAME.registerComponent('space-tick', {
    tick: function () {
      syncVrClass();
      updateHUD();
    }
  });

  function boot() {
    scene = document.querySelector('a-scene');
    connect();
    setTimeout(startDemo, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
