(function () {
  // =====================================================================
  // ride-hud.js
  // In-scene HUD matching the beat-saber's in-game style. Lives in the rig
  // (not the camera), with values in the corners:
  //   - top-left:  Speed (white, large)
  //   - top-right: Power (yellow, medium)
  //   - bottom-left: Heart rate (cyan, small)
  // =====================================================================

  AFRAME.registerComponent('ride-hud', {
    init: function () {
      var self = this;
      var root = this.el;

      // Match the beat-saber's HUD anchor: centered in the rig, 2m in front,
      // slightly above eye level so it sits comfortably in the upper FOV.
      root.setAttribute('position', '0 1.45 -2');

      // --- Speed (top-left, white, large) ---
      this._speed = document.createElement('a-entity');
      this._speed.setAttribute('position', '-2.1 1.55 0');
      this._speed.setAttribute('scale', '0.6 0.6 1');
      this._speed.setAttribute('text', {
        value: '0.0 km/h',
        align: 'left',
        anchor: 'left',
        color: '#ffffff',
        width: 5,
      });
      this._speed.setAttribute('hud-punch', '');
      root.appendChild(this._speed);

      // --- Power (top-right, yellow, medium) ---
      this._power = document.createElement('a-entity');
      this._power.setAttribute('position', '2.1 1.55 0');
      this._power.setAttribute('scale', '0.4 0.4 1');
      this._power.setAttribute('text', {
        value: '0 W',
        align: 'right',
        anchor: 'right',
        color: '#ffdd55',
        width: 5,
      });
      this._power.setAttribute('hud-punch', '');
      root.appendChild(this._power);

      // --- Heart rate (bottom-left, cyan, small) ---
      this._hr = document.createElement('a-entity');
      this._hr.setAttribute('position', '-2.1 1.25 0');
      this._hr.setAttribute('scale', '0.35 0.35 1');
      this._hr.setAttribute('text', {
        value: '',
        align: 'left',
        anchor: 'left',
        color: '#9be8ff',
        width: 5,
      });
      this._hr.setAttribute('hud-punch', '');
      root.appendChild(this._hr);
    },

    tick: function () {
      var rs = window.RideState;
      if (!rs) return;

      var speedVal = (rs.speed || 0).toFixed(1) + ' km/h';
      var powerVal = rs.power != null ? Math.round(rs.power) + ' W' : '0 W';
      var hrVal = rs.heartRate != null ? Math.round(rs.heartRate) + ' bpm' : '';

      this._setIfChanged(this._speed, speedVal);
      this._setIfChanged(this._power, powerVal);
      this._setIfChanged(this._hr, hrVal);
    },

    _setIfChanged: function (el, val) {
      var t = el.getAttribute('text');
      if (t && t.value !== val) {
        el.setAttribute('text', 'value', val);
      }
    }
  });

  // Reusable scale-punch for HUD text. Reads its resting scale from whatever
  // the entity's `scale` attribute already is.
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
