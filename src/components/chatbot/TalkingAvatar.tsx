"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { VISEMES, emptyFrame, type Viseme } from "@/lib/voice/lipSync";
import type { LipSyncSource } from "./useAssistantVoice";
import type { AvatarDriver } from "./avatar/useAvatarController";
import {
  activeClipCues,
  computeExpression,
  neutralPose,
  type ExpressionPose,
} from "@/lib/avatar/expression";
import { LabScene, type DeskLayout } from "./LabScene";

/**
 * Real-time 3D assistant (browser-native renderer): a rigged glTF character
 * whose mouth follows the voice, drawn on a transparent canvas.
 *
 * Motion is designed to read as a calm, real person rather than an animated
 * puppet:
 * - every procedural movement is a rotation about stable world axes fed
 *   through critically-damped springs, so nothing snaps or jitters;
 * - rhythms are slow and incommensurate: breathing ~4.5s, weight shift ~11s,
 *   head drift 7-13s, so the loop never visibly repeats;
 * - while speaking, the hands rise into gentle explaining gestures over
 *   ~0.7s and settle back, and the head nods with the smoothed voice energy;
 * - blinks and eye saccades stay quick, as they are in people.
 *
 * On top sit the context layer (conversation state, planned emotion/gesture
 * cues) and gesture clips when the model ships them.
 *
 * Works with Oculus visemes (`viseme_aa`…), Character Creator (`V_Open`…) or
 * ARKit 52 blendshapes, and Mixamo / Character Creator / 3ds Max Biped
 * ("Bip01 …") skeletons. Names are matched case/separator-insensitively.
 */

export const AVATAR_MODEL_URL = "/models/assistant.glb";

export type AvatarFraming = "body" | "bust" | "desk";

/* ------------------------------------------------------------------------ */
/* Blendshape mapping                                                        */
/* ------------------------------------------------------------------------ */

type Recipe = [morph: string, weight: number][];
type Scheme = { key: string; visemes: Partial<Record<Viseme, Recipe>> };

const norm = (name: string) =>
  name
    .toLowerCase()
    .replace(/left/g, "l")
    .replace(/right/g, "r")
    .replace(/[^a-z0-9]/g, "");

const SCHEMES: Scheme[] = [
  {
    key: "visemeaa",
    visemes: {
      // Every viseme drives its own morph target, timed from the voice, at
      // moderate strength: full-strength shapes on each syllable look busy.
      PP: [["visemePP", 0.7]],
      FF: [["visemeFF", 0.6]],
      SS: [["visemeSS", 0.5]],
      aa: [["visemeaa", 0.65]],
      E: [["visemeE", 0.6]],
      I: [["visemeI", 0.55]],
      O: [["visemeO", 0.6]],
      U: [["visemeU", 0.55]],
    },
  },
  {
    key: "vopen",
    visemes: {
      PP: [["vexplosive", 0.75]],
      FF: [["vdentallip", 0.75]],
      SS: [["vaffricate", 0.45], ["vwide", 0.2]],
      aa: [["vopen", 0.7]],
      E: [["vwide", 0.5], ["vopen", 0.25]],
      I: [["vwide", 0.7], ["vopen", 0.08]],
      O: [["vtighto", 0.65], ["vopen", 0.25]],
      U: [["vtight", 0.65], ["vtighto", 0.15]],
    },
  },
  {
    key: "jawopen",
    visemes: {
      PP: [["mouthclose", 0.4], ["mouthpressl", 0.35], ["mouthpressr", 0.35]],
      FF: [["mouthrolllower", 0.5], ["mouthupperupl", 0.18], ["mouthupperupr", 0.18], ["jawopen", 0.06]],
      SS: [["jawopen", 0.06], ["mouthstretchl", 0.32], ["mouthstretchr", 0.32]],
      aa: [["jawopen", 0.45], ["mouthlowerdownl", 0.22], ["mouthlowerdownr", 0.22]],
      E: [["jawopen", 0.24], ["mouthstretchl", 0.4], ["mouthstretchr", 0.4]],
      I: [["jawopen", 0.1], ["mouthsmilel", 0.25], ["mouthsmiler", 0.25], ["mouthstretchl", 0.25], ["mouthstretchr", 0.25]],
      O: [["jawopen", 0.3], ["mouthfunnel", 0.55]],
      U: [["jawopen", 0.1], ["mouthpucker", 0.6], ["mouthfunnel", 0.15]],
    },
  },
];

/** First name found wins; covers ARKit and Character Creator spellings. */
const EXPRESSIONS = {
  blinkL: ["eyeblinkl", "blinkl", "eyesclosedl"],
  blinkR: ["eyeblinkr", "blinkr", "eyesclosedr"],
  smileL: ["mouthsmilel"],
  smileR: ["mouthsmiler"],
  browUp: ["browinnerup", "browraiseinnerl"],
  browUpR: ["browraiseinnerr"],
  cheekSquintL: ["cheeksquintl"],
  cheekSquintR: ["cheeksquintr"],
  browDownL: ["browdownl"],
  browDownR: ["browdownr"],
  browOuterUpL: ["browouterupl"],
  browOuterUpR: ["browouterupr"],
  eyeWideL: ["eyewidel"],
  eyeWideR: ["eyewider"],
  frownL: ["mouthfrownl"],
  frownR: ["mouthfrownr"],
  lookInL: ["eyelookinl"],
  lookOutL: ["eyelookoutl"],
  lookUpL: ["eyelookupl"],
  lookDownL: ["eyelookdownl"],
  lookInR: ["eyelookinr"],
  lookOutR: ["eyelookoutr"],
  lookUpR: ["eyelookupr"],
  lookDownR: ["eyelookdownr"],
} as const;

type ExpressionKey = keyof typeof EXPRESSIONS;

