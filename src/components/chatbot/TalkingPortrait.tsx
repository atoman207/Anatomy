"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { emptyFrame } from "@/lib/voice/lipSync";
import type { AvatarDriver } from "./avatar/useAvatarController";
import type { LipSyncSource } from "./useAssistantVoice";

/**
 * The assistant, brought to life from a single upper-body photo in WebGL.
 *
 * No 3D model or streaming server is needed. Each frame the fragment shader
 * re-samples the photo through soft local warps:
 * - breathing: shoulders and chest rise and fall;
 * - hands: the raised hand gestures from the elbow and flexes at the wrist,
 *   the resting hand shifts slightly - more while speaking;
 * - head: sway, tilt and nods inside a face mask;
 * - mouth: the lower lip/jaw drops over a dark mouth interior, presses shut,
 *   widens or rounds, following the voice's visemes;
 * - eyes: blinks paint the lids down with a lash line.
 *
 * All warps are anchored to hand-measured landmarks of
 * `public/landing/assistant-persona-body.webp` (1024×1536). Replacing that
 * image means re-measuring `LANDMARKS`.
 */

export const PERSONA_BODY_SRC = "/landing/assistant-persona-body.webp";
const IMAGE_W = 1024;
const IMAGE_H = 1536;

const LANDMARKS = {
  mouth: [500, 366],
  mouthHalfWidth: 45,
  mouthCornerLift: 8,
  eyeLeft: [435, 249],
  eyeRight: [550, 240],
  eyeHalfWidth: 28,
  eyeHalfHeight: 9,
  browY: 212,
  face: [505, 300],
  faceRadii: [205, 245],
  /** Neck: the head rotates around this point. */
  neck: [505, 520],
  /** Raised (gesturing) hand: elbow pivot, wrist pivot, hand centre. */
  gestureElbow: [190, 1000],
  gestureWrist: [205, 805],
  gestureHand: [120, 745],
  /** Resting hand at the waist. */
  restWrist: [530, 1245],
  restHand: [450, 1350],
  /** Torso centre for breathing. */
  chest: [505, 820],
} as const;

export type PortraitFraming = "body" | "stage" | "thumb";

/** Visible height (image px) and focus point for each framing. */
const FRAMING: Record<PortraitFraming, { height: number; focus: [number, number] }> = {
  /** The whole upper body, hands included. */
  body: { height: 1480, focus: [505, 780] },
  /** Face and chest for wide, short containers. */
  stage: { height: 760, focus: [505, 520] },
  thumb: { height: 330, focus: [500, 310] },
};

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const L = LANDMARKS;
const f = (n: number) => n.toFixed(1);
const v2 = (p: readonly [number, number]) => `vec2(${f(p[0])}, ${f(p[1])})`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImg;
uniform vec2 uViewOrigin;
uniform vec2 uViewSize;
uniform float uJaw;
uniform float uWide;
uniform float uBlink;
uniform float uBrow;
uniform float uHeadRot;
uniform vec2 uHeadShift;
uniform float uBreath;
uniform float uElbow;
uniform float uWrist;
uniform float uRest;

const vec2 IMG = vec2(${f(IMAGE_W)}, ${f(IMAGE_H)});
const vec2 MOUTH = ${v2(L.mouth)};
const vec2 EYE_L = ${v2(L.eyeLeft)};
const vec2 EYE_R = ${v2(L.eyeRight)};
const vec2 FACE = ${v2(L.face)};
const vec2 FACE_R = ${v2(L.faceRadii)};
const vec2 NECK = ${v2(L.neck)};
const vec2 G_ELBOW = ${v2(L.gestureElbow)};
const vec2 G_WRIST = ${v2(L.gestureWrist)};
const vec2 G_HAND = ${v2(L.gestureHand)};
const vec2 R_WRIST = ${v2(L.restWrist)};
const vec2 R_HAND = ${v2(L.restHand)};
const vec2 CHEST = ${v2(L.chest)};
const float MOUTH_HW = ${f(L.mouthHalfWidth)};
const float CORNER_LIFT = ${f(L.mouthCornerLift)};
const float EYE_HW = ${f(L.eyeHalfWidth)};
const float EYE_HH = ${f(L.eyeHalfHeight)};
const float BROW_Y = ${f(L.browY)};

