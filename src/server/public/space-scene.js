(function () {
  // =====================================================================
  // space-scene.js
  // A flight from Earth to the Moon at true distances, driven by live FTMS
  // telemetry:
  //   * speed  -> velocity through space (real km/h x WARP_FACTOR)
  //   * power  -> engine thrust: exhaust glow and streak intensity
  //
  // Scale is 1 world unit = 1000 km, and every body radius and separation
  // below is the real figure. The Moon therefore subtends ~0.55 deg at
  // departure, just as it does from Earth, and grows to fill the view on
  // approach — the sense of having crossed real distance is genuine.
  //
  // The warp streaks are the one deliberate lie, and they have to be: at
  // true scale 1.5 million km/h is 0.4 units/s, which reads as completely
  // motionless. Streak speed is therefore its own mapping (see
  // STREAK_UNITS_PER_KMH) tuned purely so velocity is legible. Distance
  // travelled, time remaining and the Moon's growth all stay honest.
  // =====================================================================

  // --- The solar system, in kilometres ---
  var KM_PER_UNIT = 1000;
  var EARTH_RADIUS_KM = 6371;
  var MOON_RADIUS_KM = 1737;
  var EARTH_MOON_KM = 384400;   // mean centre-to-centre distance

  // Depart from low orbit rather than the planet's centre, and finish in
  // lunar orbit rather than inside the Moon.
  var DEPART_KM = 20000;
  var ARRIVE_KM = 5000;

  // Real km/h from the machine is multiplied by this to get ship velocity.
  // 30 km/h becomes 1.5 million km/h (~0.14% of light speed), which crosses
  // the 359,400 km leg in about 15 minutes of riding.
  var WARP_FACTOR = 50000;

  // --- Warp starfield ---
  var STAR_COUNT = 1900;
  var STAR_RADIUS = 70;     // spread perpendicular to the flight axis
  var STAR_DEPTH = 260;     // spawn distance ahead
  var STAR_NEAR = 90;       // recycle only well behind the camera, so looking
                            // back still shows stars receding
  // Ship km/h -> units/s for the streaks only. See the note above.
  var STREAK_UNITS_PER_KMH = 1 / 20000;
  // Seconds of travel a streak represents; longer = more Star Trek.
  var STREAK_SECONDS = 0.30;
  var STREAK_MIN = 0.05;
  var STREAK_MAX = 55;

  var SPEED_SMOOTH = 0.04;
  var THRUST_SMOOTH = 0.08;

  // Once the leg is complete the ship is station-keeping in lunar orbit, so
  // transit velocity winds down instead of continuing to report a burn that
  // is no longer happening. A little residual drift keeps the starfield alive
  // without pretending we are still crossing space.
  var ARRIVAL_EASE = 0.02;
  var ORBIT_DRIFT_KMH = 20000;

  // Sunlight comes from off to port and slightly above, so both bodies show
  // a terminator instead of reading as flat discs.
  var SUN_DIR = new THREE.Vector3(-0.75, 0.35, -0.55).normalize();

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---------------------------------------------------------------------
  // Procedural body textures (no external assets)
  // ---------------------------------------------------------------------
  // An irregular closed shape. The outline runs as quadratics through the
  // midpoints of a jittered polygon, so coastlines come out organic instead
  // of visibly faceted.
  function blob(ctx, cx, cy, r, sides, jitter, color) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = (i / sides) * Math.PI * 2;
      var rr = r * (1 - jitter + Math.random() * jitter * 2);
      pts.push([cx + Math.cos(a) * rr * 1.7, cy + Math.sin(a) * rr]);  // x stretched for equirect
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
      var cy = h * 0.18 + Math.random() * h * 0.64;   // keep off the poles
      var r = 18 + Math.random() * 52;
      blob(ctx, cx, cy, r, 14, 0.45, greens[(Math.random() * greens.length) | 0]);
      for (var j = 0; j < 3; j++) {
        blob(ctx, cx + (Math.random() - 0.5) * r * 2.4, cy + (Math.random() - 0.5) * r * 1.4,
          r * 0.5, 12, 0.5, greens[(Math.random() * greens.length) | 0]);
      }
    }

    // Ice caps.
    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, w, 22);
    ctx.fillRect(0, h - 26, w, 26);
    for (i = 0; i < 40; i++) {
      blob(ctx, Math.random() * w, 24 + Math.random() * 14, 8 + Math.random() * 14, 10, 0.5, '#eef6ff');
      blob(ctx, Math.random() * w, h - 28 - Math.random() * 16, 8 + Math.random() * 16, 10, 0.5, '#eef6ff');
    }

    // Cloud deck.
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

    // Maria: the big dark basalt plains.
    ctx.globalAlpha = 0.55;
    for (var i = 0; i < 12; i++) {
      blob(ctx, Math.random() * w, h * 0.2 + Math.random() * h * 0.6,
        26 + Math.random() * 60, 16, 0.4, '#5f6068');
    }
    ctx.globalAlpha = 1;

    // Craters: dark floor, bright rim.
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
    // A back-facing additive shell reads as a rim of atmosphere without
    // needing a custom shader.
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radiusUnits * 1.035, 48, 32),
      new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.22,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    return mesh;
  }

  // A soft round dot. Without a map, PointsMaterial draws hard squares, which
  // read as blocky pixels rather than stars.
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
      // Mostly white-blue with a scatter of warm stars.
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
    // Fixed stars: far enough away that crossing the leg produces no parallax,
    // which is exactly right at these distances. Three layers of differing
    // size give the field depth, since sizeAttenuation is off and a single
    // Points object can only draw one size.
    var group = new THREE.Group();
    var dot = makeDotTexture();
    var R = 4200;
    group.add(starLayer(1500, R, 3.0, 0.55, dot));   // faint background
    group.add(starLayer(520, R, 5.0, 0.75, dot));    // mid
    group.add(starLayer(120, R, 9.0, 0.95, dot));    // a few bright ones
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

  AFRAME.registerComponent('space-scene', {
    init: function () {
      var root = this.el.object3D;

      this._posKm = DEPART_KM;
      this._targetKm = EARTH_MOON_KM - ARRIVE_KM;
      this._speedKmh = 0;         // real machine speed, smoothed
      this._targetSpeed = 0;
      this._thrust = 0;           // 0..1, from power
      this._targetThrust = 0;
      this._arrived = false;
      this._arrivalEase = 1;    // 1 = under way, 0 = arrived and stopped
      this._shipKmh = 0;

      // Lighting: one sun, plus a little fill so night sides are not voids.
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

      this.buildWarp();
      root.add(this.warp);

      this.layout();
    },

    buildWarp: function () {
      var n = STAR_COUNT;
      this._sx = new Float32Array(n);
      this._sy = new Float32Array(n);
      this._sz = new Float32Array(n);
      this._sb = new Float32Array(n);   // per-star base brightness

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
      // Uniform over the disc, with a small hole so the vanishing point does
      // not clog with stars that never move on screen.
      var a = Math.random() * Math.PI * 2;
      var r = 1.5 + Math.sqrt(Math.random()) * STAR_RADIUS;
      this._sx[i] = Math.cos(a) * r;
      this._sy[i] = Math.sin(a) * r;
      this._sz[i] = anywhere
        ? -STAR_DEPTH + Math.random() * (STAR_DEPTH + STAR_NEAR)
        : -STAR_DEPTH - Math.random() * 20;
      this._sb[i] = 0.45 + Math.random() * 0.55;
    },

    /** Live telemetry in, from space.js. */
    setFlightData: function (fd) {
      if (fd.speed != null && !isNaN(fd.speed)) this._targetSpeed = Math.max(0, fd.speed);
      if (fd.thrust != null && !isNaN(fd.thrust)) this._targetThrust = clamp(fd.thrust, 0, 1);
    },

    /** Navigation readout for the HUD. */
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
        warpFactor: WARP_FACTOR
      };
    },

    /** Place both bodies for the current position along the leg. */
    layout: function () {
      // Bodies sit on the flight axis; the ship stays at the origin and the
      // system slides past, which keeps precision sane over 384,400 km.
      this.earth.position.set(0, 0, this._posKm / KM_PER_UNIT);
      this.moon.position.set(0, 0, -(EARTH_MOON_KM - this._posKm) / KM_PER_UNIT);
    },

    tick: function (time, timeDelta) {
      var dt = timeDelta ? Math.min(timeDelta / 1000, 0.1) : 0.016;

      this._speedKmh += (this._targetSpeed - this._speedKmh) * SPEED_SMOOTH;
      this._thrust += (this._targetThrust - this._thrust) * THRUST_SMOOTH;

      // --- Travel, at real distances ---
      this._arrivalEase += ((this._arrived ? 0 : 1) - this._arrivalEase) * ARRIVAL_EASE;
      var shipKmh = this._speedKmh * WARP_FACTOR * this._arrivalEase;
      this._shipKmh = shipKmh;
      this._posKm += shipKmh * (dt / 3600);
      if (this._posKm >= this._targetKm) {
        this._posKm = this._targetKm;
        this._arrived = true;
      }
      this.layout();

      // Slow rotation so the bodies read as solid.
      this.earth.userData.mesh.rotation.y += dt * 0.02;
      this.moon.userData.mesh.rotation.y += dt * 0.005;

      this.updateWarp(dt, shipKmh);
    },

    updateWarp: function (dt, shipKmh) {
      var pos = this._warpPos.array;
      var col = this._warpCol.array;
      var n = STAR_COUNT;

      // In orbit the transit is over, but a slow drift reads better than a
      // frozen starfield.
      var streakKmh = Math.max(shipKmh, this._arrived ? ORBIT_DRIFT_KMH : 0);
      var vis = streakKmh * STREAK_UNITS_PER_KMH;         // units/s, visual
      var streak = clamp(vis * STREAK_SECONDS, STREAK_MIN, STREAK_MAX);
      // Thrust adds a little extra length and heat, so pushing harder reads
      // in the starfield and not only on the gauge.
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

        // Fade in from the spawn plane and out as it sweeps past, so nothing
        // pops into or out of existence.
        var depth = clamp((z + STAR_DEPTH) / (STAR_DEPTH * 0.55), 0, 1);
        var near = clamp((STAR_NEAR - z) / 30, 0, 1);
        var b = this._sb[i] * depth * near;
        var head = b;
        var tailB = b * 0.12;

        // Head is white-hot, tail cools to blue: the Trek look.
        col[c] = head; col[c + 1] = head; col[c + 2] = head; c += 3;
        col[c] = tailB * 0.5; col[c + 1] = tailB * 0.8; col[c + 2] = tailB; c += 3;
      }

      this._warpPos.needsUpdate = true;
      this._warpCol.needsUpdate = true;
    }
  });
})();
