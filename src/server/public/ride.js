(function () {
  // =====================================================================
  // ride.js
  // WebSocket client + controller for the 3D fitness ride view. Connects to
  // the FTMS server, turns live equipment data into visual parameters, and
  // updates the on-screen HUD.
  //   * speed       -> world scroll speed
  //   * power       -> mountain height (the power curve shapes the terrain)
  //   * heart rate  -> sun glow pulsation
  // =====================================================================

  var speed = 12;          // km/h of scroll (default when no device)
  var heartRate = 80;      // bpm
  var value = 0;           // normalized 0..1 plotted as the mountain height (0 = flat)
  var currentEquipment = null;
  var lastData = null;

  // Shared state read by the in-scene VR HUD component (ride-hud.js).
  window.RideState = {
    speed: speed,
    heartRate: heartRate,
    power: 0,
    value: value,
    equipment: null
  };

  // Max power (W) that maps to full mountain height. Typical indoor bike tops
  // out around 300–400W; allow some headroom.
  var POWER_MAX = 400;

  function clamp01(v) {
    if (isNaN(v) || v == null) return null;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  // Normalize instantaneous power into the 0..1 value plotted as mountains.
  function computeValue(data) {
    var p = data.instantaneousPower;
    if (p == null || isNaN(p)) return null;
    return clamp01(p / POWER_MAX);
  }

  function updateHUD() {
    var hud = document.getElementById('hud');
    if (!hud) return;
    hud.classList.add('visible');

    var el = function (id) { return document.getElementById(id); };
    if (el('hud-speed')) el('hud-speed').textContent = (speed || 0).toFixed(1);
    if (el('hud-hr')) el('hud-hr').textContent = heartRate != null ? Math.round(heartRate) : '—';
    if (el('hud-intensity')) el('hud-intensity').textContent = lastData && lastData.instantaneousPower != null ? Math.round(lastData.instantaneousPower) + 'W' : '0W';
    if (el('hud-equipment')) {
      var labels = {
        treadmill: 'Treadmill',
        indoor_bike: 'Indoor Bike',
        cross_trainer: 'Cross Trainer',
        rower: 'Rower',
        step_climber: 'Step Climber',
        stair_climber: 'Stair Climber',
      };
      el('hud-equipment').textContent = labels[currentEquipment] || '—';
    }

    window.RideState.speed = speed;
    window.RideState.heartRate = heartRate;
    window.RideState.power = lastData && lastData.instantaneousPower != null ? lastData.instantaneousPower : 0;
    window.RideState.value = value;
    window.RideState.equipment = currentEquipment;
  }

  function handleData(msg) {
    currentEquipment = msg.equipment;
    lastData = msg.data;
    speed = msg.data.instantaneousSpeed != null ? msg.data.instantaneousSpeed : speed;
    heartRate = msg.data.heartRate != null ? msg.data.heartRate : heartRate;
    var v = computeValue(msg.data);
    if (v != null) value = v;

    var land = document.querySelector('[ride-landscape]');
    if (land && land.components['ride-landscape']) {
      land.components['ride-landscape'].setFitnessData({
        speed: speed,
        heartRate: heartRate,
        value: value,
      });
    }
    updateHUD();
  }

  function handleState(msg) {
    var overlay = document.getElementById('overlay');
    if (!overlay) return;
    if (msg.state === 'connected') {
      overlay.classList.add('hidden');
    } else if (msg.state === 'connecting' || msg.state === 'scanning') {
      overlay.classList.remove('hidden');
      overlay.textContent = 'Connecting to fitness device…';
    } else if (msg.state === 'disconnected' || msg.state === 'idle') {
      overlay.classList.remove('hidden');
      overlay.textContent = 'Waiting for a fitness device…';
    } else if (msg.state === 'error') {
      overlay.classList.remove('hidden');
      overlay.textContent = 'Connection error. Waiting for device…';
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

    ws.onopen = function () {};
    ws.onclose = function () { setTimeout(connect, 3000); };
    ws.onerror = function () {};
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'data') handleData(msg);
      else if (msg.type === 'state') handleState(msg);
    };
  }

  AFRAME.registerComponent('ride-tick', {
    tick: function () {
      updateHUD();
    },
  });

  connect();
})();
