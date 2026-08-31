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
  // The canyon is built as two separate walls starting at the corridor edge.
  // Nothing is drawn across the corridor itself: geometry lying flat on the
  // ground and running along the travel axis is invisible when it scrolls (a
  // line parallel to z, translated along z, projects to the same screen line),
  // so it read as a permanently static cyan grid. The magenta ground grid is
  // now the only floor, and it scrolls visibly because its rungs cross the
  // travel axis.
  var WALL_FLAT_HALF = 13;   // half-width of the riding corridor = wall footing
  var WALL_X_HALF = 57;      // outer edge of each wall
  var WALL_STEP_X = 4;       // 9 columns per side
  var WALL_STEP_Z = 4;       // one graph sample per 4 m of track
  var WALL_ROWS = 60;        // 240 m of visible history
  var WALL_Z_NEAR = 12;      // nearest row sits behind the camera so peaks sweep past
  var WALL_RIDGE_X = 37;     // where the wall reaches full height (the readable crest line)
  var WALL_MAXH = 68;        // height of a 100%-power sample
  var WALL_BACK_DROP = 0.45; // how far the far side of the ridge falls away

  // Every Nth sample row is drawn as a bright marker rung. The markers are
  // keyed to the *absolute* sample index, so they travel one row toward the
  // player per sample and sweep past — which is what actually sells riding
  // along the curve. Without them a constant power output produces a uniform
  // canyon, and rigidly translating a uniform canyon looks completely still.
  var MARK_EVERY = 6;        // a marker every 24 m
  var MARK_BOOST = 2.3;
  var MARK_WHITEN = 0.5;

  // Metres of track per graph sample. Must equal the row spacing: the
  // treadmill scroll below relies on one sample occupying exactly one row.
  var SAMPLE_SPACING = WALL_STEP_Z;

  // Reported km/h is scaled before driving the world, purely so the ride
  // feels fast at realistic speeds. It scales the sample rate identically
  // (both derive from the same metres/second), so at 25 km/h a sample lands
  // every ~0.36 s and the canyon shows ~26 s of power history.
  var WORLD_SPEED_SCALE = 1.6;

  // Terrain contrast. Power that hovers inside a narrow band would otherwise
  // plot as a near-flat plateau, so the normalized value is pushed through a
  // symmetric S-curve: anything below mid-range sinks toward the valley floor,
  // anything above it climbs toward the peak. The curve is monotonic and
  // preserves both endpoints, so 0 W is still flat ground and full power still
  // reaches exactly WALL_MAXH — it only exaggerates the swing in between.
  // 1 = linear (no shaping); higher = more dramatic.
  var TERRAIN_CONTRAST = 2.1;

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

  function contrast(v) {
    if (TERRAIN_CONTRAST === 1) return v;
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v < 0.5
      ? 0.5 * Math.pow(2 * v, TERRAIN_CONTRAST)
      : 1 - 0.5 * Math.pow(2 * (1 - v), TERRAIN_CONTRAST);
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
    // Columns run from the corridor edge outward; the mirror side reuses them
    // with a negated x. Nothing is built across the corridor.
    var xs = [];
    for (var x = WALL_FLAT_HALF; x <= WALL_X_HALF; x += WALL_STEP_X) xs.push(x);
    var NC = xs.length;
    this._xs = xs;

    // Cross-section: the footing sits on the ground, rises to a peak at the
    // ridge, then falls away on a shallower back slope. Holding full height
    // past the ridge instead made each wall read as a flat-topped mesa; the
    // peak is what gives it a mountain silhouette, and it is where the crest
    // line traces the power curve.
    var envs = new Float32Array(NC);
    var ridgeIdx = 0;
    for (var i = 0; i < NC; i++) {
      var xv = xs[i];
      if (xv <= WALL_RIDGE_X) {
        envs[i] = smoothstep((xv - WALL_FLAT_HALF) / (WALL_RIDGE_X - WALL_FLAT_HALF));
      } else {
        envs[i] = 1 - WALL_BACK_DROP * smoothstep((xv - WALL_RIDGE_X) / (WALL_X_HALF - WALL_RIDGE_X));
      }
      if (xv === WALL_RIDGE_X) ridgeIdx = i;
    }
    this._envs = envs;
    this._ridgeIdx = ridgeIdx;

    var group = new THREE.Group();
    var side, j, p;

    // --- Wireframe: rungs (across the travel axis) + stringers (along it) ---
    var nRung = 2 * WALL_ROWS * (NC - 1) * 2;
    var nStr  = 2 * NC * (WALL_ROWS - 1) * 2;
    var total = nRung + nStr;

    var pos = new Float32Array(total * 3);
    var col = new Float32Array(total * 3);
    p = 0;
    for (side = 0; side < 2; side++) {
      var sgn = side === 0 ? -1 : 1;
      for (j = 0; j < WALL_ROWS; j++) {
        var zr = rowZ(j);
        for (i = 0; i < NC - 1; i++) {
          pos[p] = sgn * xs[i];     pos[p + 2] = zr; p += 3;
          pos[p] = sgn * xs[i + 1]; pos[p + 2] = zr; p += 3;
        }
      }
    }
    for (side = 0; side < 2; side++) {
      var sgn2 = side === 0 ? -1 : 1;
      for (i = 0; i < NC; i++) {
        for (j = 0; j < WALL_ROWS - 1; j++) {
          pos[p] = sgn2 * xs[i]; pos[p + 2] = rowZ(j);     p += 3;
          pos[p] = sgn2 * xs[i]; pos[p + 2] = rowZ(j + 1); p += 3;
        }
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    })));

    // --- Crest lines: the ridge polylines that read as the power curve ---
    // GL ignores LineBasicMaterial.linewidth, so each ridge is drawn as three
    // closely-spaced parallel lines; additively blended they give the crest
    // real visual weight against the busy grid behind it.
    var CREST_OFFSETS = [-0.45, 0, 0.45];
    var crestCount = 2 * CREST_OFFSETS.length * (WALL_ROWS - 1) * 2;
    var cpos = new Float32Array(crestCount * 3);
    p = 0;
    for (side = 0; side < 2; side++) {
      var sgn3 = side === 0 ? -1 : 1;
      for (var oi = 0; oi < CREST_OFFSETS.length; oi++) {
        var xo = sgn3 * WALL_RIDGE_X + CREST_OFFSETS[oi];
        for (j = 0; j < WALL_ROWS - 1; j++) {
          cpos[p] = xo; cpos[p + 2] = rowZ(j);     p += 3;
          cpos[p] = xo; cpos[p + 2] = rowZ(j + 1); p += 3;
        }
      }
    }
    var cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    cgeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(crestCount * 3), 3));
    group.add(new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    })));

    this._NC = NC;
    this._crestPasses = 2 * CREST_OFFSETS.length;
    this._posAttr = geo.attributes.position;
    this._colAttr = geo.attributes.color;
    this._crestPosAttr = cgeo.attributes.position;
    this._crestColAttr = cgeo.attributes.color;

    // Ring buffer of graph samples (0..1) plus the per-row heights last
    // pushed into the vertex buffers.
    this._ring = new Float32Array(RING_SIZE);
    this._rowH = new Float32Array(WALL_ROWS);
    this._rowMark = new Uint8Array(WALL_ROWS);
    this._prevRowH = new Float32Array(WALL_ROWS);
    this._prevRowH.fill(-1);
    this._prevN = null;

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
    var mark = this._rowMark;
    var changed = n !== this._prevN;   // marker rungs shift on every new sample
    for (var j = 0; j < WALL_ROWS; j++) {
      var sampleIdx = n - (WALL_ROWS - 1 - j);
      var v = this._ring[wrap(sampleIdx)];
      rowH[j] = v;
      mark[j] = (((sampleIdx % MARK_EVERY) + MARK_EVERY) % MARK_EVERY) === 0 ? 1 : 0;
      if (!changed && Math.abs(v - this._prevRowH[j]) > REDRAW_EPS) changed = true;
    }
    this._prevN = n;
    return changed;
  }

  function updateWalls() {
    var xs = this._xs;
    var envs = this._envs;
    var rowH = this._rowH;
    var mark = this._rowMark;
    var NC = this._NC;
    var pos = this._posAttr.array;
    var col = this._colAttr.array;
    var cpos = this._crestPosAttr.array;
    var ccol = this._crestColAttr.array;
    var side, i, j, li, mul, whiten;

    // --- Positions: only y changes; x and z were written at build time. ---
    var p = 1;
    for (side = 0; side < 2; side++) {
      for (j = 0; j < WALL_ROWS; j++) {
        var hs = rowH[j] * WALL_MAXH;
        for (i = 0; i < NC - 1; i++) {
          pos[p] = envs[i] * hs;     p += 3;
          pos[p] = envs[i + 1] * hs; p += 3;
        }
      }
    }
    for (side = 0; side < 2; side++) {
      for (i = 0; i < NC; i++) {
        var e = envs[i];
        for (j = 0; j < WALL_ROWS - 1; j++) {
          pos[p] = e * rowH[j] * WALL_MAXH;     p += 3;
          pos[p] = e * rowH[j + 1] * WALL_MAXH; p += 3;
        }
      }
    }

    // --- Colours, same vertex order. Marker rungs are brightened and pushed
    // --- toward white so they read as distance markers streaming past.
    function put(arr, at, idx, m, w) {
      arr[at]     = (COLOR_LUT[idx]     * (1 - w) + w) * m;
      arr[at + 1] = (COLOR_LUT[idx + 1] * (1 - w) + w) * m;
      arr[at + 2] = (COLOR_LUT[idx + 2] * (1 - w) + w) * m;
    }

    p = 0;
    for (side = 0; side < 2; side++) {
      for (j = 0; j < WALL_ROWS; j++) {
        var hr = rowH[j];
        mul = mark[j] ? MARK_BOOST : 1;
        whiten = mark[j] ? MARK_WHITEN : 0;
        for (i = 0; i < NC - 1; i++) {
          put(col, p, lutIndex(envs[i] * hr), mul, whiten);     p += 3;
          put(col, p, lutIndex(envs[i + 1] * hr), mul, whiten); p += 3;
        }
      }
    }
    for (side = 0; side < 2; side++) {
      for (i = 0; i < NC; i++) {
        var ec = envs[i];
        for (j = 0; j < WALL_ROWS - 1; j++) {
          put(col, p, lutIndex(ec * rowH[j]), 1, 0);     p += 3;
          put(col, p, lutIndex(ec * rowH[j + 1]), 1, 0); p += 3;
        }
      }
    }

    // --- Crest polylines: full-height ridge, tracing the raw power curve. ---
    var cp = 1, cc = 0;
    for (side = 0; side < this._crestPasses; side++) {
      for (j = 0; j < WALL_ROWS - 1; j++) {
        cpos[cp] = rowH[j] * WALL_MAXH;     cp += 3;
        cpos[cp] = rowH[j + 1] * WALL_MAXH; cp += 3;
        put(ccol, cc, lutIndex(rowH[j]), mark[j] ? MARK_BOOST : 1, mark[j] ? MARK_WHITEN : 0); cc += 3;
        put(ccol, cc, lutIndex(rowH[j + 1]), mark[j + 1] ? MARK_BOOST : 1, mark[j + 1] ? MARK_WHITEN : 0); cc += 3;
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
      if (fd.value !== undefined && fd.value !== null) {
        this._targetValue = contrast(clamp01(fd.value));
      }
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
