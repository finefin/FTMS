(function () {
  // =====================================================================
  // space-hud.js
  // In-scene cockpit panel for immersive VR and desktop fullscreen.
  //
  // Same mechanics as ride-hud.js — head-anchored curved panel, canvas
  // texture, vr-mode gating — but drawing the flight instruments. The panel
  // plumbing is duplicated between the two views rather than shared; see the
  // note in the README.
  // =====================================================================

  var PANEL_RADIUS = 2.0;
  var PANEL_SEGMENTS = 24;
  var ARC_XR = 0.70;
  var ARC_FLAT = 1.05;
  var DROP_XR = 0.24;
  var DROP_FLAT = 0.30;

  var CW = 1280;
  var CH = 534;
  var REPAINT_MS = 66;

  var HUD = '#7fe8ff';
  var HUD_DIM = 'rgba(127,232,255,0.55)';
  var AMBER = '#ffb347';
  var OK = '#55ffa8';
  var WARN = '#ff5d6c';

  var NUM_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  var UI_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

  function clamp01(v) { return v == null || isNaN(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }
  function setTracking(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }
  function glow(ctx, c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
  function noGlow(ctx) { ctx.shadowBlur = 0; }

  function fmtTime(sec) {
    if (sec == null || isNaN(sec) || !isFinite(sec)) return '--:--';
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (m < 10 && h > 0 ? '0' : '') + m;
    var ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function groupKm(km) {
    return km == null || isNaN(km) ? '--' : Math.round(km).toLocaleString('en-US');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawShell(ctx) {
    ctx.clearRect(0, 0, CW, CH);
    var bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, 'rgba(6, 16, 32, 0.82)');
    bg.addColorStop(1, 'rgba(2, 6, 16, 0.90)');
    roundRect(ctx, 6, 6, CW - 12, CH - 12, 14);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(127,232,255,0.22)'; ctx.lineWidth = 2; ctx.stroke();

    var L = 44, o = 14;
    ctx.strokeStyle = HUD; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
    glow(ctx, HUD, 12);
    var corners = [[o, o, 1, 1], [CW - o, o, -1, 1], [o, CH - o, 1, -1], [CW - o, CH - o, -1, -1]];
    for (var i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * L, c[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0], c[1] + c[3] * L);
      ctx.stroke();
    }
    noGlow(ctx); ctx.globalAlpha = 1;
  }

  function drawTop(ctx, fs) {
    var y = 50;
    var lamp = fs.demo ? AMBER
      : fs.connection === 'connected' ? OK
      : fs.connection === 'error' ? WARN : AMBER;
    ctx.beginPath(); ctx.arc(84, y - 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = lamp; glow(ctx, lamp, 14); ctx.fill(); noGlow(ctx);

    setTracking(ctx, 3);
    ctx.font = '600 19px ' + UI_FONT; ctx.fillStyle = '#dcf3ff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText((fs.deviceLabel || 'NO DEVICE').toUpperCase(), 106, y);

    ctx.textAlign = 'center'; ctx.fillStyle = AMBER; ctx.font = '600 18px ' + UI_FONT;
    ctx.fillText('SOL · LEG 01 · EARTH → MOON', CW / 2, y);

    ctx.textAlign = 'right'; ctx.fillStyle = HUD_DIM; ctx.font = '500 18px ' + UI_FONT;
    ctx.fillText(fmtTime(fs.elapsed), CW - 84, y);
    setTracking(ctx, 0);
  }

  function drawReadout(ctx, o) {
    ctx.textAlign = o.align;
    setTracking(ctx, 5);
    ctx.font = '600 19px ' + UI_FONT; ctx.fillStyle = HUD_DIM;
    ctx.fillText(o.label, o.x, 132);
    setTracking(ctx, 0);

    ctx.font = '600 66px ' + NUM_FONT;
    var vw = ctx.measureText(o.value).width;
    ctx.font = '500 22px ' + UI_FONT;
    var uw = ctx.measureText(o.unit).width;
    var left = o.align === 'left' ? o.x : o.x - (vw + 10 + uw);

    ctx.textAlign = 'left';
    ctx.font = '600 66px ' + NUM_FONT; ctx.fillStyle = '#eaf9ff';
    glow(ctx, o.accent, 20); ctx.fillText(o.value, left, 200); noGlow(ctx);
    ctx.font = '500 22px ' + UI_FONT; ctx.fillStyle = HUD_DIM;
    ctx.fillText(o.unit, left + vw + 10, 200);

    var bw = 250, bh = 5;
    var bx = o.align === 'left' ? o.x : o.x - bw;
    ctx.fillStyle = 'rgba(127,232,255,0.16)'; ctx.fillRect(bx, 224, bw, bh);
    var fw = bw * clamp01(o.pct);
    if (fw > 0.5) {
      ctx.fillStyle = o.accent; glow(ctx, o.accent, 10);
      ctx.fillRect(o.align === 'left' ? bx : bx + bw - fw, 224, fw, bh);
      noGlow(ctx);
    }

    ctx.textAlign = o.align;
    ctx.font = '500 19px ' + NUM_FONT; ctx.fillStyle = HUD_DIM;
    ctx.fillText(o.sub, o.x, 262);
  }

  // Centre reticle, so the panel reads as a canopy rather than a dashboard.
  function drawReticle(ctx) {
    var cx = CW / 2, cy = 196, r = 54;
    ctx.strokeStyle = HUD; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
    glow(ctx, HUD, 8);
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) {
      ctx.beginPath();
      ctx.moveTo(cx + d[0] * r, cy + d[1] * r);
      ctx.lineTo(cx + d[0] * (r - 18), cy + d[1] * (r - 18));
      ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = HUD; ctx.fill();
    noGlow(ctx); ctx.globalAlpha = 1;
  }

  function drawNav(ctx, nav) {
    var x0 = 96, x1 = CW - 96, y = 372;
    var w = x1 - x0;

    setTracking(ctx, 5);
    ctx.font = '600 17px ' + UI_FONT; ctx.textAlign = 'left';
    ctx.fillStyle = HUD_DIM; ctx.fillText('NAVIGATION', x0, y - 26);
    ctx.textAlign = 'right';
    ctx.fillStyle = HUD_DIM;
    ctx.fillText((nav ? Math.round(nav.progress * 100) : 0) + '% COMPLETE', x1, y - 26);
    setTracking(ctx, 0);

    ctx.fillStyle = 'rgba(127,232,255,0.20)';
    ctx.fillRect(x0, y, w, 3);
    var p = nav ? nav.progress : 0;
    ctx.fillStyle = HUD; glow(ctx, HUD, 10);
    ctx.fillRect(x0, y, w * p, 3);
    noGlow(ctx);

    function node(x, filled, color) {
      ctx.beginPath(); ctx.arc(x, y + 1.5, 8, 0, Math.PI * 2);
      ctx.fillStyle = filled ? color : 'rgba(2,6,16,1)';
      ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    }
    node(x0, true, HUD);
    node(x1, !!(nav && nav.arrived), AMBER);

    // Ship marker.
    var sx = x0 + w * p;
    ctx.beginPath();
    ctx.moveTo(sx, y - 9); ctx.lineTo(sx - 7, y - 20); ctx.lineTo(sx + 7, y - 20);
    ctx.closePath();
    ctx.fillStyle = '#ffffff'; glow(ctx, HUD, 12); ctx.fill(); noGlow(ctx);

    setTracking(ctx, 4);
    ctx.font = '600 17px ' + UI_FONT;
    ctx.textAlign = 'left'; ctx.fillStyle = HUD; ctx.fillText('EARTH', x0 - 4, y + 40);
    ctx.textAlign = 'right'; ctx.fillStyle = AMBER; ctx.fillText('MOON', x1 + 4, y + 40);
    setTracking(ctx, 0);

    ctx.textAlign = 'center';
    ctx.font = '500 19px ' + NUM_FONT; ctx.fillStyle = HUD_DIM;
    if (nav) {
      ctx.fillText(
        groupKm(nav.remainingKm) + ' km remaining   ·   ETA ' +
        (nav.arrived ? 'ARRIVED' : fmtTime(nav.etaSeconds)),
        CW / 2, y + 40);
    }

    if (nav && nav.arrived) {
      setTracking(ctx, 8);
      ctx.font = '600 22px ' + UI_FONT; ctx.fillStyle = OK;
      glow(ctx, OK, 18);
      ctx.fillText('LUNAR ORBIT ACHIEVED', CW / 2, 300);
      noGlow(ctx); setTracking(ctx, 0);
    }
  }

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

  AFRAME.registerComponent('space-hud', {
    schema: { forceVisible: { type: 'boolean', default: false } },

    init: function () {
      var self = this;
      this._canvas = document.createElement('canvas');
      this._canvas.width = CW; this._canvas.height = CH;
      this._ctx = this._canvas.getContext('2d');

      this._tex = new THREE.CanvasTexture(this._canvas);
      this._tex.colorSpace = THREE.SRGBColorSpace || this._tex.colorSpace;
      this._tex.anisotropy = 4;
      this._tex.generateMipmaps = false;
      this._tex.minFilter = THREE.LinearFilter;

      this._mesh = new THREE.Mesh(
        makeCurvedPanel(PANEL_RADIUS, ARC_XR, PANEL_RADIUS * ARC_XR / (CW / CH), PANEL_SEGMENTS),
        new THREE.MeshBasicMaterial({
          map: this._tex, transparent: true, side: THREE.DoubleSide,
          depthWrite: false, fog: false
        })
      );
      this._mesh.renderOrder = 10;
      this._arc = null;
      this.el.object3D.add(this._mesh);
      this.applyMode();

      this._last = 0; this._beat = 0;
      this._yaw = 0; this._following = false; this._snap = true;
      this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
      this._shown = { kms: 0, power: 0, hr: 0 };

      this.paint(0);
      this.setVisible(this.data.forceVisible);

      var scene = this.el.sceneEl;
      this._onEnter = function () { self._snap = true; self.setVisible(self.isPresenting()); };
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

    isPresenting: function () {
      var scene = this.el.sceneEl;
      if (!scene) return false;
      if (scene.xrSession) return true;
      if (scene.is && (scene.is('vr-mode') || scene.is('ar-mode'))) return true;
      var r = scene.renderer;
      return !!(r && r.xr && r.xr.isPresenting);
    },

    isXR: function () {
      var scene = this.el.sceneEl;
      if (!scene) return false;
      if (scene.xrSession) return true;
      var r = scene.renderer;
      return !!(r && r.xr && r.xr.isPresenting);
    },

    applyMode: function () {
      var arc = this.isXR() ? ARC_XR : ARC_FLAT;
      if (arc === this._arc) return;
      this._arc = arc;
      var old = this._mesh.geometry;
      this._mesh.geometry = makeCurvedPanel(
        PANEL_RADIUS, arc, PANEL_RADIUS * arc / (CW / CH), PANEL_SEGMENTS);
      if (old) old.dispose();
      this._mesh.position.y = -(this.isXR() ? DROP_XR : DROP_FLAT);
    },

    setVisible: function (v) {
      if (v && !this._visible) this._snap = true;
      this._visible = !!v;
      this.el.object3D.visible = !!v;
    },

    follow: function (dt) {
      var scene = this.el.sceneEl;
      var cam = scene && scene.camera;
      var obj = this.el.object3D;
      if (!cam || !obj.parent) return;

      cam.getWorldPosition(this._v);
      obj.parent.worldToLocal(this._v);
      if (this._snap) obj.position.copy(this._v);
      else obj.position.lerp(this._v, Math.min(1, dt * 4));

      cam.getWorldQuaternion(this._q);
      this._e.setFromQuaternion(this._q, 'YXZ');
      var camYaw = this._e.y;

      if (this._snap) {
        this._yaw = camYaw; this._following = false; this._snap = false;
      } else {
        var d = camYaw - this._yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > 0.30) this._following = true;
        if (this._following) {
          this._yaw += d * Math.min(1, dt * 3.5);
          if (Math.abs(d) < 0.02) this._following = false;
        }
      }
      obj.rotation.set(0, this._yaw, 0);
    },

    paint: function (dtSec) {
      var ctx = this._ctx;
      var fs = window.FlightState || {};
      var nav = fs.nav || null;
      var sh = this._shown;
      var k = Math.min(1, dtSec * 11);

      sh.power += ((fs.power || 0) - sh.power) * k;
      if (nav) sh.kms += (nav.shipKms - sh.kms) * k;
      if (fs.heartRate != null) sh.hr += (fs.heartRate - sh.hr) * k;

      drawShell(ctx);
      drawTop(ctx, fs);
      drawReticle(ctx);

      drawReadout(ctx, {
        x: 96, align: 'left', label: 'VELOCITY',
        value: Math.round(sh.kms).toLocaleString('en-US'), unit: 'km/s',
        accent: HUD, pct: clamp01((fs.speed || 0) / (fs.speedMax || 60)),
        sub: nav ? nav.lightPct.toFixed(3) + '% c' : '--'
      });

      drawReadout(ctx, {
        x: CW - 96, align: 'right', label: 'THRUST',
        value: String(Math.round(sh.power)), unit: 'W',
        accent: AMBER, pct: clamp01((fs.power || 0) / (fs.powerMax || 60)),
        sub: (fs.heartRate == null ? '--' : Math.round(sh.hr)) + ' bpm'
      });

      drawNav(ctx, nav);
      this._tex.needsUpdate = true;
    },

    tick: function (time, timeDelta) {
      var should = this.data.forceVisible || this.isPresenting();
      if (should !== this._visible) this.setVisible(should);
      if (!this._visible) return;
      this.applyMode();

      var dt = (timeDelta || 16) / 1000;
      this.follow(dt);

      this._last += timeDelta || 16;
      if (this._last < REPAINT_MS) return;
      this.paint(this._last / 1000);
      this._last = 0;
    }
  });
})();
