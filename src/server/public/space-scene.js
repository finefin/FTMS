(function () {
  // =====================================================================
  // space-scene.js
  // A flight from an Earth-orbiting space station to a Moon-orbiting one,
  // at true distances, driven by live FTMS telemetry:
  //   * speed  -> velocity through space (real km/h x WARP_FACTOR)
  //   * power  -> engine thrust: exhaust glow and streak intensity
  //
  // The camera starts inside the hub of Space Station V (the double-wheel
  // rotating station from 2001). When the rider starts pedalling, the ship
  // undocks and accelerates out of the station, ramps up gradually, and
  // crosses to the Moon.
  //
  // Scale is 1 world unit = 1000 km. The station geometry is intentionally
  // oversized relative to reality so it is visible at this cosmic scale.
  // =====================================================================

  // --- The solar system, in kilometres ---
  var KM_PER_UNIT = 1000;
  var EARTH_RADIUS_KM = 6371;
  var MOON_RADIUS_KM = 1737;
  var EARTH_MOON_KM = 384400;   // mean centre-to-centre distance

  var EARTH_ORBIT_KM = 400;
  var MOON_ORBIT_KM = 100;
  var DEPART_KM = EARTH_RADIUS_KM + EARTH_ORBIT_KM;
  var ARRIVE_KM = MOON_RADIUS_KM + MOON_ORBIT_KM;

  var WARP_FACTOR = 50000;

  // --- Acceleration model ---
  // When the rider starts pedalling the ship does not jump to full speed.
  // Speed ramps up exponentially toward the target; this half-life (in
  // seconds) controls how fast. 3 s means the ship reaches half-speed in
  // 3 s, ~94 % in 10 s.
  var ACCEL_HALF_LIFE = 3;

  // --- Warp starfield ---
  var STAR_COUNT = 1900;
  var STAR_RADIUS = 70;
  var STAR_DEPTH = 260;
  var STAR_NEAR = 90;
  var STREAK_UNITS_PER_KMH = 1 / 20000;
  var STREAK_SECONDS = 0.30;
  var STREAK_MIN = 0.05;
  var STREAK_MAX = 55;

  var SPEED_SMOOTH = 0.04;
  var THRUST_SMOOTH = 0.08;

  var ARRIVAL_EASE = 0.02;
  var ORBIT_DRIFT_KMH = 20000;

  var SUN_DIR = new THREE.Vector3(-0.75, 0.35, -0.55).normalize();

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------------------------------------------------------------------
  // Procedural body textures (no external assets)
  // ---------------------------------------------------------------------
  function blob(ctx, cx, cy, r, sides, jitter, color) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2;
      var rr = r * (1 - jitter + Math.random() * jitter * 2);
      pts.push([cx + Math.cos(a) * rr * 1.7, cy + Math.sin(a) * rr]);
    }
    ctx.beginPath();
    var last = pts[sides - 1], first = pts[0];
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (i = 0; i < sides; i++) {
      var cur = pts[i], next = pts[(i + 1) % sides];
      ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function makeEarthTexture() {
    var w = 1024, h = 512;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    var ocean = ctx.createLinearGradient(0, 0, 0, h);
    ocean.addColorStop(0, '#0a2a52');
    ocean.addColorStop(0.5, '#12508f');
    ocean.addColorStop(1, '#0a2a52');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, w, h);

    var greens = ['#1f6b33', '#2b7d3c', '#3d7a35', '#6b7a3a', '#8a7c4a'];
    for (var i = 0; i < 26; i++) {
      var cx = Math.random() * w;
      var cy = h * 0.18 + Math.random() * h * 0.64;
      var r = 18 + Math.random() * 52;
      blob(ctx, cx, cy, r, 14, 0.45, greens[(Math.random() * greens.length) | 0]);
      for (var j = 0; j < 3; j++) {
        blob(ctx, cx + (Math.random() - 0.5) * r * 2.4, cy + (Math.random() - 0.5) * r * 1.4,
          r * 0.5, 12, 0.5, greens[(Math.random() * greens.length) | 0]);
      }
    }

    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, w, 22);
    ctx.fillRect(0, h - 26, w, 26);
    for (i = 0; i < 40; i++) {
      blob(ctx, Math.random() * w, 24 + Math.random() * 14, 8 + Math.random() * 14, 10, 0.5, '#eef6ff');
      blob(ctx, Math.random() * w, h - 28 - Math.random() * 16, 8 + Math.random() * 16, 10, 0.5, '#eef6ff');
    }

    ctx.globalAlpha = 0.42;
    for (i = 0; i < 70; i++) {
      blob(ctx, Math.random() * w, Math.random() * h, 10 + Math.random() * 34, 12, 0.6, '#ffffff');
    }
    ctx.globalAlpha = 1;

    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  }

  function makeMoonTexture() {
    var w = 1024, h = 512;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    ctx.fillStyle = '#9a9a97';
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.55;
    for (var i = 0; i < 12; i++) {
      blob(ctx, Math.random() * w, h * 0.2 + Math.random() * h * 0.6,
        26 + Math.random() * 60, 16, 0.4, '#5f6068');
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < 420; i++) {
      var cx = Math.random() * w, cy = Math.random() * h;
      var r = 2 + Math.random() * Math.random() * 26;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(70,70,76,0.45)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx - r * 0.12, cy - r * 0.12, r * 0.92, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(215,215,210,0.5)'; ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.stroke();
    }

    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  }

  function makeGlowTexture(inner, outer) {
    var size = 256;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  // ---------------------------------------------------------------------
  // Scene pieces
  // ---------------------------------------------------------------------
  function makeBody(radiusKm, texture) {
    var r = radiusKm / KM_PER_UNIT;
    var group = new THREE.Group();
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 64, 40),
      new THREE.MeshLambertMaterial({ map: texture })
    );
    group.add(mesh);
    group.userData.mesh = mesh;
    group.userData.radius = r;
    return group;
  }

  function makeAtmosphere(radiusUnits, color) {
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radiusUnits * 1.035, 48, 32),
      new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.22,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    return mesh;
  }

  function makeDotTexture() {
    var size = 64;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  function starLayer(count, R, size, opacity, dot) {
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);
    var c = new THREE.Color();
    for (var i = 0; i < count; i++) {
      var u = Math.random() * 2 - 1;
      var th = Math.random() * Math.PI * 2;
      var s = Math.sqrt(1 - u * u);
      pos[i * 3] = R * s * Math.cos(th);
      pos[i * 3 + 1] = R * s * Math.sin(th);
      pos[i * 3 + 2] = R * u;
      var t = Math.random();
      c.setHSL(t < 0.78 ? 0.58 : 0.08, 0.15 + Math.random() * 0.3, 0.6 + Math.random() * 0.35);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      map: dot, size: size, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: opacity, depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
  }

  function makeBackgroundStars() {
    var group = new THREE.Group();
    var dot = makeDotTexture();
    var R = 4200;
    group.add(starLayer(1500, R, 3.0, 0.55, dot));
    group.add(starLayer(520, R, 5.0, 0.75, dot));
    group.add(starLayer(120, R, 9.0, 0.95, dot));
    return group;
  }

  function makeSun() {
    var group = new THREE.Group();
    var d = 3000;
    var p = SUN_DIR.clone().multiplyScalar(d);
    var flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,255,245,1)', 'rgba(255,226,160,0.5)'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    flare.position.copy(p);
    flare.scale.set(900, 900, 1);
    flare.renderOrder = -1;
    group.add(flare);
    return group;
  }

  // ---------------------------------------------------------------------
  // Space Station V — the double-wheel rotating station from 2001
  // ---------------------------------------------------------------------
  // Two counter-rotating toroidal rings connected by spokes to a central
  // hub.  The camera starts inside the hub looking down the flight axis;
  // when the rider starts pedalling the ship undocks and the station
  // slides away behind.
  var STATION_HULL  = new THREE.MeshLambertMaterial({ color: 0xc8ccd0 });
  var STATION_DARK  = new THREE.MeshLambertMaterial({ color: 0x555a60 });
  var STATION_ACCENT = new THREE.MeshLambertMaterial({ color: 0xff6622 });

  function makeStationV() {
    var g = new THREE.Group();

    // --- Outer ring (larger, rotates +Y) --------------------------------
    var ring1 = new THREE.Group();
    var torus1 = new THREE.Mesh(
      new THREE.TorusGeometry(4.5, 0.16, 16, 80), STATION_HULL);
    torus1.rotation.x = Math.PI / 2;
    ring1.add(torus1);
    g.add(ring1);

    // --- Inner ring (smaller, counter-rotates -Y) -----------------------
    var ring2 = new THREE.Group();
    var torus2 = new THREE.Mesh(
      new THREE.TorusGeometry(3.0, 0.12, 12, 60), STATION_DARK);
    torus2.rotation.x = Math.PI / 2;
    ring2.add(torus2);
    g.add(ring2);

    // --- Central hub / spine --------------------------------------------
    var hubLen = 2.8;
    var hubR = 0.35;
    var hub = new THREE.Mesh(
      new THREE.CylinderGeometry(hubR, hubR, hubLen, 20, 1, true), STATION_HULL);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);

    // Hub end caps
    var capGeo = new THREE.CircleGeometry(hubR, 20);
    [-hubLen / 2, hubLen / 2].forEach(function (z) {
      var cap = new THREE.Mesh(capGeo, STATION_DARK);
      cap.position.z = z;
      if (z < 0) cap.rotation.y = Math.PI;
      g.add(cap);
    });

    // Interior lighting — point lights inside the hub illuminate the
    // corridor and ring interior so the "inside" experience reads.
    var hubLight = new THREE.PointLight(0xccddff, 1.2, 12);
    hubLight.position.set(0, 0, 0);
    g.add(hubLight);
    var warmLight = new THREE.PointLight(0xffe8cc, 0.6, 8);
    warmLight.position.set(0, 0, 1.2);
    g.add(warmLight);

    // --- Docking corridor (extends from the hub along +Z) ---------------
    var corrLen = 1.4;
    var corr = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, corrLen, 10, 1, true), STATION_DARK);
    corr.rotation.x = Math.PI / 2;
    corr.position.z = hubLen / 2 + corrLen / 2;
    g.add(corr);

    // Airlock ring at the corridor end
    var airlock = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.015, 8, 16), STATION_ACCENT);
    airlock.position.z = hubLen / 2 + corrLen;
    g.add(airlock);

    // --- Spokes: hub → outer ring ---------------------------------------
    var spokeOuter = new THREE.CylinderGeometry(0.03, 0.03, 4.2, 6);
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * Math.PI * 2;
      var spoke = new THREE.Mesh(spokeOuter, STATION_HULL);
      spoke.position.set(Math.cos(a) * 2.3, Math.sin(a) * 2.3, 0);
      spoke.rotation.z = a - Math.PI / 2;
      g.add(spoke);
    }

    // --- Spokes: hub → inner ring ---------------------------------------
    var spokeInner = new THREE.CylinderGeometry(0.022, 0.022, 2.7, 5);
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2 + Math.PI / 16;
      var spoke = new THREE.Mesh(spokeInner, STATION_DARK);
      spoke.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0);
      spoke.rotation.z = a - Math.PI / 2;
      g.add(spoke);
    }

    // Store ring groups for rotation in tick()
    g.userData.ring1 = ring1;
    g.userData.ring2 = ring2;

    g.userData.radius = 4.5;
    return g;
  }

  // --- Moon orbital station (simpler, cylindrical) ----------------------
  function makeMoonStation() {
    var g = new THREE.Group();
    var hull = STATION_HULL;

    // Central cylinder along Z
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 1.6, 12), hull);
    body.rotation.x = Math.PI / 2;
    g.add(body);

    // Solar panel arrays — two flat panels on a truss along X
    var panelGeo = new THREE.BoxGeometry(2.4, 0.02, 0.8);
    var panelMat = new THREE.MeshLambertMaterial({ color: 0x2244aa });
    [-1, 1].forEach(function (side) {
      var p = new THREE.Mesh(panelGeo, panelMat);
      p.position.x = side * 1.6;
      g.add(p);
    });
    var truss = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.04, 0.04), STATION_DARK);
    g.add(truss);

    // Docking port
    var dp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), STATION_ACCENT);
    dp.rotation.x = Math.PI / 2;
    dp.position.z = 1.0;
    g.add(dp);

    g.userData.radius = 1.6;
    return g;
  }

  AFRAME.registerComponent('space-scene', {
    init: function () {
      var root = this.el.object3D;

      this._posKm = DEPART_KM;
      this._targetKm = EARTH_MOON_KM - ARRIVE_KM;
      this._speedKmh = 0;
      this._targetSpeed = 0;
      this._thrust = 0;
      this._targetThrust = 0;
      this._arrived = false;
      this._arrivalEase = 1;
      this._shipKmh = 0;

      // Acceleration ramp: 0 → 1 exponentially once the rider starts pedalling.
      this._accel = 0;

      // Lighting
      var sun = new THREE.DirectionalLight(0xfff4e2, 2.6);
      sun.position.copy(SUN_DIR).multiplyScalar(500);
      root.add(sun);
      root.add(new THREE.AmbientLight(0x2a3a5a, 0.5));

      root.add(makeBackgroundStars());
      root.add(makeSun());

      this.earth = makeBody(EARTH_RADIUS_KM, makeEarthTexture());
      this.earth.add(makeAtmosphere(EARTH_RADIUS_KM / KM_PER_UNIT, 0x4ea6ff));
      root.add(this.earth);

      this.moon = makeBody(MOON_RADIUS_KM, makeMoonTexture());
      root.add(this.moon);

      // Space Station V — the camera starts inside its hub.
      // At departure the station sits between the camera (origin) and
      // Earth; as the ship accelerates it slides backward and out of view.
      this.earthStation = makeStationV();
      root.add(this.earthStation);

      // Moon orbital station — sits between camera and Moon, slides
      // backward as we approach (Moon closes in from -Z).
      this.moonStation = makeMoonStation();
      root.add(this.moonStation);

      this.buildWarp();
      root.add(this.warp);

      this.layout();
    },

    buildWarp: function () {
      var n = STAR_COUNT;
      this._sx = new Float32Array(n);
      this._sy = new Float32Array(n);
      this._sz = new Float32Array(n);
      this._sb = new Float32Array(n);

      for (var i = 0; i < n; i++) this.spawnStar(i, true);

      var pos = new Float32Array(n * 2 * 3);
      var col = new Float32Array(n * 2 * 3);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      this._warpPos = geo.attributes.position;
      this._warpCol = geo.attributes.color;

      this.warp = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      this.warp.frustumCulled = false;
    },

    spawnStar: function (i, anywhere) {
      var a = Math.random() * Math.PI * 2;
      var r = 1.5 + Math.sqrt(Math.random()) * STAR_RADIUS;
      this._sx[i] = Math.cos(a) * r;
      this._sy[i] = Math.sin(a) * r;
      this._sz[i] = anywhere
        ? -STAR_DEPTH + Math.random() * (STAR_DEPTH + STAR_NEAR)
        : -STAR_DEPTH - Math.random() * 20;
      this._sb[i] = 0.45 + Math.random() * 0.55;
    },

    setFlightData: function (fd) {
      if (fd.speed != null && !isNaN(fd.speed)) this._targetSpeed = Math.max(0, fd.speed);
      if (fd.thrust != null && !isNaN(fd.thrust)) this._targetThrust = clamp(fd.thrust, 0, 1);
    },

    nav: function () {
      var shipKmh = this._shipKmh;
      var total = this._targetKm - DEPART_KM;
      var done = this._posKm - DEPART_KM;
      var remaining = Math.max(0, this._targetKm - this._posKm);
      return {
        shipKmh: shipKmh,
        shipKms: shipKmh / 3600,
        lightPct: (shipKmh / 1079252848.8) * 100,
        travelledKm: done,
        remainingKm: remaining,
        totalKm: total,
        progress: total > 0 ? clamp(done / total, 0, 1) : 0,
        etaSeconds: shipKmh > 1 ? (remaining / shipKmh) * 3600 : null,
        arrived: this._arrived,
        earthDistanceKm: this._posKm,
        moonDistanceKm: Math.max(0, EARTH_MOON_KM - this._posKm),
        moonRadiusKm: MOON_RADIUS_KM,
        warpFactor: WARP_FACTOR,
        arriveKm: ARRIVE_KM
      };
    },

    // Place bodies and stations for the current position along the leg.
    // The ship stays at the origin; everything slides past it.
    layout: function () {
      this.earth.position.set(0, 0, this._posKm / KM_PER_UNIT);
      this.moon.position.set(0, 0, -(EARTH_MOON_KM - this._posKm) / KM_PER_UNIT);

      // Earth station sits just ahead of Earth (between camera and Earth).
      // It starts at ~0 km from the camera (inside the hub) and slides
      // backward as the ship undocks and accelerates.
      var stationZ = Math.max(0, (this._posKm - DEPART_KM) / KM_PER_UNIT - 0.4);
      this.earthStation.position.set(0, 0, stationZ);

      // Moon station sits just ahead of the Moon (between camera and Moon).
      var moonStationZ = Math.max(0, (EARTH_MOON_KM - this._posKm) / KM_PER_UNIT - 1.8);
      this.moonStation.position.set(0, 0, -moonStationZ);
    },

    tick: function (time, timeDelta) {
      var dt = timeDelta ? Math.min(timeDelta / 1000, 0.1) : 0.016;

      this._speedKmh += (this._targetSpeed - this._speedKmh) * SPEED_SMOOTH;
      this._thrust += (this._targetThrust - this._thrust) * THRUST_SMOOTH;

      // --- Acceleration ramp ---
      // Once the rider starts pedalling (_targetSpeed > 0) the ship
      // accelerates exponentially toward full speed.  This makes the
      // departure feel like the ship is powering up and pulling away
      // from the station, rather than teleporting to full velocity.
      if (this._targetSpeed > 0.5 && this._accel < 0.999) {
        this._accel += (1 - this._accel) * (1 - Math.pow(0.5, dt / ACCEL_HALF_LIFE));
      }

      // --- Travel, at real distances ---
      this._arrivalEase += ((this._arrived ? 0 : 1) - this._arrivalEase) * ARRIVAL_EASE;
      var shipKmh = this._speedKmh * WARP_FACTOR * this._accel * this._arrivalEase;
      this._shipKmh = shipKmh;
      this._posKm += shipKmh * (dt / 3600);
      if (this._posKm >= this._targetKm) {
        this._posKm = this._targetKm;
        this._arrived = true;
      }
      this.layout();

      // Slow body rotation
      this.earth.userData.mesh.rotation.y += dt * 0.02;
      this.moon.userData.mesh.rotation.y += dt * 0.005;

      // Rotate station rings (Space Station V counter-rotates)
      if (this.earthStation.userData.ring1) {
        this.earthStation.userData.ring1.rotation.y += dt * 0.12;
      }
      if (this.earthStation.userData.ring2) {
        this.earthStation.userData.ring2.rotation.y -= dt * 0.18;
      }

      this.updateWarp(dt, shipKmh);
    },

    updateWarp: function (dt, shipKmh) {
      var pos = this._warpPos.array;
      var col = this._warpCol.array;
      var n = STAR_COUNT;

      var streakKmh = Math.max(shipKmh, this._arrived ? ORBIT_DRIFT_KMH : 0);
      var vis = streakKmh * STREAK_UNITS_PER_KMH;
      var streak = clamp(vis * STREAK_SECONDS, STREAK_MIN, STREAK_MAX);
      streak *= 1 + this._thrust * 0.35;
      var move = vis * dt;

      var p = 0, c = 0;
      for (var i = 0; i < n; i++) {
        this._sz[i] += move;
        if (this._sz[i] > STAR_NEAR) this.spawnStar(i, false);

        var x = this._sx[i], y = this._sy[i], z = this._sz[i];
        var tail = z - streak;

        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z; p += 3;
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = tail; p += 3;

        var depth = clamp((z + STAR_DEPTH) / (STAR_DEPTH * 0.55), 0, 1);
        var near = clamp((STAR_NEAR - z) / 30, 0, 1);
        var b = this._sb[i] * depth * near;
        var head = b;
        var tailB = b * 0.12;

        col[c] = head; col[c + 1] = head; col[c + 2] = head; c += 3;
        col[c] = tailB * 0.5; col[c + 1] = tailB * 0.8; col[c + 2] = tailB; c += 3;
      }

      this._warpPos.needsUpdate = true;
      this._warpCol.needsUpdate = true;
    }
  });
})();
