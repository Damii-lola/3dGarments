/**
 * "Pose zero" for the limbs: the direction each bone points when every pose angle is 0.
 *
 * The poses (poses.js) were authored and calibrated against this rest stance (arms ~48°
 * down, soft elbows, legs slightly apart). Each body model has its own bind pose (T-pose,
 * arms down …); Human re-bases its limb bones onto these directions, so every pose means
 * the same thing on every model. Body space: metres, y up, facing +z, left = +x.
 */
export const ZERO_DIRS = {
  thigh_l: [0.1042, -0.9911, 0.0823],
  calf_l: [0.0935, -0.995, -0.0361],
  foot_l: [0.0416, -0.4576, 0.8882],
  ball_l: [-0.066, 0.0464, 0.9967],
  thigh_r: [-0.1042, -0.9911, 0.0823],
  calf_r: [-0.0935, -0.995, -0.0361],
  foot_r: [-0.0416, -0.4576, 0.8882],
  ball_r: [0.066, 0.0464, 0.9967],
  clavicle_l: [0.9882, -0.1521, -0.0155],
  clavicle_r: [-0.9882, -0.1521, -0.0155],
  upperarm_l: [0.6662, -0.7458, 0.0034],
  lowerarm_l: [0.5111, -0.5206, 0.6839],
  hand_l: [0.3322, -0.486, 0.8084],
  upperarm_r: [-0.6662, -0.7458, 0.0034],
  lowerarm_r: [-0.5111, -0.5206, 0.6839],
  hand_r: [-0.3322, -0.486, 0.8084],
  index_01_l: [0.1296, -0.5835, 0.8017],
  index_01_r: [-0.1296, -0.5835, 0.8017],
  index_02_l: [-0.0244, -0.7059, 0.7079],
  index_02_r: [0.0244, -0.7059, 0.7079],
  index_03_l: [-0.1359, -0.7468, 0.651],
  index_03_r: [0.1359, -0.7468, 0.651],
  middle_01_l: [0.213, -0.7675, 0.6046],
  middle_01_r: [-0.213, -0.7675, 0.6046],
  middle_02_l: [0.0963, -0.7789, 0.6197],
  middle_02_r: [-0.0963, -0.7789, 0.6197],
  middle_03_l: [-0.0074, -0.8352, 0.5499],
  middle_03_r: [0.0074, -0.8352, 0.5499],
  pinky_01_l: [0.2768, -0.8951, 0.3494],
  pinky_01_r: [-0.2768, -0.8951, 0.3494],
  pinky_02_l: [0.1105, -0.9247, 0.3644],
  pinky_02_r: [-0.1105, -0.9247, 0.3644],
  pinky_03_l: [0.1337, -0.928, 0.3477],
  pinky_03_r: [-0.1337, -0.928, 0.3477],
  ring_01_l: [0.3124, -0.8236, 0.4734],
  ring_01_r: [-0.3124, -0.8236, 0.4734],
  ring_02_l: [0.1712, -0.846, 0.505],
  ring_02_r: [-0.1712, -0.846, 0.505],
  ring_03_l: [0.0915, -0.903, 0.4197],
  ring_03_r: [-0.0915, -0.903, 0.4197],
  thumb_01_l: [-0.6774, -0.2813, 0.6797],
  thumb_01_r: [0.6774, -0.2813, 0.6797],
  thumb_02_l: [-0.3421, -0.3852, 0.8571],
  thumb_02_r: [0.3421, -0.3852, 0.8571],
  thumb_03_l: [-0.1961, -0.6203, 0.7594],
  thumb_03_r: [0.1961, -0.6203, 0.7594],
};

/** Back-of-hand normals in pose zero (hand + finger frames: +x curls into the palm). */
export const ZERO_PALM = { l: [0.7739, 0.6318, 0.044], r: [-0.7739, 0.6318, 0.044] };