interface MorphBinding {
  mesh: THREE.Mesh;
  /** Per viseme: [morph index, weight]. */
  visemes: [number, number][][];
  expressions: Partial<Record<ExpressionKey, number>>;
  /** 1 for morphs driven by speech (eased fast), 0 for the rest of the face. */
  mouth: Uint8Array;
  /** Scratch target per morph index, rebuilt every frame. */
  target: Float32Array;
}

function bindMorphs(root: THREE.Object3D): MorphBinding[] {
  const out: MorphBinding[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const dict = mesh.morphTargetDictionary;
    if (!mesh.isMesh || !dict || !mesh.morphTargetInfluences) return;
    const byNorm = new Map<string, number>();
    for (const [name, idx] of Object.entries(dict)) byNorm.set(norm(name), idx);

    const scheme = SCHEMES.find((s) => byNorm.has(norm(s.key)));
    const visemes = VISEMES.map((v) =>
      (scheme?.visemes[v] ?? []).flatMap(([name, w]) => {
        const idx = byNorm.get(norm(name));
        return idx === undefined ? [] : [[idx, w] as [number, number]];
      }),
    );
    const expressions: MorphBinding["expressions"] = {};
    for (const key of Object.keys(EXPRESSIONS) as ExpressionKey[]) {
      const idx = EXPRESSIONS[key].map((n) => byNorm.get(n)).find((i) => i !== undefined);
      if (idx !== undefined) expressions[key] = idx;
    }
    if (!scheme && Object.keys(expressions).length === 0) return;
    const mouth = new Uint8Array(mesh.morphTargetInfluences.length);
    for (const list of visemes) for (const [idx] of list) mouth[idx] = 1;
    out.push({ mesh, visemes, expressions, mouth, target: new Float32Array(mesh.morphTargetInfluences.length) });
  });
  return out;
}

/* ------------------------------------------------------------------------ */
/* Skeleton helpers                                                          */
/* ------------------------------------------------------------------------ */

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  const wanted = names.map(norm);
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found || (o as THREE.Mesh).isMesh) return;
    const n = norm(o.name).replace(/^(mixamorig|ccbase|armature|bip01)/, "");
    if (n && wanted.includes(n)) found = o;
  });
  return found;
}

const tmpV1 = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ1 = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, "YXZ");

/** Rotates `bone` (in world space) so the direction bone -> child points along `dir`. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  if (!bone.parent) return;
  bone.parent.updateWorldMatrix(true, true);
  const from = child.getWorldPosition(tmpV2).sub(bone.getWorldPosition(tmpV1)).normalize();
  const swing = new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize());
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(swing).multiply(boneQ));
  bone.updateWorldMatrix(false, true);
}

/** Rotates `bone` in world space by the rotation taking direction `from` to `to`. */
function swingBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (!bone.parent) return;
  const swing = tmpQ1.setFromUnitVectors(from.normalize(), to.normalize());
  const parentInv = bone.parent.getWorldQuaternion(tmpQ2).invert();
  const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentInv.multiply(swing).multiply(boneQ));
  bone.updateWorldMatrix(false, true);
}

/**
 * Keeps a resting hand pinned to a point on the desk: an analytic two-bone IK
 * (shoulder-elbow-wrist) solved every frame after the torso has moved, so
 * breathing or head motion can never slide the hand around or push it into
 * the desk. The elbow keeps bending the way it already does.
 */
interface HandPin {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** World position the wrist is held at. */
  target: THREE.Vector3;
  /** World rotation of the hand at rest (kept flat on the desk). */
  handWorld: THREE.Quaternion;
}

const ikS = new THREE.Vector3();
const ikE = new THREE.Vector3();
const ikW = new THREE.Vector3();
const ikDir = new THREE.Vector3();
const ikPole = new THREE.Vector3();
const ikElbow = new THREE.Vector3();

function solveHandPin(pin: HandPin) {
  const { upper, fore, hand, target } = pin;
  pin.upper.parent?.updateWorldMatrix(true, true);
  upper.getWorldPosition(ikS);
  fore.getWorldPosition(ikE);
  hand.getWorldPosition(ikW);
  const a = ikE.distanceTo(ikS);
  const b = ikW.distanceTo(ikE);
  ikDir.copy(target).sub(ikS);
  const d = Math.min(Math.max(ikDir.length(), Math.abs(a - b) + 1e-4), a + b - 1e-4);
  ikDir.normalize();
  // Bend direction: the current elbow offset, perpendicular to shoulder->target.
  ikPole.copy(ikE).sub(ikS);
  ikPole.addScaledVector(ikDir, -ikPole.dot(ikDir));
  if (ikPole.lengthSq() < 1e-10) ikPole.set(0, -1, 0);
  ikPole.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  ikElbow.copy(ikS).addScaledVector(ikDir, a * cosA).addScaledVector(ikPole, a * sinA);

  swingBone(upper, ikE.clone().sub(ikS), ikElbow.clone().sub(ikS));
  fore.getWorldPosition(ikE);
  hand.getWorldPosition(ikW);
  swingBone(fore, ikW.clone().sub(ikE), target.clone().sub(ikE));
  // Hand keeps its resting orientation in the world.
  if (hand.parent) {
    hand.quaternion.copy(hand.parent.getWorldQuaternion(tmpQ2).invert().multiply(pin.handWorld));
    hand.updateWorldMatrix(false, true);
  }
}

/**
 * A bone animated by small world-axis rotations layered on its rest pose.
 * World axes (after facing the camera): X = her left→right from the viewer,
 * Y = up, Z = toward the viewer.
 */
