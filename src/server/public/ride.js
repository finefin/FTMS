(function () {
  // =====================================================================
  // ride.js
  // WebSocket client + controller for the 3D ride view. Turns live FTMS
  // telemetry into visual parameters and drives the 2D HUD.
  //   * power       -> mountain height (the canyon is the power curve)
  //   * speed       -> world scroll speed
  //   * heart rate  -> sun glow pulsation
  //
  // The 2D HUD here is the windowed interface; the in-scene VR HUD
  // (ride-hud.js) takes over inside a headset and the two never overlap.
  // =====================================================================

  // Power (W) mapped to full mountain height. Indoor bikes typically top out
  // around 300-400 W, so this leaves a little headroom above threshold work.
  var POWER_MAX = 400;
  var SPEED_MAX = 60;   // km/h at a full speed bar
  var HR_MAX = 200;

  // Seconds of power history kept for the HUD sparkline.
  var SPARK_WINDOW = 120;
  var SPARK_HZ = 4;
  var SPARK_LEN = SPARK_WINDOW * SPARK_HZ;

  // Exported on RideState so the VR HUD can draw the same trace.

  var state = {
    speed: 0,
    heartRate: null,
    power: 0,
    cadence: null,
    distance: null,
    elapsed: null,
    energy: null,
    value: 0,
    equipment: null,
    device: null,
    connection: 'idle',
    demo: false
  };

  // Shared state read by the in-scene VR HUD component (ride-hud.js). The VR
  // HUD draws the same design as the DOM HUD, so it needs the same inputs —
  // including the raw power history behind the sparkline.
  window.RideState = {
    speed: 0, heartRate: null, power: 0, value: 0, equipment: null,
    cadence: null, distance: null, elapsed: null, energy: null,
    device: null, equipmentLabel: null, connection: 'idle', demo: false,
    powerMax: 400, speedMax: 60, hrMax: 200,
    spark: null, sparkFilled: 0, sparkLen: 0
  };

  // Displayed values, eased toward the real ones so the readouts glide.
  var shown = { speed: 0, power: 0, hr: 0, gauge: 0 };

  var spark = new Float32Array(SPARK_LEN);
  var sparkFilled = 0;

  var sawPower = false;
  var sawRealData = false;
  var wsEverOpen = false;

  var EQUIPMENT_LABELS = {
    treadmill: 'Treadmill',
    indoor_bike: 'Indoor Bike',
    cross_trainer: 'Cross Trainer',
    rower: 'Rower',
    step_climber: 'Step Climber',
    stair_climber: 'Stair Climber',
    unknown: 'Fitness Machine'
  };

  function $(id) { return document.getElementById(id); }

  function clamp01(v) {
    if (v == null || isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // -------------------------------------------------------------------
  // Terrain value
  // -------------------------------------------------------------------
  // Power is the source of the mountain profile, as intended. Some machines
  // (most treadmills, plenty of rowers) never report power at all; rather
  // than leave the world permanently flat for those, fall back to a
  // speed-derived proxy — but only once we are sure no power has ever
  // arrived, so a bike with a momentary 0 W still reads as a real valley.
  function computeValue(data) {
    if (data.instantaneousPower != null && !isNaN(data.instantaneousPower)) {
      sawPower = true;
      return clamp01(data.instantaneousPower / POWER_MAX);
    }
    if (sawPower) return null;
    if (data.instantaneousSpeed != null && !isNaN(data.instantaneousSpeed)) {
      return clamp01(data.instantaneousSpeed / 35);
    }
    return null;
  }

  function pushSpark(power) {
    if (sparkFilled < SPARK_LEN) {
      spark[sparkFilled++] = power;
    } else {
      spark.copyWithin(0, 1);
      spark[SPARK_LEN - 1] = power;
    }
  }

  // -------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------
  function fmtTime(sec) {
    if (sec == null || isNaN(sec)) return '--:--';
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mm = (m < 10 && h > 0 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function fmtDistance(m) {
    if (m == null || isNaN(m)) return '--';
    return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  }

  // -------------------------------------------------------------------
  // Sparkline: the same power history the canyon is built from
  // -------------------------------------------------------------------
  function drawSpark() {
    var cv = $('spark');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (sparkFilled < 2) return;

    var pad = 2;
    var usable = h - pad * 2;

    function px(i) { return (i / (SPARK_LEN - 1)) * w; }
    function py(v) { return pad + usable - clamp01(v / POWER_MAX) * usable; }

    // Start the line at the left edge even before the buffer is full.
    var start = SPARK_LEN - sparkFilled;

    ctx.beginPath();
    ctx.moveTo(px(start), py(spark[0]));
    for (var i = 1; i < sparkFilled; i++) ctx.lineTo(px(start + i), py(spark[i]));

    var stroke = ctx.createLinearGradient(0, 0, w, 0);
    stroke.addColorStop(0, 'rgba(0,246,255,0.35)');
    stroke.addColorStop(0.7, 'rgba(255,43,214,0.95)');
    stroke.addColorStop(1, 'rgba(255,240,255,1)');

    // Fill under the curve, mirroring the canyon silhouette.
    ctx.save();
    ctx.lineTo(px(start + sparkFilled - 1), h);
    ctx.lineTo(px(start), h);
    ctx.closePath();
    var fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(255,43,214,0.30)');
    fill.addColorStop(1, 'rgba(255,43,214,0)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(px(start), py(spark[0]));
    for (i = 1; i < sparkFilled; i++) ctx.lineTo(px(start + i), py(spark[i]));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,43,214,0.8)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Leading dot at the live end of the trace.
    var lx = px(start + sparkFilled - 1);
    var ly = py(spark[sparkFilled - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff0ff';
    ctx.shadowColor = 'rgba(255,240,255,0.9)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // -------------------------------------------------------------------
  // 2D HUD
  // -------------------------------------------------------------------
  var GAUGE_LEN = 405.3;   // arc length of the power gauge path in ride.html

  function setText(id, val) {
    var el = $(id);
    if (el && el.textContent !== val) el.textContent = val;
  }

  function updateHUD() {
    var hud = $('hud');
    if (hud && !hud.classList.contains('visible')) hud.classList.add('visible');

    // Ease the displayed numbers toward the live ones.
    shown.power += ((state.power || 0) - shown.power) * 0.18;
    shown.speed += ((state.speed || 0) - shown.speed) * 0.18;
    shown.gauge += (clamp01((state.power || 0) / POWER_MAX) - shown.gauge) * 0.14;
    if (state.heartRate != null) shown.hr += (state.heartRate - shown.hr) * 0.12;

    setText('v-power', String(Math.round(shown.power)));
    setText('v-speed', shown.speed.toFixed(1));
    setText('v-hr', state.heartRate == null ? '--' : String(Math.round(shown.hr)));
    setText('v-cadence', state.cadence == null ? '--' : String(Math.round(state.cadence)));
    setText('v-distance', fmtDistance(state.distance));
    setText('v-time', fmtTime(state.elapsed));
    setText('v-energy', state.energy == null ? '--' : String(Math.round(state.energy)));

    var arc = $('gauge-arc');
    if (arc) arc.style.strokeDashoffset = String(GAUGE_LEN * (1 - shown.gauge));

    var sbar = $('bar-speed');
    if (sbar) sbar.style.width = (clamp01(shown.speed / SPEED_MAX) * 100).toFixed(1) + '%';

    var hbar = $('bar-hr');
    if (hbar) hbar.style.width = (clamp01((state.heartRate || 0) / HR_MAX) * 100).toFixed(1) + '%';

    // Beat the heart glyph at the real rate.
    var heart = $('heart');
    if (heart) {
      var bpm = state.heartRate;
      if (bpm && bpm > 20) {
        heart.style.animationDuration = (60 / bpm).toFixed(3) + 's';
        heart.classList.add('beating');
      } else {
        heart.classList.remove('beating');
      }
    }

    // Redline the power pod when the terrain is near maximum height.
    var pod = $('pod-power');
    if (pod) pod.classList.toggle('hot', shown.gauge > 0.8);

    setText('v-equipment', EQUIPMENT_LABELS[state.equipment] || '--');
    setText('v-device', state.device || (state.demo ? 'Demo signal' : 'No device'));

    var lamp = $('lamp');
    if (lamp) lamp.className = 'lamp lamp-' + state.connection + (state.demo ? ' lamp-demo' : '');

    drawSpark();

    publishState();
  }

  // Mirror everything the VR HUD renders from.
  function publishState() {
    var rs = window.RideState;
    rs.speed = state.speed;
    rs.heartRate = state.heartRate;
    rs.power = state.power;
    rs.value = state.value;
    rs.equipment = state.equipment;
    rs.equipmentLabel = EQUIPMENT_LABELS[state.equipment] || null;
    rs.cadence = state.cadence;
    rs.distance = state.distance;
    rs.elapsed = state.elapsed;
    rs.energy = state.energy;
    rs.device = state.device;
    rs.connection = state.connection;
    rs.demo = state.demo;
    rs.spark = spark;
    rs.sparkFilled = sparkFilled;
    rs.sparkLen = SPARK_LEN;
  }

  function pushToScene() {
    var land = document.querySelector('[ride-landscape]');
    if (land && land.components && land.components['ride-landscape']) {
      land.components['ride-landscape'].setFitnessData({
        speed: state.speed,
        heartRate: state.heartRate,
        value: state.value
      });
    }
  }

  // -------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------
  function applyData(equipment, data, isDemo) {
    state.equipment = equipment;
    state.demo = !!isDemo;

    if (data.instantaneousSpeed != null) state.speed = data.instantaneousSpeed;
    if (data.heartRate != null) state.heartRate = data.heartRate;
    if (data.instantaneousPower != null) state.power = data.instantaneousPower;
    if (data.instantaneousCadence != null) state.cadence = data.instantaneousCadence;
    if (data.strokeRate != null) state.cadence = data.strokeRate;
    if (data.totalDistance != null) state.distance = data.totalDistance;
    if (data.elapsedTime != null) state.elapsed = data.elapsedTime;
    if (data.totalEnergy != null) state.energy = data.totalEnergy;

    var v = computeValue(data);
    if (v != null) state.value = v;

    pushSpark(state.power || 0);
    publishState();
    pushToScene();
  }

  function handleData(msg) {
    sawRealData = true;
    state.demo = false;
    applyData(msg.equipment, msg.data || {}, false);
  }

  function handleState(msg) {
    state.demo = false;
    state.connection = msg.state;
    if (msg.deviceName) state.device = msg.deviceName;

    var overlay = $('overlay');
    if (!overlay) return;
    var text = $('overlay-text');

    if (msg.state === 'connected') {
      overlay.classList.add('hidden');
    } else if (msg.state === 'connecting' || msg.state === 'scanning') {
      overlay.classList.remove('hidden');
      if (text) text.textContent = 'Connecting to fitness device';
    } else if (msg.state === 'error') {
      overlay.classList.remove('hidden');
      if (text) text.textContent = 'Connection error — retrying';
    } else {
      overlay.classList.remove('hidden');
      if (text) text.textContent = 'Waiting for a fitness device';
    }
  }

  function connect() {
    var ws;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    } catch (e) {
      setTimeout(connect, 3000);
      return;
    }

    ws.onopen = function () { wsEverOpen = true; };
    ws.onclose = function () { setTimeout(connect, 3000); };
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'data') handleData(msg);
      else if (msg.type === 'state') handleState(msg);
    };
  }

  // -------------------------------------------------------------------
  // Demo signal
  // -------------------------------------------------------------------
  // Without a server at all (or on a platform where the BLE layer cannot
  // run) the scene would sit permanently flat, which makes it impossible to
  // tell a working build from a broken one. If the WebSocket has never even
  // opened a few seconds after load, synthesise a plausible interval workout.
  //
  // Deliberately *not* started when the server is up but simply has no device
  // yet: there, "waiting for a fitness device" is the honest thing to show,
  // and inventing numbers would look like a successful connection.
  function startDemo() {
    if (sawRealData || wsEverOpen) return;

    // No device is coming, so drop the connection overlay and label the
    // status strip honestly rather than leaving "connecting" up forever.
    var overlay = $('overlay');
    if (overlay) overlay.classList.add('hidden');
    state.connection = 'demo';
    state.device = null;

    var t0 = performance.now();
    var timer = setInterval(function () {
      if (sawRealData || wsEverOpen) {
        clearInterval(timer);
        state.demo = false;
        return;
      }
      var t = (performance.now() - t0) / 1000;
      var power = 165
        + 95 * Math.sin(t * 0.16)
        + 50 * Math.sin(t * 0.47 + 1.1)
        + 22 * Math.sin(t * 1.6 + 0.4);
      power = Math.max(0, power);
      applyData('indoor_bike', {
        instantaneousPower: power,
        instantaneousSpeed: 24 + 9 * Math.sin(t * 0.16) + 2 * Math.sin(t * 0.9),
        heartRate: 118 + 26 * Math.sin(t * 0.13 - 0.6) + 3 * Math.sin(t * 1.2),
        instantaneousCadence: 84 + 8 * Math.sin(t * 0.35),
        totalDistance: (24 / 3.6) * t,
        elapsedTime: t,
        totalEnergy: t * 0.16
      }, true);
    }, 250);
  }

  // -------------------------------------------------------------------
  // VR / windowed mode
  // -------------------------------------------------------------------
  // The DOM HUD is the windowed interface. Inside a headset it is replaced
  // by the in-scene HUD, so hide it there rather than showing both.
  var vrScene = null;

  function isImmersive() {
    if (!vrScene) return false;
    if (vrScene.xrSession) return true;
    var r = vrScene.renderer;
    return !!(r && r.xr && r.xr.isPresenting);
  }

  // Called from the render loop as well as from the events, so a mode change
  // that the events miss still resolves on the next frame.
  function syncVrClass() {
    var want = isImmersive();
    if (want !== document.body.classList.contains('in-vr')) {
      document.body.classList.toggle('in-vr', want);
    }
  }

  function wireVrToggle(scene) {
    vrScene = scene;
    scene.addEventListener('enter-vr', syncVrClass);
    scene.addEventListener('exit-vr', syncVrClass);
    scene.addEventListener('enter-ar', syncVrClass);
    scene.addEventListener('exit-ar', syncVrClass);
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------
  // Driven from the scene's render loop rather than a second rAF loop.
  AFRAME.registerComponent('ride-tick', {
    tick: function () {
      syncVrClass();
      updateHUD();
    }
  });

  function boot() {
    var scene = document.querySelector('a-scene');
    if (scene) wireVrToggle(scene);
    connect();
    setTimeout(startDemo, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
