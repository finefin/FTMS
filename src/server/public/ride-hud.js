(function () {
  // =====================================================================
  // ride-hud.js
  // In-scene (stereo) HUD for immersive VR only.
  //
  // In windowed mode the DOM HUD in ride.html is the interface and this
  // entity stays hidden — showing both would double up. It is switched on
  // only once a real WebXR session exists (A-Frame also emits `enter-vr`
  // for desktop fullscreen, which is *not* immersive, so the session is
  // what we test).
  //
  // The design is the same as the DOM HUD — radial power gauge, speed and
  // heart pods, power-curve sparkline, neon corner brackets — drawn to a
  // 2D canvas and mapped onto a panel curved around the viewer. Canvas is
  // used rather than a-text/geometry because it reproduces the gauge arcs,
  // gradients and glow exactly, in one draw call.
  // =====================================================================

  // --- Panel placement (metres) ---
  // The panel is anchored to the HEAD, not to the rig. A-Frame requires the
  // 'local-floor' reference space, so the origin is the floor at the centre of
  // the play space and the viewer starts wherever they are physically standing,
  // facing wherever they are physically facing. A panel pinned to a fixed rig
  // position is therefore only in front of you if you happen to be stood on the
  // origin looking down -Z; otherwise it sits off to one side or behind you.
  var PANEL_RADIUS = 2.0;    // distance from the viewer
  var PANEL_ARC = 0.70;      // radians of wrap (~40 deg)
  var PANEL_HEIGHT = 0.63;
  var PANEL_DROP = 0.24;     // how far below eye level the panel centre sits
  var PANEL_SEGMENTS = 24;

  // Lazy follow: the panel holds still while you glance around and only
  // catches up once you turn past the dead zone, so it is always findable
  // without being welded to your face.
  var FOLLOW_DEADZONE = 0.30;  // rad (~17 deg) before the panel starts turning
  var FOLLOW_SETTLE = 0.02;    // rad at which it stops again
  var YAW_FOLLOW = 3.5;
  var POS_FOLLOW = 4.0;

  // --- Canvas ---
  // Arc length is ~1.54 m at ~39 deg; a headset resolves roughly 20 px/deg,
  // so ~800 px would suffice. 1280 leaves headroom for close inspection.
  var CW = 1280;
  var CH = 534;

  // Repaint cap. The readouts and heartbeat do not need headset framerate,
  // and each repaint re-uploads a ~2.7 MB texture.
  var REPAINT_MS = 66;       // ~15 Hz

  var CYAN = '#00f6ff';
  var MAGENTA = '#ff2bd6';
  var AMBER = '#ffd166';
  var HEART_RED = '#ff5d7e';

  var NUM_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  var UI_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

  // ---------------------------------------------------------------------
  // Canvas helpers
  // ---------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function setTracking(ctx, px) {
    // letterSpacing is Chromium-only; the uppercase micro-labels simply sit
    // tighter without it rather than breaking.
    if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
  }

  function glow(ctx, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function noGlow(ctx) {
    ctx.shadowBlur = 0;
  }

  function clamp01(v) {
    if (v == null || isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function fmtTime(sec) {
    if (sec == null || isNaN(sec)) return '--:--';
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (m < 10 && h > 0 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function fmtDistance(m) {
    if (m == null || isNaN(m)) return '--';
    return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  }

  // Heart outline, drawn centred on (cx, cy) at the given size.
  function heartPath(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.72);
    ctx.bezierCurveTo(cx - s * 1.35, cy - s * 0.20, cx - s * 0.62, cy - s * 1.05, cx, cy - s * 0.38);
    ctx.bezierCurveTo(cx + s * 0.62, cy - s * 1.05, cx + s * 1.35, cy - s * 0.20, cx, cy + s * 0.72);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------
  // Panel chrome
  // ---------------------------------------------------------------------
  function drawShell(ctx) {
    ctx.clearRect(0, 0, CW, CH);

    var bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, 'rgba(12, 6, 30, 0.80)');
    bg.addColorStop(1, 'rgba(6, 3, 16, 0.88)');
    roundRect(ctx, 6, 6, CW - 12, CH - 12, 18);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Scanlines.
    ctx.fillStyle = 'rgba(255,255,255,0.022)';
    for (var y = 8; y < CH - 8; y += 3) ctx.fillRect(8, y, CW - 16, 1);

    // Corner brackets.
    var L = 46, o = 14;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    glow(ctx, CYAN, 12);
    var corners = [[o, o, 1, 1], [CW - o, o, -1, 1], [o, CH - o, 1, -1], [CW - o, CH - o, -1, -1]];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * L, c[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0], c[1] + c[3] * L);
      ctx.stroke();
    }
    noGlow(ctx);
    ctx.globalAlpha = 1;
  }

  function drawStatusRow(ctx, rs) {
    var y = 52;

    // Connection lamp.
    var lampColor = rs.demo ? MAGENTA
      : rs.connection === 'connected' ? '#38ffa8'
      : rs.connection === 'error' ? '#ff4d6d'
      : AMBER;
    ctx.beginPath();
    ctx.arc(84, y - 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = lampColor;
    glow(ctx, lampColor, 14);
    ctx.fill();
    noGlow(ctx);

    setTracking(ctx, 3);
    ctx.font = '600 20px ' + UI_FONT;
    ctx.fillStyle = '#dfe9ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var name = rs.demo ? 'DEMO SIGNAL' : (rs.device || 'NO DEVICE');
    ctx.fillText(name.toUpperCase(), 106, y);

    if (rs.equipmentLabel) {
      var w = ctx.measureText(name.toUpperCase()).width;
      ctx.font = '600 17px ' + UI_FONT;
      ctx.fillStyle = 'rgba(255,54,200,0.95)';
      ctx.fillText(rs.equipmentLabel.toUpperCase(), 106 + w + 26, y);
    }

    // Trip stats, right aligned.
    ctx.textAlign = 'right';
    ctx.font = '500 19px ' + UI_FONT;
    ctx.fillStyle = 'rgba(200,215,245,0.55)';
    ctx.fillText(
      fmtDistance(rs.distance) + '   ·   ' + fmtTime(rs.elapsed) +
      '   ·   ' + (rs.energy == null ? '--' : Math.round(rs.energy) + ' kcal'),
      CW - 84, y
    );
    setTracking(ctx, 0);
  }

  function drawHeartGlyph(ctx, x, y, bpm, phase) {
    if (bpm == null || bpm < 20) return;
    // Two-stage beat, matching the CSS keyframes on the DOM HUD.
    var b = phase < 0.12 ? phase / 0.12 * 0.42
      : phase < 0.26 ? 0.42 - (phase - 0.12) / 0.14 * 0.37
      : phase < 0.38 ? 0.05 + (phase - 0.26) / 0.12 * 0.17
      : phase < 0.60 ? 0.22 - (phase - 0.38) / 0.22 * 0.22
      : 0;
    var s = 13 * (1 + b);
    heartPath(ctx, x, y, s);
    ctx.fillStyle = HEART_RED;
    glow(ctx, HEART_RED, 16);
    ctx.fill();
    noGlow(ctx);
  }

  // A labelled readout with a meter, mirrored for the right-hand pod.
  function drawPod(ctx, o) {
    var x = o.x;
    ctx.textAlign = o.align;

    setTracking(ctx, 5);
    ctx.font = '600 20px ' + UI_FONT;
    ctx.fillStyle = o.accentDim;
    ctx.fillText(o.label, x, 148);
    setTracking(ctx, 0);

    // Value and unit are laid out as one group so the unit always trails the
    // number ("103 bpm"), with the whole group aligned to the pod's edge.
    ctx.font = '600 74px ' + NUM_FONT;
    var vw = ctx.measureText(o.value).width;
    ctx.font = '500 24px ' + UI_FONT;
    var uw = ctx.measureText(o.unit).width;
    var gap = 12;
    var groupLeft = o.align === 'left' ? x : x - (vw + gap + uw);

    ctx.textAlign = 'left';
    ctx.font = '600 74px ' + NUM_FONT;
    ctx.fillStyle = '#ffffff';
    glow(ctx, o.accent, 22);
    ctx.fillText(o.value, groupLeft, 222);
    noGlow(ctx);

    ctx.font = '500 24px ' + UI_FONT;
    ctx.fillStyle = o.accentDim;
    ctx.fillText(o.unit, groupLeft + vw + gap, 222);

    // Meter.
    var bw = 250, bh = 6;
    var bx = o.align === 'left' ? x : x - bw;
    ctx.fillStyle = 'rgba(255,255,255,0.11)';
    ctx.fillRect(bx, 248, bw, bh);
    var fw = bw * clamp01(o.pct);
    if (fw > 0.5) {
      var g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, o.accent);
      g.addColorStop(1, o.accentBright);
      ctx.fillStyle = g;
      glow(ctx, o.accent, 12);
      ctx.fillRect(o.align === 'left' ? bx : bx + bw - fw, 248, fw, bh);
      noGlow(ctx);
    }

    // Sub-line, with the beating heart glyph tucked in beside it when this
    // pod is the heart-rate one.
    ctx.textAlign = o.align;
    setTracking(ctx, 3);
    ctx.font = '500 21px ' + UI_FONT;
    ctx.fillStyle = 'rgba(210,225,255,0.55)';
    ctx.fillText(o.sub, x, 294);
    var subW = ctx.measureText(o.sub).width;
    setTracking(ctx, 0);

    if (o.heartBpm != null) {
      var hx = o.align === 'left' ? x + subW + 24 : x - subW - 24;
      drawHeartGlyph(ctx, hx, 287, o.heartBpm, o.heartPhase);
    }
  }

  function drawGauge(ctx, pct, power, hot, punch) {
    var cx = CW / 2, cy = 208, r = 118;
    var START = Math.PI * 0.75;      // 135 deg
    var SWEEP = Math.PI * 1.5;       // 270 deg

    // Track.
    ctx.beginPath();
    ctx.arc(cx, cy, r, START, START + SWEEP);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Tick ring.
    ctx.strokeStyle = 'rgba(155,232,255,0.30)';
    ctx.lineWidth = 2;
    for (var i = 0; i <= 30; i++) {
      var a = START + (SWEEP * i) / 30;
      var r0 = r + 11, r1 = r + (i % 5 === 0 ? 20 : 16);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }

    // Value arc.
    if (pct > 0.001) {
      var g = ctx.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
      g.addColorStop(0, CYAN);
      g.addColorStop(0.55, MAGENTA);
      g.addColorStop(1, '#fff0ff');
      ctx.beginPath();
      ctx.arc(cx, cy, r, START, START + SWEEP * clamp01(pct));
      ctx.strokeStyle = g;
      ctx.lineWidth = 13;
      ctx.lineCap = 'round';
      glow(ctx, hot ? '#fff0ff' : MAGENTA, hot ? 34 : 22);
      ctx.stroke();
      noGlow(ctx);
    }

    // Centre readout, briefly scaled up on a surge.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 + punch, 1 + punch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 86px ' + NUM_FONT;
    ctx.fillStyle = hot ? '#fff0ff' : '#ffffff';
    glow(ctx, MAGENTA, hot ? 40 : 26);
    ctx.fillText(String(power), 0, 4);
    noGlow(ctx);
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 24px ' + UI_FONT;
    ctx.fillStyle = 'rgba(255,154,233,0.92)';
    ctx.fillText('W', cx + 96, cy + 16);

    ctx.textAlign = 'center';
    setTracking(ctx, 6);
    ctx.font = '600 20px ' + UI_FONT;
    ctx.fillStyle = 'rgba(255,154,233,0.9)';
    ctx.fillText('POWER', cx, cy + 88);
    setTracking(ctx, 0);
  }

  // The same trace the terrain is built from.
  function drawSpark(ctx, rs) {
    var x0 = 84, x1 = CW - 84, yTop = 348, yBot = 462;
    var w = x1 - x0, h = yBot - yTop;
    var pmax = rs.powerMax || 400;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var gy = yTop + (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
    }

    var spark = rs.spark, filled = rs.sparkFilled || 0, len = rs.sparkLen || 0;
    if (spark && filled >= 2) {
      var start = len - filled;
      function px(i) { return x0 + (i / (len - 1)) * w; }
      function py(v) { return yBot - clamp01(v / pmax) * h; }

      ctx.beginPath();
      ctx.moveTo(px(start), py(spark[0]));
      for (i = 1; i < filled; i++) ctx.lineTo(px(start + i), py(spark[i]));
      ctx.lineTo(px(start + filled - 1), yBot);
      ctx.lineTo(px(start), yBot);
      ctx.closePath();
      var fill = ctx.createLinearGradient(0, yTop, 0, yBot);
      fill.addColorStop(0, 'rgba(255,43,214,0.32)');
      fill.addColorStop(1, 'rgba(255,43,214,0)');
      ctx.fillStyle = fill;
      ctx.fill();

      var stroke = ctx.createLinearGradient(x0, 0, x1, 0);
      stroke.addColorStop(0, 'rgba(0,246,255,0.35)');
      stroke.addColorStop(0.7, 'rgba(255,43,214,0.95)');
      stroke.addColorStop(1, 'rgba(255,240,255,1)');
      ctx.beginPath();
      ctx.moveTo(px(start), py(spark[0]));
      for (i = 1; i < filled; i++) ctx.lineTo(px(start + i), py(spark[i]));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      glow(ctx, 'rgba(255,43,214,0.8)', 12);
      ctx.stroke();
      noGlow(ctx);

      var lx = px(start + filled - 1), ly = py(spark[filled - 1]);
      ctx.beginPath();
      ctx.arc(lx, ly, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff0ff';
      glow(ctx, '#fff0ff', 16);
      ctx.fill();
      noGlow(ctx);
    }

    ctx.strokeStyle = 'rgba(255,43,214,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, yBot + 12); ctx.lineTo(x1, yBot + 12); ctx.stroke();

    setTracking(ctx, 5);
    ctx.font = '600 18px ' + UI_FONT;
    ctx.textAlign = 'left';
    ctx.fillStyle = MAGENTA;
    ctx.fillText('POWER CURVE', x0, yBot + 40);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(220,200,255,0.42)';
    ctx.fillText('TERRAIN PROFILE · LAST 2 MIN', x1, yBot + 40);
    setTracking(ctx, 0);
  }

  // ---------------------------------------------------------------------
  // Curved panel geometry
  // ---------------------------------------------------------------------
  // Built by hand rather than with CylinderGeometry so the UVs run
  // left-to-right as the viewer sees them — a cylinder viewed from the
  // inside mirrors its texture. DoubleSide sidesteps winding entirely.
  function makeCurvedPanel(radius, arc, height, segs) {
    var pos = [], uv = [], idx = [];
    for (var i = 0; i <= segs; i++) {
      var u = i / segs;
      var a = -arc / 2 + u * arc;
      var x = radius * Math.sin(a);
      var z = -radius * Math.cos(a);
      pos.push(x, height / 2, z); uv.push(u, 1);
      pos.push(x, -height / 2, z); uv.push(u, 0);
    }
    for (i = 0; i < segs; i++) {
      var a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }

  AFRAME.registerComponent('ride-hud', {
    schema: {
      // Show without a WebXR session. Only for inspecting the layout.
      forceVisible: { type: 'boolean', default: false }
    },

    init: function () {
      var self = this;

      this._canvas = document.createElement('canvas');
      this._canvas.width = CW;
      this._canvas.height = CH;
      this._ctx = this._canvas.getContext('2d');

      this._tex = new THREE.CanvasTexture(this._canvas);
      this._tex.colorSpace = THREE.SRGBColorSpace || this._tex.colorSpace;
      this._tex.anisotropy = 4;
      this._tex.generateMipmaps = false;
      this._tex.minFilter = THREE.LinearFilter;

      this._mesh = new THREE.Mesh(
        makeCurvedPanel(PANEL_RADIUS, PANEL_ARC, PANEL_HEIGHT, PANEL_SEGMENTS),
        new THREE.MeshBasicMaterial({
          map: this._tex, transparent: true, side: THREE.DoubleSide,
          depthWrite: false, fog: false
        })
      );
      this._mesh.position.y = -PANEL_DROP;
      this._mesh.renderOrder = 10;
      this.el.object3D.add(this._mesh);

      this._last = 0;
      this._beat = 0;
      this._yaw = 0;
      this._following = false;
      this._snap = true;
      this._v = new THREE.Vector3();
      this._q = new THREE.Quaternion();
      this._e = new THREE.Euler();
      this._punch = 0;
      this._prevPower = null;
      this._shown = { power: 0, speed: 0, hr: 0, gauge: 0 };

      this.paint(0);
      this.setVisible(this.data.forceVisible);

      var scene = this.el.sceneEl;
      this._onEnter = function () {
        self._snap = true;   // drop the panel straight in front on entry
        self.setVisible(self.isImmersive());
      };
      this._onExit = function () { self.setVisible(self.data.forceVisible); };
      scene.addEventListener('enter-vr', this._onEnter);
      scene.addEventListener('exit-vr', this._onExit);
      scene.addEventListener('enter-ar', this._onEnter);
      scene.addEventListener('exit-ar', this._onExit);
    },

    remove: function () {
      var scene = this.el.sceneEl;
      scene.removeEventListener('enter-vr', this._onEnter);
      scene.removeEventListener('exit-vr', this._onExit);
      scene.removeEventListener('enter-ar', this._onEnter);
      scene.removeEventListener('exit-ar', this._onExit);
      if (this._tex) this._tex.dispose();
    },

    // A-Frame reports `vr-mode` for plain desktop fullscreen too, so the
    // presence of an XR session is the only reliable "really in a headset".
    isImmersive: function () {
      var scene = this.el.sceneEl;
      if (!scene) return false;
      if (scene.xrSession) return true;
      var r = scene.renderer;
      return !!(r && r.xr && r.xr.isPresenting);
    },

    setVisible: function (v) {
      if (v && !this._visible) this._snap = true;
      this._visible = !!v;
      this.el.object3D.visible = !!v;
    },

    // Keep the panel in front of the viewer's head. Yaw only — following
    // pitch too would pin it to the face and make it impossible to look past.
    follow: function (dt) {
      var scene = this.el.sceneEl;
      var cam = scene && scene.camera;
      var obj = this.el.object3D;
      if (!cam || !obj.parent) return;

      cam.getWorldPosition(this._v);
      obj.parent.worldToLocal(this._v);
      if (this._snap) obj.position.copy(this._v);
      else obj.position.lerp(this._v, Math.min(1, dt * POS_FOLLOW));

      cam.getWorldQuaternion(this._q);
      this._e.setFromQuaternion(this._q, 'YXZ');
      var camYaw = this._e.y;

      if (this._snap) {
        this._yaw = camYaw;
        this._following = false;
        this._snap = false;
      } else {
        var d = camYaw - this._yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > FOLLOW_DEADZONE) this._following = true;
        if (this._following) {
          this._yaw += d * Math.min(1, dt * YAW_FOLLOW);
          if (Math.abs(d) < FOLLOW_SETTLE) this._following = false;
        }
      }
      // The rig carries no transform of its own, so local yaw is world yaw.
      obj.rotation.set(0, this._yaw, 0);
    },

    paint: function (dtSec) {
      var ctx = this._ctx;
      var rs = window.RideState || {};
      var sh = this._shown;

      // Ease the readouts exactly like the DOM HUD does.
      var k = Math.min(1, dtSec * 11);
      var pmax = rs.powerMax || 400;
      sh.power += ((rs.power || 0) - sh.power) * k;
      sh.speed += ((rs.speed || 0) - sh.speed) * k;
      sh.gauge += (clamp01((rs.power || 0) / pmax) - sh.gauge) * k;
      if (rs.heartRate != null) sh.hr += (rs.heartRate - sh.hr) * k;

      var power = Math.round(sh.power);
      if (this._prevPower != null) {
        var jump = Math.abs(power - this._prevPower) / 120;
        if (jump > 0.02) this._punch = Math.min(0.14, this._punch + jump * 0.12);
      }
      this._prevPower = power;
      this._punch *= 0.88;

      var hot = sh.gauge > 0.8;

      drawShell(ctx);
      drawStatusRow(ctx, rs);

      drawPod(ctx, {
        x: 84, align: 'left', label: 'SPEED',
        value: sh.speed.toFixed(1), unit: 'km/h',
        accent: CYAN, accentBright: '#9be8ff', accentDim: 'rgba(155,232,255,0.88)',
        pct: sh.speed / (rs.speedMax || 60),
        sub: (rs.cadence == null ? '--' : Math.round(rs.cadence)) + ' RPM'
      });

      drawGauge(ctx, sh.gauge, power, hot, this._punch);

      drawPod(ctx, {
        x: CW - 84, align: 'right', label: 'HEART',
        value: rs.heartRate == null ? '--' : String(Math.round(sh.hr)), unit: 'bpm',
        accent: AMBER, accentBright: '#ff6b8b', accentDim: 'rgba(255,209,102,0.88)',
        pct: (rs.heartRate || 0) / (rs.hrMax || 200),
        sub: 'LIVE',
        heartBpm: rs.heartRate,
        heartPhase: this._beat
      });

      drawSpark(ctx, rs);

      this._tex.needsUpdate = true;
    },

    tick: function (time, timeDelta) {
      // Re-sync from the live session state rather than trusting the
      // enter-vr/exit-vr events alone: if the event ever fires before the
      // session is registered, a one-shot check would leave the HUD hidden
      // for the whole session with no way to recover.
      var should = this.data.forceVisible || this.isImmersive();
      if (should !== this._visible) this.setVisible(should);
      if (!this._visible) return;

      var dt = (timeDelta || 16) / 1000;
      this.follow(dt);

      // Advance the heartbeat phase at the real BPM even between repaints.
      var rs = window.RideState || {};
      var bpm = rs.heartRate;
      if (bpm && bpm > 20) {
        this._beat = (this._beat + dt / (60 / bpm)) % 1;
      }

      this._last += timeDelta || 16;
      if (this._last < REPAINT_MS) return;
      this.paint(this._last / 1000);
      this._last = 0;
    }
  });
})();
