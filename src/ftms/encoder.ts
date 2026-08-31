// Buffer builders for FTMS control point commands (start/stop, set targets,
// indoor bike simulation, spin-down, etc.).

import { CONTROL_POINT_OPCODES } from "./constants.js";

function writeUint16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function writeSint16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(value);
  return buf;
}

export function requestControl(): Buffer {
  return Buffer.from([CONTROL_POINT_OPCODES.REQUEST_CONTROL]);
}

export function reset(): Buffer {
  return Buffer.from([CONTROL_POINT_OPCODES.RESET]);
}

export function startResume(): Buffer {
  return Buffer.from([CONTROL_POINT_OPCODES.START_RESUME]);
}

export function stopPause(pause: boolean): Buffer {
  return Buffer.from([CONTROL_POINT_OPCODES.STOP_PAUSE, pause ? 0x01 : 0x02]);
}

export function setSpeedTarget(speed: number): Buffer {
  const speedRaw = Math.round(speed * 100);
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_SPEED_TARGET]),
    writeUint16LE(speedRaw),
  ]);
}

export function setInclinationTarget(inclination: number): Buffer {
  const incRaw = Math.round(inclination * 10);
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_INCLINATION_TARGET]),
    writeSint16LE(incRaw),
  ]);
}

export function setResistanceTarget(level: number): Buffer {
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_RESISTANCE_TARGET]),
    writeSint16LE(level),
  ]);
}

export function setPowerTarget(power: number): Buffer {
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_POWER_TARGET]),
    writeSint16LE(power),
  ]);
}

export function setHeartRateTarget(hr: number): Buffer {
  return Buffer.from([CONTROL_POINT_OPCODES.SET_HEART_RATE_TARGET, hr]);
}

export function setIndoorBikeSimulation(
  windSpeed: number,
  grade: number,
  crr: number,
  cw: number
): Buffer {
  const windSpeedRaw = Math.round(windSpeed * 1000);
  const gradeRaw = Math.round(grade * 100);
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_INDOR_BIKE_SIMULATION]),
    writeSint16LE(windSpeedRaw),
    writeSint16LE(gradeRaw),
    Buffer.from([crr * 10000, Math.round(cw * 100)]),
  ]);
}

export function setWheelCircumference(circumference: number): Buffer {
  const raw = Math.round(circumference * 10000);
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_WHEEL_CIRCUMFERENCE]),
    writeUint16LE(raw),
  ]);
}

export function setSpinDownControl(
  spinDownControl: number,
  speedLow: number,
  speedHigh: number
): Buffer {
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_SPIN_DOWN_CONTROL, spinDownControl]),
    writeUint16LE(Math.round(speedLow * 100)),
    writeUint16LE(Math.round(speedHigh * 100)),
  ]);
}

export function setLatitudeAndLongitude(
  latitude: number,
  longitude: number
): Buffer {
  const latRaw = Math.round(latitude * 10000000);
  const lonRaw = Math.round(longitude * 10000000);
  const latBuf = Buffer.alloc(4);
  latBuf.writeInt32LE(latRaw);
  const lonBuf = Buffer.alloc(4);
  lonBuf.writeInt32LE(lonRaw);
  return Buffer.concat([
    Buffer.from([CONTROL_POINT_OPCODES.SET_LATITUDE_AND_LONGITUDE]),
    latBuf,
    lonBuf,
  ]);
}
