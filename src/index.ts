// Public library barrel exports for the FTMS client, decoders, encoders,
// types, and equipment snapshot helpers.

export { FTMSClient } from "./ftms/client.js";
export type { FtmsDataEvent } from "./ftms/client.js";
export * from "./ftms/types.js";
export * from "./ftms/constants.js";
export * from "./ble/types.js";
export {
  decodeFitnessMachineFeature,
  decodeIndoorBikeData,
  decodeTreadmillData,
  decodeCrossTrainerData,
  decodeRowerData,
  decodeStepClimberData,
  decodeStairClimberData,
  decodeTrainingStatus,
  decodeFitnessMachineStatus,
} from "./ftms/decoder.js";
export {
  requestControl,
  reset,
  startResume,
  stopPause,
  setSpeedTarget,
  setInclinationTarget,
  setResistanceTarget,
  setPowerTarget,
  setHeartRateTarget,
  setIndoorBikeSimulation,
  setWheelCircumference,
} from "./ftms/encoder.js";
export {
  snapshotBikeData,
  type BikeSnapshot,
} from "./equipment/bike.js";
export {
  snapshotTreadmillData,
  type TreadmillSnapshot,
} from "./equipment/treadmill.js";
export {
  snapshotEllipticalData,
  type EllipticalSnapshot,
} from "./equipment/elliptical.js";
export {
  snapshotRowerData,
  type RowerSnapshot,
} from "./equipment/rower.js";
