(function () {
  // =====================================================================
  // ride-landscape.js
  // Synthwave wireframe world driven entirely by live fitness data:
  //   * power       -> mountain height (the canyon IS the power curve)
  //   * speed       -> how fast the world scrolls past the player
  //   * heart rate  -> how hard the sun's glow pulses
  //
  // The canyon is a scrolling graph of your recent power output. A new
  // sample is laid down at the horizon every SAMPLE_SPACING metres of
  // travel, and the whole profile streams toward the player and passes by,
  // matching the direction the ground grid scrolls.
  //
  // Scrolling uses the classic treadmill trick: rows are fixed in the
  // group's local space and read the sample ring at *integer* offsets, and
  // the group itself slides forward by the fractional part of a sample.
  // When the fraction wraps, the group snaps back one row-spacing at the
  // same moment every row inherits its far neighbour's height, so the
  // motion is seamless while the vertex buffer is only rewritten when the
  // profile actually changes.
  // =====================================================================

  // --- Ground grid ---
  var STEP = 2.5;
  var X_HALF = 60;
  var Z_START = -250;
  var Z_END = 30;

  var GRID_NEAR = new THREE.Color(0xff36c8);
  var GRID_FAR = new THREE.Color(0x3a1568);

  // --- Sun (a pure backdrop: drawn first, never depth-tested) ---
  var SUN_POS = { x: 0, y: 14, z: -280 };
  var SUN_RADIUS = 17;

  // --- Canyon walls (the power graph) ---
  var WALL_X_HALF = 44;      // walls stop inside the grid; nothing is built off-screen
  var WALL_STEP_X = 4;       // 23 columns
  var WALL_STEP_Z = 4;       // one graph sample per 4 m of track
  var WALL_ROWS = 60;        // 240 m of visible history
  var WALL_Z_NEAR = 12;      // nearest row sits behind the camera so peaks sweep past
  var WALL_FLAT_HALF = 9;    // half-width of the flat riding corridor
  var WALL_RIDGE_X = 24;     // where the wall reaches full height (the readable crest line)
  var WALL_MAXH = 42;        // height of a 100%-power sample

  // Metres of track per graph sample. Must equal the row spacing: the
  // treadmill scroll below relies on one sample occupying exactly one row.
  var SAMPLE_SPACING = WALL_STEP_Z;

  // Reported km/h is scaled before driving the world, purely so the ride
  // feels fast at realistic speeds. It scales the sample rate identically
  // (both derive from the same metres/second), so at 25 km/h a sample lands
  // every ~0.36 s and the canyon shows ~26 s of power history.
  var WORLD_SPEED_SCALE = 1.6;

  // Smoothing of the plotted value and the scroll speed toward the values
  // last transmitted (higher = snappier, lower = longer tail).
  var VALUE_SMOOTH = 0.12;
  var SPEED_SMOOTH = 0.05;

  // Rewrite the vertex buffers only once the profile has moved by more than
  // this (in normalized 0..1 units). Holding a steady power costs nothing.
  var REDRAW_EPS = 0.0005;

  var RING_SIZE = WALL_ROWS + 8;

  function clamp01(v) {
    if (isNaN(v) || v == null) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function wrap(i) {
    i %= RING_SIZE;
    if (i < 0) i += RING_SIZE;
    return i;
  }

  // ---------------------------------------------------------------------
  // Colour ramp: cyan at the canyon floor -> magenta -> white-hot at peak.
  // Precomputed into a flat LUT so per-vertex colouring is two array reads
  // instead of a Color.lerp.
  // ---------------------------------------------------------------------
  var LUT_STEPS = 48;
  var COLOR_LUT = new Float32Array((LUT_STEPS + 1) * 3);
  (function buildLut() {
    var lo = new THREE.Color(0x00f6ff);
    var mid = new THREE.Color(0xff2bd6);
    var hi = new THREE.Color(0xfff0ff);
    var c = new THREE.Color();
    for (var i = 0; i <= LUT_STEPS; i++) {
      var t = i / LUT_STEPS;
      if (t < 0.55) c.copy(lo).lerp(mid, t / 0.55);
      else c.copy(mid).lerp(hi, (t - 0.55) / 0.45);
      COLOR_LUT[i * 3] = c.r;
      COLOR_LUT[i * 3 + 1] = c.g;
      COLOR_LUT[i * 3 + 2] = c.b;
    }
  })();

  function lutIndex(t) {
    var i = (t * LUT_STEPS) | 0;
    if (i < 0) i = 0; else if (i > LUT_STEPS) i = LUT_STEPS;
    return i * 3;
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
      depthWrite: false,
      fog: true
    });
    return new THREE.LineSegments(geo, mat);
  }

  // ---------------------------------------------------------------------
  // Canyon construction
  // ---------------------------------------------------------------------
  // Row j sits at local z = WALL_Z_NEAR - j*WALL_STEP_Z, so j = 0 is the
  // nearest row (just behind the camera) and j = WALL_ROWS-1 is the horizon.
  // Only y changes at runtime; x and z are written once here.
  // ---------------------------------------------------------------------

  function rowZ(j) {
    return WALL_Z_NEAR - WALL_STEP_Z * j;
  }

  function buildWalls() {
    var xs = [];
    for (var x = -WALL_X_HALF; x <= WALL_X_HALF; x += WALL_STEP_X) xs.push(x);
    this._xs = xs;

    // Cross-section profile: a flat corridor, a smooth rise, then a plateau
    // beyond the ridge. The ridge column is where the crest line is drawn.
    var envs = new Float32Array(xs.length);
    var ridgeLeft = -1, ridgeRight = -1;
    for (var i = 0; i < xs.length; i++) {
      var d = Math.abs(xs[i]);
      if (d <= WALL_FLAT_HALF) envs[i] = 0;
      else envs[i] = smoothstep(Math.min(1, (d - WALL_FLAT_HALF) / (WALL_RIDGE_X - WALL_FLAT_HALF)));
      if (xs[i] === -WALL_RIDGE_X) ridgeLeft = i;
      if (xs[i] === WALL_RIDGE_X) ridgeRight = i;
    }
    this._envs = envs;
    this._ridgeLeft = ridgeLeft >= 0 ? ridgeLeft : 0;
    this._ridgeRight = ridgeRight >= 0 ? ridgeRight : xs.length - 1;

    var group = new THREE.Group();

    // --- Wireframe mesh (horizontal rungs + vertical stringers) ---
    var nH = WALL_ROWS * (xs.length - 1) * 2;
    var nV = xs.length * (WALL_ROWS - 1) * 2;
    var total = nH + nV;

    var pos = new Float32Array(total * 3);
    var col = new Float32Array(total * 3);
    var p = 0, i2, j2;

    for (j2 = 0; j2 < WALL_ROWS; j2++) {
      var zr = rowZ(j2);
      for (i2 = 0; i2 < xs.length - 1; i2++) {
        pos[p] = xs[i2];     pos[p + 2] = zr; p += 3;
        pos[p] = xs[i2 + 1]; pos[p + 2] = zr; p += 3;
      }
    }
    for (i2 = 0; i2 < xs.length; i2++) {
      for (j2 = 0; j2 < WALL_ROWS - 1; j2++) {
        pos[p] = xs[i2]; pos[p + 2] = rowZ(j2);     p += 3;
        pos[p] = xs[i2]; pos[p + 2] = rowZ(j2 + 1); p += 3;
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    var mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    var mesh = new THREE.LineSegments(geo, mat);
    group.add(mesh);

    // --- Crest lines: the ridge polylines that read as the power curve ---
    // GL ignores LineBasicMaterial.linewidth, so each ridge is drawn as three
    // closely-spaced parallel lines; additively blended they give the crest
    // real visual weight against the busy grid behind it.
    var CREST_OFFSETS = [-0.45, 0, 0.45];
    var crestCount = (WALL_ROWS - 1) * 2 * 2 * CREST_OFFSETS.length;
    var cpos = new Float32Array(crestCount * 3);
    p = 0;
    for (var side = 0; side < 2; side++) {
      var xv = side === 0 ? -WALL_RIDGE_X : WALL_RIDGE_X;
      for (var oi = 0; oi < CREST_OFFSETS.length; oi++) {
        var xo = xv + CREST_OFFSETS[oi];
        for (j2 = 0; j2 < WALL_ROWS - 1; j2++) {
          cpos[p] = xo; cpos[p + 2] = rowZ(j2);     p += 3;
          cpos[p] = xo; cpos[p + 2] = rowZ(j2 + 1); p += 3;
        }
      }
    }
    this._crestOffsets = CREST_OFFSETS;
    var cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(crestCount * 3), 3));
    var crest = new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    }));
    group.add(crest);

    this._posAttr = geo.attributes.position;
    this._colAttr = geo.attributes.color;
    this._crestPosAttr = cgeo.attributes.position;
    this._crestColAttr = cgeo.attributes.color;
    this._nH = nH;

    // Ring buffer of graph samples (0..1), plus the per-row heights we last
    // pushed into the vertex buffer.
    this._ring = new Float32Array(RING_SIZE);
    this._rowH = new Float32Array(WALL_ROWS);
    this._prevRowH = new Float32Array(WALL_ROWS);
    this._prevRowH.fill(-1);

    // Float write-head in sample units; grows with distance travelled.
    this._idx = 0;
    this._written = 0;
    this._cur = 0;

    return group;
  }

  // Lay the current value down at every sample point crossed since the last
  // frame, and keep the head slot live so the horizon row responds instantly.
  function advanceGraph() {
    var to = Math.floor(this._idx);
    if (to > this._written) {
      for (var k = this._written + 1; k <= to; k++) this._ring[wrap(k)] = this._cur;
      this._written = to;
    }
    this._ring[wrap(to)] = this._cur;
  }

  // Pull the integer-indexed profile for every row. Row 0 (nearest) holds the
  // oldest visible sample; row WALL_ROWS-1 (horizon) holds the newest, so the
  // profile travels toward the player as the write-head advances.
  function readProfile() {
    var n = Math.floor(this._idx);
    var rowH = this._rowH;
    var changed = false;
    for (var j = 0; j < WALL_ROWS; j++) {
      var v = this._ring[wrap(n - (WALL_ROWS - 1 - j))];
      rowH[j] = v;
      if (!changed && Math.abs(v - this._prevRowH[j]) > REDRAW_EPS) changed = true;
    }
    return changed;
  }

  function updateWalls() {
    var xs = this._xs;
    var envs = this._envs;
    var rowH = this._rowH;
    var pos = this._posAttr.array;
    var col = this._colAttr.array;
    var cpos = this._crestPosAttr.array;
    var ccol = this._crestColAttr.array;
    var cols = xs.length;
    var i, j, p, li;

    // Horizontal rungs.
    p = 1; // start at the first y component
    for (j = 0; j < WALL_ROWS; j++) {
      var hs = rowH[j] * WALL_MAXH;
      for (i = 0; i < cols - 1; i++) {
        var ha = envs[i] * hs;
        var hb = envs[i + 1] * hs;
        pos[p] = ha; p += 3;
        pos[p] = hb; p += 3;
      }
    }
    // Vertical stringers.
    for (i = 0; i < cols; i++) {
      var e = envs[i];
      for (j = 0; j < WALL_ROWS - 1; j++) {
        pos[p] = e * rowH[j] * WALL_MAXH;     p += 3;
        pos[p] = e * rowH[j + 1] * WALL_MAXH; p += 3;
      }
    }

    // Colours, same vertex order.
    p = 0;
    for (j = 0; j < WALL_ROWS; j++) {
      var hr = rowH[j];
      for (i = 0; i < cols - 1; i++) {
        li = lutIndex(envs[i] * hr);
        col[p] = COLOR_LUT[li]; col[p + 1] = COLOR_LUT[li + 1]; col[p + 2] = COLOR_LUT[li + 2]; p += 3;
        li = lutIndex(envs[i + 1] * hr);
        col[p] = COLOR_LUT[li]; col[p + 1] = COLOR_LUT[li + 1]; col[p + 2] = COLOR_LUT[li + 2]; p += 3;
      }
    }
    for (i = 0; i < cols; i++) {
      var ec = envs[i];
      for (j = 0; j < WALL_ROWS - 1; j++) {
        li = lutIndex(ec * rowH[j]);
        col[p] = COLOR_LUT[li]; col[p + 1] = COLOR_LUT[li + 1]; col[p + 2] = COLOR_LUT[li + 2]; p += 3;
        li = lutIndex(ec * rowH[j + 1]);
        col[p] = COLOR_LUT[li]; col[p + 1] = COLOR_LUT[li + 1]; col[p + 2] = COLOR_LUT[li + 2]; p += 3;
      }
    }

    // Crest polylines: full-height ridge, so they trace the raw power curve.
    var cp = 1, cc = 0;
    var passes = 2 * this._crestOffsets.length;
    for (var side = 0; side < passes; side++) {
      for (j = 0; j < WALL_ROWS - 1; j++) {
        cpos[cp] = rowH[j] * WALL_MAXH;     cp += 3;
        cpos[cp] = rowH[j + 1] * WALL_MAXH; cp += 3;
        li = lutIndex(rowH[j]);
        ccol[cc] = COLOR_LUT[li]; ccol[cc + 1] = COLOR_LUT[li + 1]; ccol[cc + 2] = COLOR_LUT[li + 2]; cc += 3;
        li = lutIndex(rowH[j + 1]);
        ccol[cc] = COLOR_LUT[li]; ccol[cc + 1] = COLOR_LUT[li + 1]; ccol[cc + 2] = COLOR_LUT[li + 2]; cc += 3;
      }
    }

    this._posAttr.needsUpdate = true;
    this._colAttr.needsUpdate = true;
    this._crestPosAttr.needsUpdate = true;
    this._crestColAttr.needsUpdate = true;
    this._prevRowH.set(this._rowH);
  }

  function buildSun() {
    var group = new THREE.Group();

    var glow = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS * 2.6, 32),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(), transparent: true, depthWrite: false,
        depthTest: false, blending: THREE.AdditiveBlending, fog: false
      })
    );
    glow.renderOrder = -2;
    glow.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z + 0.5);
    group.add(glow);

    var disc = new THREE.Mesh(
      new THREE.CircleGeometry(SUN_RADIUS, 48),
      new THREE.MeshBasicMaterial({
        map: makeSunTexture(), transparent: true, depthWrite: false,
        depthTest: false, fog: false
      })
    );
    disc.renderOrder = -1;
    disc.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
    group.add(disc);

    group.userData.glow = glow;
    group.userData.disc = disc;
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
      this._heartRate = 80;
      this._targetHeartRate = 80;

      this._speed = this.data.speed;
      this._targetSpeed = this.data.speed;
      // Normalized 0..1 value plotted as mountain height. Starts flat and
      // rises as power arrives.
      this._cur = 0;
      this._targetValue = 0;

      this.grid = buildGrid();
      this.el.object3D.add(this.grid);

      this.walls = buildWalls.call(this);
      this.el.object3D.add(this.walls);

      this.sun = buildSun();
      this.el.object3D.add(this.sun);

      this.stars = buildStars();
      this.el.object3D.add(this.stars);

      readProfile.call(this);
      updateWalls.call(this);
    },

    setFitnessData: function (fd) {
      if (fd.value !== undefined && fd.value !== null) this._targetValue = clamp01(fd.value);
      if (fd.heartRate !== undefined && fd.heartRate !== null) this._targetHeartRate = fd.heartRate;
      if (fd.speed !== undefined && fd.speed !== null) this._targetSpeed = fd.speed;
    },

    tick: function (t, dt) {
      dt = dt !== undefined && dt > 0 ? Math.min(dt / 1000, 0.1) : 0.016;
      this._t += dt;

      // Ease scroll speed and plotted value toward their targets so both the
      // forward motion and the terrain glide between transmitted samples.
      this._speed += (this._targetSpeed - this._speed) * SPEED_SMOOTH;
      this._cur += (this._targetValue - this._cur) * VALUE_SMOOTH;
      this._heartRate += (this._targetHeartRate - this._heartRate) * 0.05;

      // km/h -> m/s for the world scroll.
      var mps = Math.max(0, this._speed) * WORLD_SPEED_SCALE / 3.6;

      this._offset += mps * dt;
      this.grid.position.z = this._offset % STEP;

      // Advance the graph write-head by the distance covered, laying the
      // current value down as a new sample at the horizon.
      this._idx += mps * dt / SAMPLE_SPACING;
      advanceGraph.call(this);

      // Slide the canyon toward the player by the sub-sample fraction; the
      // integer part is handled by every row inheriting its far neighbour.
      var frac = this._idx - Math.floor(this._idx);
      this.walls.position.z = frac * WALL_STEP_Z;

      if (readProfile.call(this)) updateWalls.call(this);

      var hr = this._heartRate;
      var freq = 0.6 + (hr / 200) * 1.6;
      var base = 0.7 + (hr / 300) * 0.2;
      var amp = 0.15 + (hr / 250) * 0.1;
      var glow = this.sun.userData.glow;
      if (glow) glow.material.opacity = Math.min(1, base + amp * Math.sin(this._t * freq * Math.PI));
    }
  });
})();