class Joint {
  readonly rest: THREE.Quaternion;
  private readonly parentRest: THREE.Quaternion;
  private readonly parentRestInv: THREE.Quaternion;
  constructor(readonly bone: THREE.Object3D) {
    this.rest = bone.quaternion.clone();
    this.parentRest = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    this.parentRestInv = this.parentRest.clone().invert();
  }
  /** Sets the bone to rest rotated by world-axis Euler (x, y, z) radians. */
  set(x: number, y: number, z: number, onTopOfCurrent = false) {
    tmpQ1.setFromEuler(tmpE.set(x, y, z, "YXZ"));
    // local = parentRest⁻¹ · Δworld · parentRest · base
    tmpQ2.copy(this.parentRestInv).multiply(tmpQ1).multiply(this.parentRest);
    const base = onTopOfCurrent ? this.bone.quaternion : this.rest;
    this.bone.quaternion.copy(tmpQ2.multiply(base));
  }
}

/** Critically damped spring toward a target; `tau` ~ seconds to settle 63%. */
class Spring {
  value = 0;
  private velocity = 0;
  constructor(private readonly tau: number) {}
  step(target: number, dt: number) {
    const omega = 2 / this.tau;
    const x = this.value - target;
    const exp = Math.exp(-omega * dt);
    const temp = (this.velocity + omega * x) * dt;
    this.velocity = (this.velocity - omega * temp) * exp;
    this.value = target + (x + temp) * exp;
    return this.value;
  }
}

/** Smooth pseudo-noise from summed incommensurate sines, roughly -1..1. */
const drift = (t: number, seed: number, speed = 1) =>
  (Math.sin(t * 0.21 * speed + seed) +
    Math.sin(t * 0.37 * speed + seed * 2.3) * 0.55 +
    Math.sin(t * 0.61 * speed + seed * 4.1) * 0.25) /
  1.8;

/* ------------------------------------------------------------------------ */
/* Rig                                                                       */
/* ------------------------------------------------------------------------ */

type JointName =
  | "pelvis" | "spine" | "chest" | "neck" | "head"
  | "clavL" | "clavR" | "upperL" | "upperR" | "foreL" | "foreR" | "handL" | "handR"
  | "eyeL" | "eyeR" | "jaw";

interface Rig {
  scene: THREE.Object3D;
  hasIdle: boolean;
  seated: boolean;
  /** Where the desk and chair go, when seated. */
  desk: DeskLayout | null;
  /** Seated: hands pinned to the desk by IK. */
  handPins: HandPin[];
  joints: Partial<Record<JointName, Joint>>;
  hasMouthMorphs: boolean;
  /** Eye direction is driven by eye-look blendshapes rather than eye bones. */
  hasEyeLookMorphs: boolean;
  morphs: MorphBinding[];
  /** Framing references in world space. */
  headTop: number;
  /** World y of the chest (upper spine) bone, for chest-up framing. */
  chestY: number;
  hips: number;
  centerX: number;
  shoulderWidth: number;
}

/**
 * Some exporters (e.g. FBX from 3ds Max) arrive Z-up, lying on their back.
 * Rotate the whole model so pelvis -> head points straight up, then framing
 * only cares about the head and hips, so no ground placement is needed.
 */
function standUpright(scene: THREE.Object3D, pelvis: THREE.Object3D | null, head: THREE.Object3D | null) {
  if (!pelvis || !head) return;
  scene.updateMatrixWorld(true);
  const up = head.getWorldPosition(new THREE.Vector3()).sub(pelvis.getWorldPosition(new THREE.Vector3()));
  if (up.lengthSq() < 1e-8) return;
  up.normalize();
  if (up.y > 0.95) return; // already upright
  const fix = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  scene.quaternion.premultiply(fix);
  scene.updateMatrixWorld(true);
}

function faceCamera(scene: THREE.Object3D, head: THREE.Object3D | null, eyeL: THREE.Object3D | null, eyeR: THREE.Object3D | null) {
  if (!head || !eyeL || !eyeR) return;
  scene.updateMatrixWorld(true);
  const h = head.getWorldPosition(new THREE.Vector3());
  const eyes = eyeL.getWorldPosition(new THREE.Vector3()).add(eyeR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const forward = eyes.sub(h).setY(0);
  if (forward.lengthSq() < 1e-8) return;
  const angle = Math.atan2(forward.x, forward.z); // 0 when already facing +Z
  scene.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle));
  scene.updateMatrixWorld(true);
}

/** Seat height the character is placed at (m). */
const SEAT_Y = 0.5;

