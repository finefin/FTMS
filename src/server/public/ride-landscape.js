(function () {
  // =====================================================================
  // ride-landscape.js
  // Synthwave wireframe world, ported from the "Rhythm Sword" beat-saber
  // clone. Ground grid, canyon walls (mountains), sun, and stars. Unlike the
  // original — which was driven by a song's audio waveform — this version is
  // driven entirely by live fitness data:
  //   * speed       -> how fast the world scrolls past the player
  //   * power       -> mountain height (the power curve shapes the terrain)
  //   * heart rate  -> how hard the sun's glow pulses
  //
  // Mountains are a scrolling graph: each canyon row's height is a power
  // sample laid down as you ride and drifting out behind you. The world
  // starts flat (power = 0) and rises as you begin pedaling. The profile
  // scrolls continuously with interpolation so it never jumps.
  // =====================================================================

  var STEP = 2.5;
  var X_HALF = 80;
  var Z_START = -150;
  var Z_END = 30;

  var GRID_NEAR = new THREE.Color(0xff36c8);
  var GRID_FAR = new THREE.Color(0x3a1568);

  var SUN_POS = { x: 0, y: 9, z: -132 };
  var SUN_RADIUS = 9;

  var WALL_STEP_X = 5;
  var WALL_STEP_Z = 4;
  var WALL_FLAT_HALF = 12;
  var WALL_RISE = 60;
  var WALL_MAXH = 30;
  var WALL_ROWS = 240;
  var WALL_FLAT = new THREE.Color(0x00f6ff);
  var WALL_PEAK = new THREE.Color(0xff2bd6);

  // Meters of track covered by one graph sample, equal to WALL_STEP_Z so each
  // canyon cell/row is exactly one data point (a clean 1:1 speed graph). At,
  // say, 20 km/h (~5.6 m/s) that's a new sample every ~0.7s.
  var SAMPLE_SPACING = WALL_STEP_Z;

  // How aggressively the live value is smoothed toward the transmitted one
  // (higher = snappier, lower = longer smoothing tail).
  var VALUE_SMOOTH = 0.15;
  // How aggressively the scroll speed eases toward its target so forward
  // movement glides rather than snapping between transmitted samples.
  var SPEED_SMOOTH = 0.05;

  function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function makeSunTexture() {
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');

    var grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#fff6c8');
    grad.addColorStop(0.32, '#ffcf3d');
    grad.addColorStop(0.58, '#ff7a3d');
    grad.addColorStop(0.82, '#ff2bd6');
    grad.addColorStop(1, '#7d1fae');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.globalCompositeOperation = 'destination-out';
    var y = size * 0.44;
    var idx = 0;
    while (y < size) {
      var h = 3 + idx * 1.1;
      ctx.fillRect(0, y, size, h);
      y += h + 5 + idx * 0.7;
      idx++;
    }
    ctx.globalCompositeOperation = 'source-over';

    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  }

  function makeGlowTexture() {
    var size = 128;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,150,220,0.55)');
    grad.addColorStop(0.45, 'rgba(255,90,210,0.22)');
    grad.addColorStop(1, 'rgba(255,90,210,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  function buildGrid() {
    var xs = [], zs = [];
    var x, z;
    for (x = -X_HALF; x <= X_HALF; x += STEP) xs.push(x);
    for (z = Z_START; z <= Z_END; z += STEP) zs.push(z);

    var pos = [], col = [];
    var c = new THREE.Color();
    var i, j;

    function pushColor(zv) {
      var t = Math.min(1, Math.max(0, (zv - Z_START) / (Z_END - Z_START)));
      c.copy(GRID_FAR).lerp(GRID_NEAR, t);
      col.push(c.r, c.g, c.b);
    }

    for (j = 0; j < zs.length; j++) {
      for (i = 0; i < xs.length - 1; i++) {
        pos.push(xs[i], 0, zs[j], xs[i + 1], 0, zs[j]);
        pushColor(zs[j]);
        pushColor(zs[j]);
      }
    }
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < zs.length - 1; j++) {
        pos.push(xs[i], 0, zs[j], xs[i], 0, zs[j + 1]);
        pushColor(zs[j]);
        pushColor(zs[j + 1]);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    return new THREE.LineSegments(geo, mat);
  }

  // ---------------------------------------------------------------------
  // Mountains (a scrolling live graph)
  // ---------------------------------------------------------------------
  // Same wireframe canyon structure as the original: row i sits at
  // -WALL_STEP_Z*i and the group scrolls by speed*elapsed so the canyon flows
  // toward the player. But instead of random/song-driven height, each canyon
  // row's height is a *data sample* — a point on the live speed graph.
  //
  // We keep a ring buffer of the most recent WALL_ROWS samples. As the player
  // travels, a sink "write head" advances through the ring (advance =
  // distance / SAMPLE_SPACING); at each integer grid point we record the
  // current (smoothed) value, laying a sample down behind the player. Each
  // frame every row reads the graph at its track position and interpolates
  // between the two nearest samples, so the profile scrolls continuously with
  // no jumping and no stepping.
  //
  // The whole range is scaled by WALL_MAXH as before, so faster speeds make
  // taller mountains — the graph literally shapes the terrain you fly past.

  var RING_SIZE = WALL_ROWS + 4;

  function buildWalls() {
    var xs = [];
    for (var x = -X_HALF; x <= X_HALF; x += WALL_STEP_X) xs.push(x);
    this._xs = xs;

    function envelope(xv) {
      var d = Math.abs(xv);
      if (d <= WALL_FLAT_HALF) return 0;
      var t = Math.min(1, (d - WALL_FLAT_HALF) / WALL_RISE);
      return t * t;
    }
    this._envelope = envelope;

    var pos = [], col = [];
    var i, j, z0, z1;

    // Horizontal segments: each row, produced as pos + matching color count.
    for (j = 0; j < WALL_ROWS; j++) {
      z0 = -WALL_STEP_Z * j;
      for (i = 0; i < xs.length - 1; i++) {
        pos.push(xs[i], 0, z0, xs[i + 1], 0, z0);
      }
    }
    // Vertical segments connecting rows.
    for (i = 0; i < xs.length; i++) {
      for (j = 0; j < WALL_ROWS - 1; j++) {
        z0 = -WALL_STEP_Z * j;
        z1 = -WALL_STEP_Z * (j + 1);
        pos.push(xs[i], 0, z0, xs[i], 0, z1);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this._xs = xs;
    this._posAttr = geo.attributes.position;
    this._colAttr = geo.attributes.color;
    this._c = new THREE.Color();

    // Ring buffer of recent graph samples (0..1 heights).
    this._ring = new Float32Array(RING_SIZE);
    // Float write-head in sample units (grows unbounded with distance).
    this._idx = 0;
    // Last integer sample index we have written, so we only advance by the
    // delta the player actually covered each frame.
    this._written = 0;
    // Current (smoothed) value the mountains are plotting. Starts flat.
    this._cur = 0;

    // Pre-fill the ring at 0 so the world is flat until data arrives.
    for (var k = 0; k < RING_SIZE; k++) this._ring[k] = 0;

    return new THREE.LineSegments(geo, mat);
  }

  function wrap(i) {
    i %= RING_SIZE;
    if (i < 0) i += RING_SIZE;
    return i;
  }

  // Lay the current value down at every graph sample point the player has
  // passed since the last frame (i.e. between `written` and `floor(idx)`).
  function advanceGraph() {
    var to = Math.floor(this._idx);
    var from = this._written;
    if (to > from) {
      for (var k = from; k < to; k++) this._ring[wrap(k)] = this._cur;
      this._written = to;
    }
    // Keep an extra freshly-filled slot so interpolating the front row always
    // has a valid neighbour.
    this._ring[wrap(to + 1)] = this._cur;
  }

  // Read the (interpolated) graph height at absolute sample position `s`.
  function sampleGraph(s) {
    var p = Math.floor(s);
    var frac = s - p;
    var a = this._ring[wrap(p)];
    var b = this._ring[wrap(p + 1)];
    var v = a + (b - a) * frac;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    return v;
  }

  function updateWalls() {
    var xs = this._xs;
    var env = this._envelope;
    var pos = this._posAttr.array;
    var col = this._colAttr.array;
    var c = this._c;
    var i, j, idx = 0;

    // Row j is `j` sample-points behind the current write head.
    var base = this._idx;
    var z;

    for (j = 0; j < WALL_ROWS; j++) {
      // Track position of this row, interpolated sample value.
      var hs = sampleGraph.call(this, base - j) * WALL_MAXH;
      z = -WALL_STEP_Z * j;
      for (i = 0; i < xs.length - 1; i++) {
        var h1 = env(xs[i]) * hs;
        var h2 = env(xs[i + 1]) * hs;
        pos[idx++] = xs[i];     pos[idx++] = h1; pos[idx++] = z;
        pos[idx++] = xs[i + 1]; pos[idx++] = h2; pos[idx++] = z;
      }
    }
    for (i = 0; i < xs.length; i++) {
      var xv = xs[i];
      for (j = 0; j < WALL_ROWS - 1; j++) {
        var h0 = env(xv) * sampleGraph.call(this, base - j) * WALL_MAXH;
        var h1 = env(xv) * sampleGraph.call(this, base - (j + 1)) * WALL_MAXH;
        pos[idx++] = xv; pos[idx++] = h0; pos[idx++] = -WALL_STEP_Z * j;
        pos[idx++] = xv; pos[idx++] = h1; pos[idx++] = -WALL_STEP_Z * (j + 1);
      }
    }

    // Recompute vertex colors (cyan at base -> magenta at peak).
    idx = 0;
    for (j = 0; j < WALL_ROWS; j++) {
      var cj = sampleGraph.call(this, base - j) * WALL_MAXH;
      for (i = 0; i < xs.length - 1; i++) {
        this._colorAt(c, env(xs[i]) * cj);
        col[idx++] = c.r; col[idx++] = c.g; col[idx++] = c.b;
        this._colorAt(c, env(xs[i + 1]) * cj);
        col[idx++] = c.r; col[idx++] = c.g; col[idx++] = c.b;
      }
    }
    for (i = 0; i < xs.length; i++) {
      var xv2 = xs[i];
      for (j = 0; j < WALL_ROWS - 1; j++) {
        this._colorAt(c, env(xv2) * sampleGraph.call(this, base - j) * WALL_MAXH);
        col[idx++] = c.r; col[idx++] = c.g; col[idx++] = c.b;
        this._colorAt(c, env(xv2) * sampleGraph.call(this, base - (j + 1)) * WALL_MAXH);
        col[idx++] = c.r; col[idx++] = c.g; col[idx++] = c.b;
      }
    }

    this._posAttr.needsUpdate = true;
    this._colAttr.needsUpdate = true;
  }

  function colorAt(c, hv) {
    var t = Math.min(1, hv / WALL_MAXH);
    if (t < 0) t = 0;
    c.copy(WALL_FLAT).lerp(WALL_PEAK, t);
  }

  function buildSun() {
    var group = new THREE.Group();

    var glow = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS * 2.6, 32),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false
      })
    );
    glow.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z + 0.5);
    group.add(glow);

    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS, 48),
      new THREE.MeshBasicMaterial({ map: makeSunTexture(), transparent: true, depthWrite: false, fog: false })
    );
    disc.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
    group.add(disc);

    group.userData.glow = glow;
    return group;
  }

  function buildStars() {
    var count = 500;
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 320;
      positions[i * 3 + 1] = 18 + Math.random() * 130;
      positions[i * 3 + 2] = -40 - Math.random() * 280;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.8, fog: false
    });
    return new THREE.Points(geo, mat);
  }

  AFRAME.registerComponent('ride-landscape', {
    schema: {
      speed: { type: 'number', default: 12 },
      value: { type: 'number', default: 0 },
      heartRate: { type: 'number', default: 80 }
    },

    init: function () {
      this._offset = 0;
      this._t = 0;
      this._dt = 0.016;
      this._heartRate = 80;
      this._targetHeartRate = 80;

      // Smoothed scroll speed and graph value (targets come from ride.js).
      this._speed = this.data.speed;
      this._targetSpeed = this.data.speed;
      // Normalized 0..1 value plotted as the mountain height. Starts at 0
      // (flat) until the user starts pedaling and power > 0 arrives.
      this._cur = 0;
      this._targetValue = 0;

      this._colorAt = colorAt;

      this.grid = buildGrid();
      this.el.object3D.add(this.grid);

      this.walls = buildWalls.call(this);
      this.el.object3D.add(this.walls);

      this.sun = buildSun();
      this.el.object3D.add(this.sun);

      this.stars = buildStars();
      this.el.object3D.add(this.stars);
    },

    setFitnessData: function (fd) {
      if (fd.value !== undefined) this._targetValue = clamp01(fd.value);
      if (fd.heartRate !== undefined) this._targetHeartRate = fd.heartRate;
      if (fd.speed !== undefined) this._targetSpeed = fd.speed;
    },

    tick: function (t, dt) {
      dt = dt !== undefined && dt > 0 ? dt / 1000 : 0.016;
      this._dt = dt;
      this._t += dt;

      // Ease scroll speed and plotted value toward their targets so both the
      // forward motion and the mountains glide smoothly between data points.
      this._speed += (this._targetSpeed - this._speed) * SPEED_SMOOTH;
      this._cur += (this._targetValue - this._cur) * VALUE_SMOOTH;
      this._heartRate += (this._targetHeartRate - this._heartRate) * 0.05;

      var speed = this._speed;

      this._offset += speed * dt;
      this.grid.position.z = this._offset % STEP;
      // Walls stay at z=0 — the ring-based scroll (advanceGraph + updateWalls)
      // handles the profile motion. Shifting the group would move all geometry
      // past the camera and make the mountains invisible.

      // Advance the graph write-head by the distance covered, laying the
      // current value down as a new sample, then push it through the canyon.
      this._idx += speed * dt / SAMPLE_SPACING;
      advanceGraph.call(this);
      updateWalls.call(this);

      var hr = this._heartRate;
      var freq = 0.6 + (hr / 200) * 1.6;
      var base = 0.7 + (hr / 300) * 0.2;
      var amp = 0.15 + (hr / 250) * 0.1;
      var glow = this.sun.userData.glow;
      if (glow) glow.material.opacity = base + amp * Math.sin(this._t * freq);
    }
  });
})();
