"use client";

import { useMemo } from "react";
import * as THREE from "three";

/**
 * A quiet, bright laboratory set for the seated assistant: a desk with
 * equipment in front of her, a chair behind her, and shelves of reagent
 * bottles and a softly lit window in the background.
 *
 * Built from primitives (no downloads) and placed from the character's
 * measured layout, so it fits any avatar's proportions.
 */

export interface DeskLayout {
  /** World y of the desk surface (where her forearms rest). */
  deskTop: number;
  /** World z of the desk edge nearest to her. */
  deskBackZ: number;
  centerX: number;
  /** World y of the chair seat and z of her back, for the chair. */
  seatY: number;
  backZ: number;
}

const DESK_WIDTH = 1.7;
const DESK_DEPTH = 0.75;

function useMaterials() {
  return useMemo(
    () => ({
      deskTop: new THREE.MeshStandardMaterial({ color: "#f4f6f8", roughness: 0.35, metalness: 0 }),
      deskEdge: new THREE.MeshStandardMaterial({ color: "#c9d1da", roughness: 0.5 }),
      wall: new THREE.MeshStandardMaterial({ color: "#e9eef3", roughness: 0.95 }),
      cabinet: new THREE.MeshStandardMaterial({ color: "#dfe5eb", roughness: 0.7 }),
      shelf: new THREE.MeshStandardMaterial({ color: "#cfd7df", roughness: 0.6 }),
      chair: new THREE.MeshStandardMaterial({ color: "#39424e", roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ color: "#9aa4ad", roughness: 0.3, metalness: 0.8 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: "#2f3540", roughness: 0.4, metalness: 0.6 }),
      whitePlastic: new THREE.MeshStandardMaterial({ color: "#f2f2f0", roughness: 0.4 }),
      // Plain transparency, not physical transmission: transmission renders
      // the whole scene a second time every frame, which made motion stutter.
      glass: new THREE.MeshPhysicalMaterial({
        color: "#dcecf5",
        roughness: 0.08,
        clearcoat: 1,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
      blueCap: new THREE.MeshStandardMaterial({ color: "#2f5bd3", roughness: 0.5 }),
      liquidBlue: new THREE.MeshStandardMaterial({ color: "#5aa9e6", roughness: 0.2, transparent: true, opacity: 0.8 }),
      liquidGreen: new THREE.MeshStandardMaterial({ color: "#6cc4a1", roughness: 0.2, transparent: true, opacity: 0.8 }),
      liquidAmber: new THREE.MeshStandardMaterial({ color: "#e0a458", roughness: 0.2, transparent: true, opacity: 0.85 }),
      window: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      paper: new THREE.MeshStandardMaterial({ color: "#fbfbf9", roughness: 0.9 }),
    }),
    [],
  );
}

type Mats = ReturnType<typeof useMaterials>;

function Microscope({ m, position }: { m: Mats; position: [number, number, number] }) {
  return (
    <group position={position} rotation={[0, -0.5, 0]}>
      <mesh material={m.whitePlastic} position={[0, 0.015, 0]}>
        <boxGeometry args={[0.16, 0.03, 0.2]} />
      </mesh>
      <mesh material={m.whitePlastic} position={[0, 0.14, -0.07]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.05, 0.25, 0.05]} />
      </mesh>
      <mesh material={m.darkMetal} position={[0, 0.1, 0.02]}>
        <boxGeometry args={[0.12, 0.012, 0.1]} />
      </mesh>
      <mesh material={m.darkMetal} position={[0, 0.2, -0.01]} rotation={[0.5, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.022, 0.16, 20]} />
      </mesh>
      <mesh material={m.metal} position={[0, 0.14, 0.03]}>
        <cylinderGeometry args={[0.012, 0.012, 0.05, 16]} />
      </mesh>
      <mesh material={m.darkMetal} position={[0, 0.275, -0.055]} rotation={[0.5, 0, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.06, 16]} />
      </mesh>
    </group>
  );
}

function Flask({ m, position, liquid }: { m: Mats; position: [number, number, number]; liquid: THREE.Material }) {
  // Erlenmeyer: cone body + neck, liquid in the lower part.
  return (
    <group position={position}>
      <mesh material={liquid} position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.035, 0.058, 0.06, 28]} />
      </mesh>
      <mesh material={m.glass} position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.018, 0.062, 0.14, 28, 1, true]} />
      </mesh>
      <mesh material={m.glass} position={[0, 0.17, 0]}>
        <cylinderGeometry args={[0.016, 0.018, 0.06, 20, 1, true]} />
      </mesh>
    </group>
  );
}

function Beaker({ m, position, liquid }: { m: Mats; position: [number, number, number]; liquid: THREE.Material }) {
  return (
    <group position={position}>
      <mesh material={liquid} position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.041, 0.041, 0.07, 28]} />
      </mesh>
      <mesh material={m.glass} position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.12, 28, 1, true]} />
      </mesh>
    </group>
  );
}

