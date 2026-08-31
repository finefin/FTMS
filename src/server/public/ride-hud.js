(function () {
  // =====================================================================
  // ride-hud.js
  // In-scene (stereo) HUD for immersive VR only.
  //
  // In windowed mode the DOM HUD in ride.html is the interface and this
  // entity stays hidden — a world-space HUD reads badly on a flat screen
  // and doubles up with the overlay. It is switched on only once a real
  // WebXR session exists (A-Frame also emits `enter-vr` for desktop
  // fullscreen, which is *not* immersive, so the session is what we test).
  //
  // Layout: three neon-framed glass panels in a shallow arc, centred on
  // power because power is what shapes the terrain.
  // =====================================================================

  var CYAN = '#00f6ff';
  var MAGENTA = '#ff2bd6';
  var AMBER = '#ffd166';
  var WHITE = '#ffffff';

  var POWER_MAX = 400;

  function hexToRgb(hex) {
    var c = new THREE.Color(hex);
    return c;
  }

  // A crisp neon rectangle outline with a dimmer inset line, built as raw
  // line geometry so it stays sharp at any headset resolution.
  function makeFrame(w, h, color, opacity) {
    var hw = w / 2, hh = h / 2;
    var inset = 0.018;
    var pts = [];

    function rect(x, y) {
      pts.push(
        -x, -y, 0, x, -y, 0,
        x, -y, 0, x, y, 0,
        x, y, 0, -x, y, 0,
        -x, y, 0, -x, -y, 0
      );
    }
    rect(hw, hh);
    rect(hw - inset, hh - inset);

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: hexToRgb(color),
      transparent: true,
      opacity: opacity == null ? 0.9 : opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    }));
  }

  // Corner brackets, the cheap trick that makes any HUD read as a HUD.
  function makeCorners(w, h, color) {
    var hw = w / 2, hh = h / 2;
    var L = Math.min(w, h) * 0.22;
    var o = 0.035;
    var pts = [];
    var sx, sy;
    for (sx = -1; sx <= 1; sx += 2) {
      for (sy = -1; sy <= 1; sy += 2) {
        var x = sx * (hw + o), y = sy * (hh + o);
        pts.push(x, y, 0, x - sx * L, y, 0);
        pts.push(x, y, 0, x, y - sy * L, 0);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: hexToRgb(color),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    }));
  }

  function makeGlass(w, h) {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: 0x0a0518,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        fog: false
      })
    );
  }

  // A horizontal meter that fills from its left edge.
  function makeMeter(w, h, color) {
    var group = new THREE.Group();

    var track = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: hexToRgb(color), transparent: true, opacity: 0.16,
        depthWrite: false, fog: false
      })
    );
    group.add(track);

    var fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: hexToRgb(color), transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      })
    );
    fill.position.z = 0.001;
    group.add(fill);

    group.userData.setPct = function (p) {
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      // Plane origin is its centre, so shrink and shift to pin the left edge.
      fill.scale.x = Math.max(0.0001, p);
      fill.position.x = -w / 2 + (w * p) / 2;
      fill.visible = p > 0.001;
    };
    group.userData.setPct(0);
    return group;
  }

  AFRAME.registerComponent('ride-hud', {
    schema: {
      // Show even without a WebXR session. Only for debugging the layout.
      forceVisible: { type: 'boolean', default: false }
    },

    init: function () {
      var self = this;
      var root = this.el;

      // Anchored in the rig at roughly seated eye height, tilted up a touch
      // so it sits in the lower field of view without covering the horizon.
      root.setAttribute('position', '0 1.5 -2.2');
      root.setAttribute('rotation', '8 0 0');

      this._panels = [];
      this._built = false;
      this._prev = { power: null, speed: null, hr: null };

      this.buildPanels();

      // Hidden until an immersive session actually starts.
      this.setVisible(this.data.forceVisible);

      var scene = this.el.sceneEl;
      this._onEnter = function () { self.setVisible(self.isImmersive()); };
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
    },

    // A-Frame reports `vr-mode` for plain desktop fullscreen too, so the
    // presence of an XR session is the only reliable "really in a headset".
    isImmersive: function () {
      var scene = this.el.sceneEl;
      if (!scene) return false;
      if (scene.xrSession) return true;
      // Older/renderer-side fallback.
      var r = scene.renderer;
      return !!(r && r.xr && r.xr.isPresenting);
    },

    setVisible: function (v) {
      this._visible = !!v;
      this.el.object3D.visible = !!v;
    },

    buildPanels: function () {
      var root3D = this.el.object3D;

      // --- Centre: POWER, the metric that drives the mountains ---
      var power = this.makePanel({
        w: 1.15, h: 0.68, x: 0, y: 0, z: 0, rotY: 0,
        label: 'POWER', accent: MAGENTA, unit: 'W',
        labelWrap: 30, valueWrap: 7, unitWrap: 26,
        labelY: 0.25, valueY: 0.045, unitY: -0.135
      });
      power.meter = makeMeter(0.96, 0.03, MAGENTA);
      power.meter.position.set(0, -0.255, 0.012);
      power.group.add(power.meter);
      this._power = power;

      // --- Left: SPEED ---
      var speed = this.makePanel({
        w: 0.8, h: 0.48, x: -1.02, y: -0.02, z: 0.22, rotY: 17,
        label: 'SPEED', accent: CYAN, unit: 'km/h',
        labelWrap: 22, valueWrap: 7, unitWrap: 20,
        labelY: 0.175, valueY: 0.0, unitY: -0.17
      });
      this._speed = speed;

      // --- Right: HEART RATE ---
      var hr = this.makePanel({
        w: 0.8, h: 0.48, x: 1.02, y: -0.02, z: 0.22, rotY: -17,
        label: 'HEART', accent: AMBER, unit: 'bpm',
        labelWrap: 22, valueWrap: 7, unitWrap: 20,
        labelY: 0.175, valueY: 0.0, unitY: -0.17
      });
      this._hr = hr;

      root3D.add(power.group, speed.group, hr.group);
      this._built = true;
    },

    makeText: function (val, opts) {
      var el = document.createElement('a-entity');
      el.setAttribute('text', {
        value: val,
        align: 'center', anchor: 'center', baseline: 'center',
        color: opts.color,
        width: opts.width,
        wrapCount: opts.wrapCount,
        opacity: opts.opacity == null ? 1 : opts.opacity
      });
      this.el.appendChild(el);
      return el;
    },

    makePanel: function (o) {
      var group = new THREE.Group();
      group.position.set(o.x, o.y, o.z);
      group.rotation.y = THREE.MathUtils.degToRad(o.rotY || 0);

      group.add(makeGlass(o.w, o.h));
      var frame = makeFrame(o.w, o.h, o.accent, 0.85);
      frame.position.z = 0.002;
      group.add(frame);
      var corners = makeCorners(o.w, o.h, o.accent);
      corners.position.z = 0.002;
      group.add(corners);

      // A-Frame's `text.width` is the width of the whole text block in metres
      // and `wrapCount` is how many characters span it, so glyph size is
      // width/wrapCount. Both are set explicitly here — sizing by `width`
      // alone makes the type wildly out of scale with the panel.
      var tw = o.w * 0.88;

      var label = this.makeText(o.label, {
        color: o.accent, width: tw, wrapCount: o.labelWrap, opacity: 0.95
      });
      var value = this.makeText('0', {
        color: WHITE, width: tw, wrapCount: o.valueWrap
      });
      value.setAttribute('hud-punch', '');
      var unit = this.makeText(o.unit, {
        color: o.accent, width: tw, wrapCount: o.unitWrap, opacity: 0.9
      });

      // The text entities must stay A-Frame children (they need the text
      // system), so reparent their object3Ds into the panel group once built.
      function attach(el, py) {
        var move = function () {
          group.add(el.object3D);
          el.object3D.position.set(0, py, 0.014);
        };
        if (el.hasLoaded) move(); else el.addEventListener('loaded', move);
      }
      attach(label, o.labelY);
      attach(value, o.valueY);
      attach(unit, o.unitY);

      return { group: group, valueEl: value, unitEl: unit, labelEl: label };
    },

    _setText: function (el, val) {
      if (!el) return;
      var t = el.getAttribute('text');
      if (t && t.value !== val) {
        el.setAttribute('text', 'value', val);
        return true;
      }
      return false;
    },

    _punch: function (el, strength) {
      if (!el) return;
      var c = el.components && el.components['hud-punch'];
      if (c) c.punch(strength);
    },

    tick: function () {
      if (!this._visible || !this._built) return;
      var rs = window.RideState;
      if (!rs) return;

      var p = rs.power != null ? Math.round(rs.power) : 0;
      var s = rs.speed != null ? rs.speed : 0;
      var h = rs.heartRate != null ? Math.round(rs.heartRate) : null;

      if (this._setText(this._power.valueEl, String(p))) {
        // Punch harder the bigger the jump, so surges read physically.
        var d = this._prev.power == null ? 0 : Math.abs(p - this._prev.power) / 120;
        this._punch(this._power.valueEl, Math.min(0.35, 0.06 + d * 0.3));
        this._prev.power = p;
      }
      if (this._power.meter) this._power.meter.userData.setPct(p / POWER_MAX);

      this._setText(this._speed.valueEl, s.toFixed(1));
      this._setText(this._hr.valueEl, h == null ? '--' : String(h));
    }
  });

  // Reusable scale-punch for HUD text. Reads its resting scale from whatever
  // the entity's own scale already is.
  AFRAME.registerComponent('hud-punch', {
    init: function () {
      this.age = Infinity;
      this.strength = 0;
      this.base = this.el.object3D.scale.x || 1;
    },

    punch: function (strength) {
      this.age = 0;
      this.strength = strength;
    },

    tick: function (time, timeDelta) {
      if (this.age > 0.3) return;
      this.age += (timeDelta || 16) / 1000;
      var f = Math.max(0, 1 - this.age / 0.3);
      var s = this.base * (1 + this.strength * f * f);
      this.el.object3D.scale.set(s, s, 1);
    }
  });
})();