function buildRig(scene: THREE.Object3D, hasIdle: boolean, seated: boolean): Rig {
  // Normalize units: some exporters write centimeters.
  const box0 = new THREE.Box3().setFromObject(scene, true);
  if (box0.max.y - box0.min.y > 10) scene.scale.setScalar(0.01);
  scene.updateMatrixWorld(true);

  const bone = (...names: string[]) => findBone(scene, names);
  const b = {
    pelvis: bone("pelvis", "hips"),
    spine: bone("spine", "spine01"),
    chest: bone("spine2", "spine02", "chest", "upperchest", "spine1"),
    neck: bone("neck", "necktwist01"),
    head: bone("head"),
    clavL: bone("lclavicle", "leftshoulder", "lclavicle"),
    clavR: bone("rclavicle", "rightshoulder"),
    upperL: bone("lupperarm", "leftarm", "upperarml"),
    upperR: bone("rupperarm", "rightarm", "upperarmr"),
    foreL: bone("lforearm", "leftforearm", "forearml"),
    foreR: bone("rforearm", "rightforearm", "forearmr"),
    handL: bone("lhand", "lefthand", "handl"),
    handR: bone("rhand", "righthand", "handr"),
    eyeL: bone("leye", "lefteye", "eyel"),
    eyeR: bone("reye", "righteye", "eyer"),
    jaw: bone("mjaw", "jaw", "jawroot", "lowerjaw"),
  };
  const legs = {
    thighL: bone("lthigh", "leftupleg", "thighl"),
    thighR: bone("rthigh", "rightupleg", "thighr"),
    calfL: bone("lcalf", "leftleg", "calfl"),
    calfR: bone("rcalf", "rightleg", "calfr"),
    footL: bone("lfoot", "leftfoot", "footl"),
    footR: bone("rfoot", "rightfoot", "footr"),
  };

  standUpright(scene, b.pelvis, b.head);
  faceCamera(scene, b.head, b.eyeL, b.eyeR);

  const chestX = () => (b.chest ?? scene).getWorldPosition(new THREE.Vector3()).x;
  const sideOf = (o: THREE.Object3D, fallback: number) =>
    Math.sign(o.getWorldPosition(new THREE.Vector3()).x - chestX()) || fallback;

  let desk: DeskLayout | null = null;
  const handPins: HandPin[] = [];
  if (seated && !hasIdle) {
    // Seated upright at a desk: thighs level, shins down, upper arms slightly
    // forward and forearms resting on the desk - a composed, professional posture.
    for (const side of [1, -1] as const) {
      const thigh = side === 1 ? legs.thighL : legs.thighR;
      const calf = side === 1 ? legs.calfL : legs.calfR;
      const foot = side === 1 ? legs.footL : legs.footR;
      if (thigh && calf) aimBone(thigh, calf, new THREE.Vector3(sideOf(thigh, side) * 0.06, -0.04, 1));
      if (calf && foot) aimBone(calf, foot, new THREE.Vector3(0, -1, 0.08));
      const upper = side === 1 ? b.upperL : b.upperR;
      const fore = side === 1 ? b.foreL : b.foreR;
      const hand = side === 1 ? b.handL : b.handR;
      if (!upper || !fore || !hand) continue;
      const sx = sideOf(upper, side);
      // Asymmetric on purpose: one forearm further forward and more
      // relaxed than the other, as people actually sit.
      const lead = side === 1;
      aimBone(upper, fore, new THREE.Vector3(sx * (lead ? 0.08 : 0.14), lead ? -0.85 : -0.88, lead ? 0.52 : 0.44));
      aimBone(fore, hand, new THREE.Vector3(-sx * (lead ? 0.24 : 0.36), lead ? -0.05 : -0.09, lead ? 1 : 0.95));
    }
    scene.updateMatrixWorld(true);

    // Sit her on the chair: pelvis just above the seat, centered at z = 0.
    if (b.pelvis) {
      const p = b.pelvis.getWorldPosition(new THREE.Vector3());
      scene.position.x -= p.x;
      scene.position.y += SEAT_Y + 0.08 - p.y;
      scene.position.z -= p.z;
      scene.updateMatrixWorld(true);
    }
    // The desk surface sits just under the lowest part of the hands. Bones
    // mark joint centres, so allow for the thickness of fingers and palm.
    const handParts: THREE.Object3D[] = [];
    for (const h of [b.handL, b.handR]) {
      if (!h) continue;
      h.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) handParts.push(o);
      });
    }
    const forearms = [b.foreL, b.foreR, ...handParts].filter(Boolean) as THREE.Object3D[];
    // Measured on skinned vertices: the lowest hand surface sits ~7mm below
    // the lowest hand joint, so this leaves ~8mm of clearance (no hovering,
    // no fingers through the desk).
    const lowest = Math.min(...forearms.map((o) => o.getWorldPosition(new THREE.Vector3()).y)) - 0.01;
    const nearestHandZ = Math.min(
      ...[b.handL, b.handR].filter(Boolean).map((o) => (o as THREE.Object3D).getWorldPosition(new THREE.Vector3()).z),
    );
    const chestZ = (b.chest ?? scene).getWorldPosition(new THREE.Vector3()).z;
    for (const side of [1, -1] as const) {
      const upper = side === 1 ? b.upperL : b.upperR;
      const fore = side === 1 ? b.foreL : b.foreR;
      const hand = side === 1 ? b.handL : b.handR;
      if (!upper || !fore || !hand) continue;
      handPins.push({
        upper,
        fore,
        hand,
        target: hand.getWorldPosition(new THREE.Vector3()),
        handWorld: hand.getWorldQuaternion(new THREE.Quaternion()),
      });
    }
    desk = {
      deskTop: lowest - 0.005,
      deskBackZ: Math.min(nearestHandZ - 0.14, chestZ + 0.22),
      centerX: 0,
      seatY: SEAT_Y,
      backZ: chestZ - 0.12,
    };
  } else if (!hasIdle) {
    // Natural standing pose (no idle clip): arms down, forearms forward and in,
    // hands meeting loosely in front of the body.
    for (const side of [1, -1] as const) {
      const upper = side === 1 ? b.upperL : b.upperR;
      const fore = side === 1 ? b.foreL : b.foreR;
      const hand = side === 1 ? b.handL : b.handR;
      if (!upper || !fore || !hand) continue;
      // Which world side this arm is on (+1 = viewer's right).
      const sx = Math.sign(upper.getWorldPosition(new THREE.Vector3()).x - (b.chest ?? scene).getWorldPosition(new THREE.Vector3()).x) || side;
      aimBone(upper, fore, new THREE.Vector3(sx * 0.2, -1, 0.14));
      aimBone(fore, hand, new THREE.Vector3(-sx * 0.42, -0.5, 0.78));
    }
  }
  scene.updateMatrixWorld(true);

  const joints: Rig["joints"] = {};
  for (const [name, obj] of Object.entries(b) as [JointName, THREE.Object3D | null][]) {
    if (obj) joints[name] = new Joint(obj);
  }

  const materials = new Set<THREE.Material>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false; // skinned bounds are unreliable
    m.castShadow = true;
    m.receiveShadow = true;
    // No stethoscope: she is a lab researcher, not a physician.
    const matName = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => mt.name).join(" ");
    if (/stetho|stetosk/i.test(`${m.name} ${matName}`)) m.visible = false;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => materials.add(mat));
  });
  for (const mat of materials) {
    const std = mat as THREE.MeshStandardMaterial;
    // Hair/lash cards: MSAA-smoothed cutout instead of a hard jagged edge.
    if (std.alphaTest > 0) std.alphaToCoverage = true;
    std.envMapIntensity = 0.9;
    std.needsUpdate = true;
  }

  const morphs = bindMorphs(scene);
  const hasMouthMorphs = morphs.some((m) => m.visemes.some((v) => v.length > 0));
  const hasEyeLookMorphs = morphs.some((m) => m.expressions.lookOutL !== undefined && m.expressions.lookInL !== undefined);

  // Framing comes from the skeleton: a skinned mesh's raw geometry can be in
  // a different (bind-space) orientation, so its bounding box is unreliable.
  const box = new THREE.Box3().setFromObject(scene, true);
  const headPos = b.head?.getWorldPosition(new THREE.Vector3());
  const headTop = headPos ? headPos.y + 0.2 : box.max.y;
  const pelvisY = b.pelvis?.getWorldPosition(new THREE.Vector3()).y;
  const hips = pelvisY !== undefined ? pelvisY - 0.12 : box.min.y + (box.max.y - box.min.y) * 0.45;
  const shoulderWidth =
    b.upperL && b.upperR
      ? b.upperL.getWorldPosition(new THREE.Vector3()).distanceTo(b.upperR.getWorldPosition(new THREE.Vector3()))
      : 0.4;
  const centerX = headPos?.x ?? (box.min.x + box.max.x) / 2;
  const chestY = (b.chest ?? b.neck)?.getWorldPosition(new THREE.Vector3()).y ?? headTop - 0.5;

  return { scene, hasIdle, seated: Boolean(desk), desk, handPins, joints, hasMouthMorphs, hasEyeLookMorphs, morphs, headTop, chestY, hips, centerX, shoulderWidth };
}