function TubeRack({ m, position }: { m: Mats; position: [number, number, number] }) {
  const liquids = [m.liquidBlue, m.liquidAmber, m.liquidGreen, m.liquidBlue, m.liquidAmber];
  return (
    <group position={position} rotation={[0, 0.25, 0]}>
      <mesh material={m.whitePlastic} position={[0, 0.06, 0]}>
        <boxGeometry args={[0.22, 0.012, 0.06]} />
      </mesh>
      <mesh material={m.whitePlastic} position={[0, 0.006, 0]}>
        <boxGeometry args={[0.22, 0.012, 0.06]} />
      </mesh>
      {liquids.map((liquid, i) => (
        <group key={i} position={[-0.08 + i * 0.04, 0, 0]}>
          <mesh material={liquid} position={[0, 0.045, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.06, 12]} />
          </mesh>
          <mesh material={m.glass} position={[0, 0.07, 0]}>
            <cylinderGeometry args={[0.01, 0.01, 0.12, 12, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ReagentBottle({ m, position, scale = 1 }: { m: Mats; position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh material={m.glass} position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.14, 24]} />
      </mesh>
      <mesh material={m.liquidBlue} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 0.09, 24]} />
      </mesh>
      <mesh material={m.blueCap} position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.035, 20]} />
      </mesh>
    </group>
  );
}

export function LabScene({ layout }: { layout: DeskLayout }) {
  const m = useMaterials();
  const { deskTop, deskBackZ, centerX: cx, seatY, backZ } = layout;
  const deskZ = deskBackZ + DESK_DEPTH / 2;
  const wallZ = backZ - 1.6;

  return (
    <group>
      {/* Desk */}
      <mesh material={m.deskTop} position={[cx, deskTop - 0.02, deskZ]} receiveShadow>
        <boxGeometry args={[DESK_WIDTH, 0.04, DESK_DEPTH]} />
      </mesh>
      <mesh material={m.deskEdge} position={[cx, deskTop - 0.3, deskBackZ + DESK_DEPTH - 0.02]}>
        <boxGeometry args={[DESK_WIDTH, 0.52, 0.02]} />
      </mesh>

      {/* Equipment, kept to the sides so her hands and face stay clear */}
      <Microscope m={m} position={[cx + 0.4, deskTop, deskBackZ + 0.12]} />
      <Flask m={m} position={[cx - 0.36, deskTop, deskBackZ + 0.14]} liquid={m.liquidBlue} />
      <Beaker m={m} position={[cx - 0.47, deskTop, deskBackZ + 0.05]} liquid={m.liquidGreen} />
      <TubeRack m={m} position={[cx - 0.3, deskTop, deskBackZ + 0.36]} />
      <mesh material={m.paper} position={[cx + 0.22, deskTop + 0.004, deskBackZ + 0.36]} rotation={[0, 0.15, 0]}>
        <boxGeometry args={[0.21, 0.008, 0.297]} />
      </mesh>

      {/* Chair back behind her */}
      <mesh material={m.chair} position={[cx, seatY + 0.36, backZ - 0.1]} castShadow receiveShadow>
        <boxGeometry args={[0.42, 0.5, 0.06]} />
      </mesh>

      {/* Back wall, counter cabinet, shelves with reagent bottles */}
      <mesh material={m.wall} position={[cx, 1.6, wallZ]} receiveShadow>
        <planeGeometry args={[8, 4]} />
      </mesh>
      <mesh material={m.cabinet} position={[cx, 0.45, wallZ + 0.3]} receiveShadow>
        <boxGeometry args={[4, 0.9, 0.6]} />
      </mesh>
      <mesh material={m.deskTop} position={[cx, 0.92, wallZ + 0.3]}>
        <boxGeometry args={[4, 0.04, 0.62]} />
      </mesh>
      {[1.45, 1.85].map((y) => (
        <mesh key={y} material={m.shelf} position={[cx + 0.6, y, wallZ + 0.14]}>
          <boxGeometry args={[2.2, 0.03, 0.28]} />
        </mesh>
      ))}
      {[-0.35, -0.15, 0.1, 0.3, 0.9, 1.1, 1.3].map((x, i) => (
        <ReagentBottle key={`a${x}`} m={m} position={[cx + x, 1.465, wallZ + 0.14]} scale={i % 3 === 0 ? 1.2 : 1} />
      ))}
      {[0.0, 0.2, 0.75, 0.95, 1.5].map((x) => (
        <ReagentBottle key={`b${x}`} m={m} position={[cx + x, 1.865, wallZ + 0.14]} scale={0.9} />
      ))}
      <Beaker m={m} position={[cx - 0.9, 0.94, wallZ + 0.3]} liquid={m.liquidAmber} />
      <Flask m={m} position={[cx - 1.1, 0.94, wallZ + 0.35]} liquid={m.liquidGreen} />

      {/* Softly glowing window on the left */}
      <mesh material={m.window} position={[cx - 1.9, 1.7, wallZ + 0.01]}>
        <planeGeometry args={[1.3, 1.5]} />
      </mesh>

      {/* Window light and room fill */}
      <directionalLight position={[cx - 2.5, 2.4, deskZ + 0.5]} intensity={1.1} color="#f4f8ff" />
      <pointLight position={[cx + 1.5, 2.2, wallZ + 1]} intensity={1.2} distance={5} color="#fff3e6" />
    </group>
  );
}