vec2 rotateAround(vec2 p, vec2 pivot, float angle) {
  // Inverse rotation: where did this output pixel come from?
  float c = cos(angle);
  float s = sin(angle);
  vec2 r = p - pivot;
  return vec2(c * r.x + s * r.y, -s * r.x + c * r.y) + pivot;
}

float ellipseMask(vec2 p, vec2 centre, vec2 radii, float inner, float outer) {
  return 1.0 - smoothstep(inner, outer, length((p - centre) / radii));
}

// Blink: paint the upper lid down over the eye (lid skin tone sampled from
// under the eye) with a dark lash line at its edge. Stretching the image
// instead smears the lashes into stripes.
vec3 blinkEye(vec3 color, vec2 p, vec2 eye) {
  if (uBlink < 0.02) return color;
  vec2 d = p - eye;
  float nx = d.x / EYE_HW;
  if (abs(nx) >= 1.0) return color;
  float hh = EYE_HH * sqrt(1.0 - nx * nx) + 1.5;
  float top = -hh - 2.0;
  float lidEdge = top + uBlink * (2.0 * hh + 2.0);
  float edgeFade = 1.0 - smoothstep(0.8, 1.0, abs(nx));
  float covered = (1.0 - smoothstep(lidEdge - 1.0, lidEdge + 0.5, d.y)) * smoothstep(top - 4.0, top + 1.0, d.y) * edgeFade;
  vec3 lid = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
      vec2 at = vec2(eye.x + d.x * 0.7 + float(j - 1) * 7.0, eye.y + EYE_HH + 10.0 + float(i) * 3.0);
      lid += texture2D(uImg, at / IMG).rgb;
    }
  }
  float shade = mix(0.99, 0.9, clamp((d.y - top) / max(lidEdge - top, 1.0), 0.0, 1.0));
  lid = lid / 9.0 * shade;
  color = mix(color, lid, covered);
  float lash = (1.0 - smoothstep(0.6, 2.0, abs(d.y - lidEdge))) * edgeFade * smoothstep(0.02, 0.3, uBlink);
  return mix(color, vec3(0.13, 0.09, 0.09), lash * 0.9);
}