/** Fits the character (head to hips, head and shoulders, or seated at the desk) into the canvas. */
function frameCamera(camera: THREE.PerspectiveCamera, rig: Rig, framing: AvatarFraming) {
  // "desk": seated in the lab, framed chest-up like a portrait (the
  // camera's ~22 degree vertical field of view is a ~60mm lens).
  const atDesk = framing === "desk" && rig.desk;
  const top = rig.headTop + (atDesk ? 0.05 : 0.04);
  const bottom = atDesk ? rig.chestY - 0.16 : framing === "body" ? rig.hips : rig.headTop - 0.62;
  const height = top - bottom;
  const width = atDesk ? rig.shoulderWidth * 1.5 : framing === "body" ? rig.shoulderWidth * 2.3 : rig.shoulderWidth * 1.8;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distV = height / 2 / Math.tan(vFov / 2);
  const distH = width / 2 / (Math.tan(vFov / 2) * camera.aspect);
  const dist = Math.max(distV, distH);
  const centerY = (top + bottom) / 2;
  // Camera a touch above center, as a person at eye level across a desk.
  camera.position.set(rig.centerX, centerY + height * (atDesk ? 0.06 : 0.08), dist);
  camera.lookAt(rig.centerX, centerY, 0);
  camera.near = 0.05;
  camera.far = 20;
  camera.updateProjectionMatrix();
}

/** Image-based light from a procedural room: realistic skin/eye speculars without fetching an HDR. */
function applyStudioEnvironment(gl: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(gl);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();
}

const IDLE_CLIP = /idle|breath|stand/i;

/** Numeric expression channels, computed once (not Object.keys every frame). */
const POSE_KEYS = (Object.keys(neutralPose()) as (keyof ExpressionPose)[]).filter(
  (k): k is Exclude<keyof ExpressionPose, "gaze"> => k !== "gaze",
);