void main() {
  vec2 p = uViewOrigin + vUv * uViewSize;

  // Breathing: everything above the hips rises a little with each breath,
  // most at the shoulders, fading out to the sides of the frame.
  float torso = smoothstep(1480.0, 640.0, p.y) * exp(-pow((p.x - CHEST.x) / 430.0, 2.0));
  p.y += uBreath * torso;

  // Gesturing arm: forearm swings from the elbow, the hand flexes at the wrist.
  float forearm = ellipseMask(p, mix(G_ELBOW, G_HAND, 0.55), vec2(190.0, 210.0), 0.55, 1.05);
  forearm *= smoothstep(G_ELBOW.y + 30.0, G_ELBOW.y - 90.0, p.y);
  p = mix(p, rotateAround(p, G_ELBOW, uElbow), forearm);
  float hand = ellipseMask(p, G_HAND, vec2(135.0, 85.0), 0.6, 1.05);
  p = mix(p, rotateAround(p, G_WRIST, uWrist), hand);

  // Resting hand: a small shift of the hand at the waist.
  float rest = ellipseMask(p, R_HAND, vec2(120.0, 150.0), 0.55, 1.05);
  p = mix(p, rotateAround(p, R_WRIST, uRest), rest);

  // Head sway / tilt / nod inside a soft face mask.
  float mHead = ellipseMask(p, FACE, FACE_R, 0.8, 1.2);
  vec2 q = mix(p, rotateAround(p - uHeadShift, NECK, uHeadRot), mHead);

  // Mouth width: widen for え/い, round for お/う.
  vec2 dm = (q - MOUTH) / vec2(72.0, 34.0);
  float mMouth = exp(-dot(dm, dm));
  q.x = MOUTH.x + (q.x - MOUTH.x) / (1.0 + uWide * mMouth);

  // Jaw: under the smile-curved lip line the lower lip/chin move by uJaw px.
  float nx = (q.x - MOUTH.x) / MOUTH_HW;
  float lineY = MOUTH.y - CORNER_LIFT * clamp(nx * nx, 0.0, 1.5);
  float depth = clamp((q.y - lineY) / 30.0, 0.0, 1.0);
  float xFall = exp(-pow(abs(nx) / mix(0.92, 1.9, depth), 6.0));
  float start = lineY + min(uJaw, 0.0) - 2.0;
  float below = smoothstep(start - 3.0, start + 1.0, q.y) * (1.0 - smoothstep(MOUTH.y + 40.0, 470.0, q.y));
  float shift = uJaw * xFall * below;
  vec2 src = vec2(q.x, q.y - shift);

  float inside = 1.0 - smoothstep(0.6, 1.0, abs(nx) / (1.0 + uWide * 0.8));
  float gap = 0.0;
  if (uJaw > 0.0) {
    gap = smoothstep(lineY - 1.0, lineY + 1.5, q.y)
        * (1.0 - smoothstep(lineY + shift - 2.5, lineY + shift, q.y))
        * inside;
  }

  vec2 db = (src - vec2(FACE.x, BROW_Y)) / vec2(120.0, 22.0);
  src.y += uBrow * exp(-dot(db, db));

  vec4 color = texture2D(uImg, clamp(src / IMG, 0.0, 1.0));
  vec3 interior = mix(vec3(0.30, 0.13, 0.14), vec3(0.12, 0.05, 0.06), clamp((q.y - lineY) / 8.0, 0.0, 1.0));
  color.rgb = mix(color.rgb, interior, gap * 0.95);
  color.rgb = blinkEye(color.rgb, src, EYE_L);
  color.rgb = blinkEye(color.rgb, src, EYE_R);
  gl_FragColor = color;
}`;

/** Smooth pseudo-noise from summed incommensurate sines, roughly -1..1. */
const wobble = (t: number, seed: number) =>
  (Math.sin(t * 0.37 + seed) + Math.sin(t * 0.71 + seed * 2.1) * 0.6 + Math.sin(t * 1.33 + seed * 3.7) * 0.3) / 1.9;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

const IDLE_LIPS: LipSyncSource = {
  sample: (out) => {
    out.weights.fill(0);
    out.weights[0] = 1;
    out.energy = 0;
    return out;
  },
  isSpeaking: () => false,
  time: () => -1,
};

/** Cover-fit a framing into a container of the given aspect (w/h). */
function viewFor(framing: PortraitFraming, aspect: number) {
  const fr = FRAMING[framing];
  let viewH = fr.height;
  let viewW = viewH * aspect;
  if (viewW > IMAGE_W) {
    viewW = IMAGE_W;
    viewH = viewW / aspect;
  }
  if (viewH > IMAGE_H) {
    viewH = IMAGE_H;
    viewW = viewH * aspect;
  }
  const x = Math.min(Math.max(fr.focus[0] - viewW / 2, 0), IMAGE_W - viewW);
  let y = Math.min(Math.max(fr.focus[1] - viewH / 2, 0), IMAGE_H - viewH);
  // Whole-body framing in a short container: keep the head in, crop the hips.
  if (framing === "body") y = Math.min(y, 110);
  return { x, y, w: viewW, h: viewH };
}

export function TalkingPortrait({
  lipSync = IDLE_LIPS,
  driver,
  framing = "body",
  className,
  alt = "研究アシスタント",
}: {
  lipSync?: LipSyncSource;
  driver?: AvatarDriver;
  framing?: PortraitFraming;
  className?: string;
  alt?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Until the first frame is drawn (or if WebGL fails) the still photo shows.
  const [live, setLive] = useState(false);
  const [aspect, setAspect] = useState(0.75);
  const inputs = useRef({ lipSync, driver });
  useEffect(() => {
    inputs.current = { lipSync, driver };
  }, [lipSync, driver]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      setAspect(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false });
    if (!gl) return () => observer.disconnect();

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return () => observer.disconnect();
    } catch {
      return () => observer.disconnect();
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uni = {
      viewOrigin: u("uViewOrigin"),
      viewSize: u("uViewSize"),
      jaw: u("uJaw"),
      wide: u("uWide"),
      blink: u("uBlink"),
      brow: u("uBrow"),
      headRot: u("uHeadRot"),
      headShift: u("uHeadShift"),
      breath: u("uBreath"),
      elbow: u("uElbow"),
      wrist: u("uWrist"),
      rest: u("uRest"),
    };

    // 1024×1536 is not power-of-two: WebGL1 needs CLAMP + no mipmaps.
    const texture = gl.createTexture();
    let textureReady = false;
    const img = new window.Image();
    img.decoding = "async";
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      textureReady = true;
    };
    img.src = PERSONA_BODY_SRC;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = emptyFrame();
    const s = {
      jaw: 0, wide: 0, energy: 0, talk: 0,
      blinkStart: -1, nextBlink: 1.2, double: false,
      tilt: 0, lift: 0, gesture: 0,
    };
    let last = performance.now() / 1000;
    let raf = 0;
    let shown = false;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!textureReady || document.hidden) return;
      const t = performance.now() / 1000;
      const dt = Math.min(0.1, t - last);
      last = t;
      const { lipSync: lips, driver: drv } = inputs.current;

      const w = lips.sample(frame).weights; // sil PP FF SS aa E I O U
      const open = w[4] + w[5] * 0.55 + w[6] * 0.3 + w[7] * 0.75 + w[8] * 0.4 + w[3] * 0.15 + w[2] * 0.1;
      const jawTarget = Math.min(13, open * 15) - w[1] * 7;
      const wideTarget = w[5] * 0.08 + w[6] * 0.1 + w[3] * 0.05 - w[7] * 0.16 - w[8] * 0.22;
      const k = 1 - Math.exp(-dt * 30);
      s.jaw += (jawTarget - s.jaw) * k;
      s.wide += (wideTarget - s.wide) * k;
      s.energy += (frame.energy - s.energy) * (1 - Math.exp(-dt * 8));
      s.talk += ((lips.isSpeaking() ? 1 : 0) - s.talk) * Math.min(1, dt * 2.5);

      if (s.blinkStart < 0 && t > s.nextBlink) {
        s.blinkStart = t;
        s.double = Math.random() < 0.15;
      }
      let blink = 0;
      if (s.blinkStart >= 0) {
        const bp = t - s.blinkStart;
        blink = bp < 0.07 ? bp / 0.07 : bp < 0.2 ? 1 - (bp - 0.07) / 0.13 : 0;
        if (bp >= 0.2) {
          if (s.double) {
            s.double = false;
            s.blinkStart = t + 0.08;
          } else {
            s.blinkStart = -1;
            s.nextBlink = t + 2 + Math.random() * 3.5;
          }
        }
      }

      // Conversation state body language: lean in to listen, glance up to think.
      const state = drv?.state();
      const tiltTarget = state === "LISTENING" ? 0.025 : state === "THINKING" ? -0.012 : 0;
      const liftTarget = state === "THINKING" ? -3 : state === "LISTENING" ? 2 : 0;
      s.tilt += (tiltTarget - s.tilt) * Math.min(1, dt * 3);
      s.lift += (liftTarget - s.lift) * Math.min(1, dt * 3);

      const motion = reducedMotion ? 0 : 1;
      const talk = s.talk;

      // Breathing: ~4.2s cycle at rest, a little quicker and deeper while talking.
      const breathRate = (Math.PI * 2) / (4.2 - 0.8 * talk);
      const breath = motion * (Math.sin(t * breathRate) * 0.5 + 0.5) * (3.5 + 1.5 * talk);

      // Hands: a slow idle drift, plus beat gestures that follow speech energy.
      s.gesture += (s.energy * talk - s.gesture) * (1 - Math.exp(-dt * 4));
      const beat = Math.sin(t * 3.1) * 0.6 + Math.sin(t * 1.7 + 1.3) * 0.4;
      // The raised hand sits at the image's left edge: swing mostly upward
      // (into the gesture) so the fingers never leave the frame.
      const elbow = motion * Math.max(-0.035, wobble(t, 7) * 0.025 + s.gesture * (0.5 + 0.5 * beat) * 0.11 + talk * 0.02);
      const wrist = motion * Math.max(-0.07, wobble(t, 8) * 0.04 + s.gesture * Math.sin(t * 2.3 + 0.5) * 0.12);
      const rest = motion * (wobble(t, 9) * 0.015 + s.gesture * Math.sin(t * 1.9 + 2.0) * 0.03);

      const nod = s.energy * 4 * talk + Math.sin(t * 5.3) * s.energy * 1 * talk;
      const headRot = motion * (wobble(t, 1) * 0.012 + wobble(t, 4) * 0.012 * talk + s.tilt);
      const shiftX = motion * (wobble(t, 2) * 2.5 + wobble(t, 5) * 1.5 * talk);
      const shiftY = motion * (wobble(t, 3) * 1.5 + nod + s.lift);

      const view = viewFor(framing, canvas.width / canvas.height);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uni.viewOrigin, view.x, view.y);
      gl.uniform2f(uni.viewSize, view.w, view.h);
      gl.uniform1f(uni.jaw, s.jaw);
      gl.uniform1f(uni.wide, s.wide);
      gl.uniform1f(uni.blink, blink);
      gl.uniform1f(uni.brow, s.energy * 2.5 * talk);
      gl.uniform1f(uni.headRot, headRot);
      gl.uniform2f(uni.headShift, shiftX, shiftY);
      gl.uniform1f(uni.breath, breath);
      gl.uniform1f(uni.elbow, elbow);
      gl.uniform1f(uni.wrist, wrist);
      gl.uniform1f(uni.rest, rest);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!shown) {
        shown = true;
        setLive(true);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      img.onload = null;
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [framing]);

  // Poster framed exactly like the canvas, so nothing jumps when WebGL starts.
  const view = viewFor(framing, aspect);
  const posterStyle = {
    width: `${(IMAGE_W / view.w) * 100}%`,
    height: `${(IMAGE_H / view.h) * 100}%`,
    left: `${(-view.x / view.w) * 100}%`,
    top: `${(-view.y / view.h) * 100}%`,
  };

  return (
    <div
      // Tailwind orders `relative` after `absolute`, so only add it when the
      // caller has not positioned us, or the portrait collapses to 0 height.
      className={cx("overflow-hidden bg-[#eef2f7]", !/\babsolute\b/.test(className ?? "") && "relative", className)}
      role="img"
      aria-label={alt}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- positioned to match the canvas crop, not a layout image */}
      <img
        src={PERSONA_BODY_SRC}
        alt=""
        aria-hidden
        className={cx("absolute max-w-none transition-opacity duration-300", live ? "opacity-0" : "opacity-100")}
        style={posterStyle}
      />
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/** A small static face crop of the persona, for message avatars. */
export function PersonaFace({ size = 32, className }: { size?: number; className?: string }) {
  const view = viewFor("thumb", 1);
  const scale = size / view.w;
  return (
    <span
      aria-hidden
      className={cx("inline-block shrink-0 overflow-hidden rounded-full bg-[#eef2f7]", className)}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${PERSONA_BODY_SRC})`,
        backgroundSize: `${IMAGE_W * scale}px ${IMAGE_H * scale}px`,
        backgroundPosition: `${-view.x * scale}px ${-view.y * scale}px`,
      }}
    />
  );
}