function Avatar({
  url,
  lipSync,
  driver,
  framing,
  onReady,
  onLayout,
}: {
  url: string;
  lipSync: LipSyncSource;
  driver?: AvatarDriver;
  framing: AvatarFraming;
  onReady?: () => void;
  /** Called once the seated layout (desk/chair placement) is known. */
  onLayout?: (layout: DeskLayout) => void;
}) {
  // Meshopt on, Draco off: meshopt's decoder is bundled JS, Draco would fetch
  // its wasm decoder from a third-party CDN at runtime.
  const gltf = useGLTF(url, false, true);
  const scene = useMemo(() => cloneSkinned(gltf.scene), [gltf.scene]);
  const hasIdle = gltf.animations.length > 0;
  const group = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(gltf.animations, group);
  // three.js objects are mutated every frame, so they live in refs and are
  // (re)built lazily inside the frame loop rather than during render.
  const rigRef = useRef<Rig | null>(null);

  useEffect(() => {
    if (!hasIdle || names.length === 0) return;
    const name = names.find((n) => IDLE_CLIP.test(n)) ?? names[0];
    const action = actions[name];
    action?.reset().fadeIn(0.6).play();
    return () => void action?.fadeOut(0.6);
  }, [actions, names, hasIdle]);

  const state = useRef({
    frame: emptyFrame(),
    nextBlink: 1.5,
    blinkStart: -1,
    doubleBlink: false,
    gaze: new THREE.Vector2(),
    gazeTarget: new THREE.Vector2(),
    nextSaccade: 0.8,
    /** Where the eyes are held (viewer = 0,0); micro-saccades jitter around it. */
    fixation: new THREE.Vector2(),
    micro: new THREE.Vector2(),
    nextGlance: 2.5,
    pose: neutralPose(),
    startedClips: new Set<string>(),
    lastPlan: null as unknown,
    framedAspect: 0,
    readySent: false,
    /** Which hand leads the current speaking gesture (+1 / -1). */
    gestureSide: 1,
    nextGestureSwap: 0,
    springs: {
      talk: new Spring(0.5),
      energy: new Spring(0.28),
      nod: new Spring(0.35),
      gestureL: new Spring(0.75),
      gestureR: new Spring(0.75),
      lean: new Spring(0.9),
      headGaze: new Spring(0.9),
    },
  });

  // Gesture clips by library name ("ExplainBoth", "Bow", ...), if the model has them.
  const gestureActions = useMemo(() => {
    const map = new Map<string, THREE.AnimationAction>();
    for (const n of names) {
      const action = actions[n];
      if (action && !IDLE_CLIP.test(n)) map.set(norm(n), action);
    }
    return map;
  }, [actions, names]);

  useFrame(({ camera }, dtRaw) => {
    let rig = rigRef.current;
    const persp = camera as THREE.PerspectiveCamera;
    if (!rig || rig.scene !== scene) {
      rig = buildRig(scene, hasIdle, framing === "desk");
      rigRef.current = rig;
      state.current.framedAspect = 0;
      if (rig.desk) onLayout?.(rig.desk);
    }
    const s = state.current;
    if (Math.abs(s.framedAspect - persp.aspect) > 1e-3) {
      frameCamera(persp, rig, framing);
      s.framedAspect = persp.aspect;
    }
    if (!s.readySent) {
      s.readySent = true;
      onReady?.();
    }

    const dt = Math.min(dtRaw, 0.05);
    const t = performance.now() / 1000;
    const frame = lipSync.sample(s.frame);
    const talking = lipSync.isSpeaking();
    const sp = s.springs;
    const talk = sp.talk.step(talking ? 1 : 0, dt);
    const energy = sp.energy.step(frame.energy, dt);

    /* Blinks: every 2.5–6s, occasionally doubled; faster close than open. */
    if (s.blinkStart < 0 && t > s.nextBlink) {
      s.blinkStart = t;
      s.doubleBlink = Math.random() < 0.12;
    }
    let blink = 0;
    if (s.blinkStart >= 0) {
      const p = t - s.blinkStart;
      blink = p < 0.08 ? p / 0.08 : p < 0.24 ? 1 - (p - 0.08) / 0.16 : 0;
      if (p >= 0.24) {
        if (s.doubleBlink) {
          s.doubleBlink = false;
          s.blinkStart = t + 0.1;
        } else {
          s.blinkStart = -1;
          s.nextBlink = t + 2.5 + Math.random() * 3.5;
        }
      }
    }

    /* Context layer: conversation state + planned emotion/gesture cues. */
    const plan = driver?.plan() ?? null;
    const utteranceTime = lipSync.time();
    const target: ExpressionPose = driver
      ? computeExpression({
          state: driver.state(),
          stateAge: t - driver.stateSince(),
          utteranceTime,
          cues: plan?.cues ?? null,
          userActivityAge: t - driver.lastUserActivity(),
          now: t,
        })
      : neutralPose();
    // Slow, fluid changes between conversation states (~0.8s), so a switch
    // from listening to thinking never swings the head.
    const pk = 1 - Math.exp(-dt * 1.25);
    for (const key of POSE_KEYS) s.pose[key] += (target[key] - s.pose[key]) * pk;

    /* Strong layer: gesture clips, time-fitted to their cue. */
    if (s.lastPlan !== plan) {
      s.lastPlan = plan;
      s.startedClips.clear();
    }
    for (const cue of activeClipCues(plan?.cues ?? null, utteranceTime)) {
      const key = cue.name + "@" + cue.at.toFixed(3);
      const action = gestureActions.get(norm(cue.name));
      if (!action || s.startedClips.has(key)) continue;
      s.startedClips.add(key);
      const clipDuration = action.getClip().duration || cue.duration;
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      action.setEffectiveTimeScale(clipDuration / cue.duration);
      action.setEffectiveWeight(Math.min(1, 0.55 + cue.intensity * 0.6));
      action.fadeIn(0.4).play();
      window.setTimeout(() => action.fadeOut(0.5), Math.max(0, (cue.duration - 0.5) * 1000));
    }

    /* Eyes: held on the viewer (the camera) with constant tiny
       micro-saccades, and now and then a short glance aside or down before
       returning - fewer glances while she talks. */
    if (t > s.nextGlance) {
      const glance = Math.random() < (talking ? 0.25 : 0.4);
      if (glance) {
        const amp = talking ? 0.14 : 0.22; // radians: ~8 / ~13 degrees
        const side = Math.random() < 0.5 ? -1 : 1;
        s.fixation.set(side * amp * (0.6 + 0.4 * Math.random()), (Math.random() - 0.65) * amp * 0.5);
        s.nextGlance = t + 0.7 + Math.random() * 1.1;
      } else {
        s.fixation.set(0, 0);
        s.nextGlance = t + 2 + Math.random() * 3;
      }
    }
    if (t > s.nextSaccade) {
      // Micro-saccade: roughly 0.5-1.5 degrees around the fixation point.
      s.micro.set((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.03);
      s.nextSaccade = t + 0.35 + Math.random() * 0.9;
    }
    s.gazeTarget.set(
      s.fixation.x + s.micro.x + (target.gaze?.x ?? 0),
      s.fixation.y + s.micro.y + (target.gaze?.y ?? 0),
    );
    s.gaze.lerp(s.gazeTarget, 1 - Math.exp(-dt / 0.04));
    const headGaze = sp.headGaze.step(s.gaze.x, dt);

    /* Morph targets: mouth + face. */
    const w = frame.weights;
    const mouthRound = w[7] + w[8]; // O + U
    const pose = s.pose;
    const smile = (0.1 + Math.max(0, pose.smile) * 0.5) * (1 - talk * 0.35) * (1 - Math.min(1, mouthRound * 1.5));
    const browLift = pose.browUp * 0.5;
    // Lips follow viseme timing closely but without snapping.
    const kMouth = 1 - Math.exp(-dt / 0.055);
    // Eye direction via ARKit eye-look blendshapes when the model has them:
    // many exports do not skin the eyeballs to their eye bones, so rotating
    // the bones alone leaves the irises still.
    const lookX = rig.hasEyeLookMorphs ? Math.max(-1, Math.min(1, s.gaze.x / 0.35)) : 0;
    const lookY = rig.hasEyeLookMorphs ? Math.max(-1, Math.min(1, s.gaze.y / 0.25)) : 0;
    const kFace = 1 - Math.exp(-dt / 0.25);

    for (const m of rig.morphs) {
      const influences = m.mesh.morphTargetInfluences!;
      m.target.fill(0);
      for (let v = 1; v < VISEMES.length; v++) {
        if (w[v] < 0.001) continue;
        for (const [idx, weight] of m.visemes[v]) m.target[idx] += w[v] * weight;
      }
      const e = m.expressions;
      if (e.blinkL !== undefined) m.target[e.blinkL] += blink;
      if (e.blinkR !== undefined) m.target[e.blinkR] += blink;
      if (e.smileL !== undefined) m.target[e.smileL] += smile;
      if (e.smileR !== undefined) m.target[e.smileR] += smile;
      const cheek = smile * 0.4 + pose.cheekSquint;
      if (e.cheekSquintL !== undefined) m.target[e.cheekSquintL] += cheek;
      if (e.cheekSquintR !== undefined) m.target[e.cheekSquintR] += cheek;
      if (e.browUp !== undefined) m.target[e.browUp] += browLift;
      if (e.browUpR !== undefined) m.target[e.browUpR] += browLift;
      if (e.browOuterUpL !== undefined) m.target[e.browOuterUpL] += pose.browUp * 0.6;
      if (e.browOuterUpR !== undefined) m.target[e.browOuterUpR] += pose.browUp * 0.6;
      if (e.browDownL !== undefined) m.target[e.browDownL] += pose.browDown;
      if (e.browDownR !== undefined) m.target[e.browDownR] += pose.browDown;
      if (e.eyeWideL !== undefined) m.target[e.eyeWideL] += pose.eyeWide;
      if (e.eyeWideR !== undefined) m.target[e.eyeWideR] += pose.eyeWide;
      if (e.frownL !== undefined) m.target[e.frownL] += pose.mouthFrown;
      if (e.frownR !== undefined) m.target[e.frownR] += pose.mouthFrown;
      // +x = toward the viewer's right (verified on screen): left eye in,
      // right eye out.
      if (lookX > 0) {
        if (e.lookInL !== undefined) m.target[e.lookInL] += lookX;
        if (e.lookOutR !== undefined) m.target[e.lookOutR] += lookX;
      } else if (lookX < 0) {
        if (e.lookOutL !== undefined) m.target[e.lookOutL] += -lookX;
        if (e.lookInR !== undefined) m.target[e.lookInR] += -lookX;
      }
      if (lookY > 0) {
        if (e.lookUpL !== undefined) m.target[e.lookUpL] += lookY;
        if (e.lookUpR !== undefined) m.target[e.lookUpR] += lookY;
      } else if (lookY < 0) {
        if (e.lookDownL !== undefined) m.target[e.lookDownL] += -lookY;
        if (e.lookDownR !== undefined) m.target[e.lookDownR] += -lookY;
      }
      for (let i = 0; i < influences.length; i++) {
        const goal = Math.min(1, m.target[i]);
        // Blinks are not low-passed (they'd look sleepy); lips follow speech
        // closely; the rest of the face eases slowly like real expressions.
        const isBlink =
          i === e.blinkL || i === e.blinkR ||
          // Eye-look shapes follow the (already smoothed) gaze directly.
          i === e.lookInL || i === e.lookOutL || i === e.lookUpL || i === e.lookDownL ||
          i === e.lookInR || i === e.lookOutR || i === e.lookUpR || i === e.lookDownR;
        const k = isBlink ? 1 : m.mouth[i] ? kMouth : kFace;
        influences[i] += (goal - influences[i]) * k;
      }
    }

    /* Body: slow, layered, spring-smoothed world-axis rotations. */
    const j = rig.joints;
    const onClip = rig.hasIdle; // with an idle clip, add on top of it

    // Seated at the desk, everything is quieter: no weight shifts, hands stay
    // resting on the desk with only slight lifts while she talks.
    // Overall the body stays nearly still: small breaths and slow, slight
    // head drift only.
    const calm = rig.seated ? 0 : 0.5;
    // How much of the state-driven head pose to use.
    const poseK = rig.seated ? 0.3 : 0.5;
    const breathPeriod = 4.8 - 0.6 * talk;
    const breath = Math.sin((t * 2 * Math.PI) / breathPeriod); // -1..1
    const sway = drift(t, 1.3, 0.55) * calm; // weight shift, ~11s
    const lean = sp.lean.step(pose.chestPitch + (driver?.state() === "LISTENING" ? 0.03 : 0), dt);
    const nod = sp.nod.step(energy * talk * 0.025, dt);

    // Alternate the leading hand between phrases, slowly.
    if (t > s.nextGestureSwap && talk > 0.5) {
      s.gestureSide = Math.random() < 0.6 ? -s.gestureSide : s.gestureSide;
      s.nextGestureSwap = t + 2.5 + Math.random() * 2.5;
    }
    const phrase = 0.55 + 0.45 * Math.sin(t * 1.15 + 0.7); // slow rise and fall within speech
    // Seated, the hands stay resting on the desk (calm = 0): no gestures.
    const gestureAmount = talk * Math.min(1, 0.35 + energy * 0.9) * phrase * calm * 0.4;
    const gL = sp.gestureL.step(gestureAmount * (s.gestureSide === 1 ? 1 : 0.35), dt);
    const gR = sp.gestureR.step(gestureAmount * (s.gestureSide === -1 ? 1 : 0.35), dt);

    // Asymmetric resting pose: weight a little to one side, that shoulder a
    // touch lower, torso slightly turned, head gently tilted the other way.
    // Seated, the torso is essentially still (only a faint breath in the
    // chest); standing keeps a small weight shift.
    const breathK = rig.seated ? 0.5 : 1;
    j.pelvis?.set(0, sway * 0.02, 0.012 + sway * 0.012, onClip);
    j.spine?.set(breath * 0.004 * breathK + lean * 0.2, -0.015 - sway * 0.012, -sway * 0.008, onClip);
    j.chest?.set(breath * 0.008 * breathK + lean * 0.25, 0, 0.008, onClip);
    j.clavL?.set(0, 0, -0.02 - breath * 0.005 * breathK, onClip);
    j.clavR?.set(0, 0, 0.005 + breath * 0.005 * breathK, onClip);
    j.neck?.set(nod * 0.35 + pose.neckPitch * poseK, drift(t, 3.7, 0.5) * 0.004, 0, onClip);
    j.head?.set(
      drift(t, 4.9, 0.6) * 0.005 + nod + pose.headPitch * poseK,
      0.03 + drift(t, 6.1, 0.5) * 0.008 + pose.headYaw * poseK + headGaze * 0.06,
      0.035 + drift(t, 7.3, 0.4) * 0.005 + pose.headRoll * poseK,
      onClip,
    );

    // Arms: resting sway, plus explaining gestures that lift the forearm and
    // open the hand outward. `side` flips mirror-symmetric rotations.
    if (rig.handPins.length) {
      // Seated: after the torso has moved, pin each hand back onto the desk.
      rig.scene.updateMatrixWorld(true);
      for (const pin of rig.handPins) solveHandPin(pin);
    } else {
      for (const [upper, fore, hand, g, side] of [
        [j.upperL, j.foreL, j.handL, gL, 1],
        [j.upperR, j.foreR, j.handR, gR, -1],
      ] as const) {
        const idle = drift(t, side === 1 ? 8.2 : 9.4, 0.6);
        upper?.set(-g * 0.22 + idle * 0.012 + breath * 0.004, side * g * 0.05, side * (g * 0.1 + idle * 0.01), onClip);
        fore?.set(-g * 0.55 + idle * 0.02, side * g * 0.35, side * g * 0.1, onClip);
        hand?.set(-g * 0.15 + idle * 0.03, side * g * 0.25, side * (g * 0.35 + idle * 0.03), onClip);
      }
    }

    // Models without mouth blendshapes still open the jaw with the vowels.
    if (!rig.hasMouthMorphs) {
      const open = w[4] * 0.9 + w[5] * 0.45 + w[6] * 0.2 + w[7] * 0.6 + w[8] * 0.25;
      j.jaw?.set(Math.min(0.28, open * 0.22), 0, 0, onClip);
    }
    // +gaze.y looks up; a rotation about +X tips the forward axis down, hence the minus.
    if (!rig.hasEyeLookMorphs) {
      j.eyeL?.set(-s.gaze.y, s.gaze.x, 0, onClip);
      j.eyeR?.set(-s.gaze.y, s.gaze.x, 0, onClip);
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

function StudioLighting() {
  return (
    <>
      {/* Soft large key from front-left, cool fill, warm rim to separate hair from the panel. */}
      <directionalLight
        position={[-1.4, 2.2, 2.6]}
        intensity={1.9}
        color="#fff4ea"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={8}
        shadow-camera-left={-1.4}
        shadow-camera-right={1.4}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-0.4}
      />
      <directionalLight position={[1.8, 1.0, 1.8]} intensity={0.6} color="#e4ecff" />
      <directionalLight position={[0.2, 2.6, -2.6]} intensity={1.2} color="#fff0de" />
      <hemisphereLight args={["#ffffff", "#d7dbe4", 0.45]} />
    </>
  );
}

export default function TalkingAvatar({
  lipSync,
  driver,
  url = AVATAR_MODEL_URL,
  framing = "bust",
  onError,
  onReady,
}: {
  lipSync: LipSyncSource;
  driver?: AvatarDriver;
  url?: string;
  /** "desk": seated at a lab desk with the laboratory set around her, framed chest-up. */
  framing?: AvatarFraming;
  onError?: () => void;
  onReady?: () => void;
}) {
  const [layout, setLayout] = useState<DeskLayout | null>(null);
  return (
    <Canvas
      // 1.5x is visually indistinguishable here and keeps the frame rate steady.
      dpr={[1, 1.5]}
      // Soft (PCF) shadows from the key light onto her, the chair and the wall.
      shadows
      camera={{ fov: 22, position: [0, 1.3, 3] }}
      gl={{ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(0x000000, 0); // transparent: the character alone, no backdrop
        applyStudioEnvironment(gl, scene);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.domElement.addEventListener("webglcontextlost", () => onError?.());
      }}
    >
      <StudioLighting />
      <Suspense fallback={null}>
        <Avatar url={url} lipSync={lipSync} driver={driver} framing={framing} onReady={onReady} onLayout={setLayout} />
        {framing === "desk" && layout && <LabScene layout={layout} />}
      </Suspense>
    </Canvas>
  );
}
