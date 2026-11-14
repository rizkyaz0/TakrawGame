import * as THREE from "three";

// Gaya gambar tangan: shading kartun bertingkat, arsiran krayon di area gelap,
// dan garis tepi tinta yang sedikit "bergetar" (boil) seperti animasi gambar.

export const INK = 0x17131c;

export const styleUniforms = {
  uBoil: { value: 0 }, // berganti beberapa kali per detik
  uPx: { value: 1 }, // device pixel ratio, supaya goresan sama tebal di semua layar
  uSketch: { value: 1 }, // 1 = arsiran gambar tangan penuh, 0 = bahan polos (untuk gambar acuan)
};

const gradientMap = new THREE.DataTexture(new Uint8Array([105, 180, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

const NOISE_GLSL = /* glsl */ `
uniform float uBoil;
uniform float uPx;
uniform float uSketch;
float sk_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sk_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sk_hash(i), sk_hash(i + vec2(1.0, 0.0)), f.x),
             mix(sk_hash(i + vec2(0.0, 1.0)), sk_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const SKETCH_GLSL = /* glsl */ `
{
  vec2 sp = gl_FragCoord.xy / uPx;
  float baseL = max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.05);
  float lit = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)) / pow(baseL, 0.45);
  float wob = sk_noise(sp * 0.03 + uBoil * 3.7) * 7.0;
  float grain = sk_noise(sp * 0.8 + uBoil * 11.0);
  float l1 = abs(fract((sp.x + sp.y + wob) * 0.11) - 0.5) * 2.0;
  float l2 = abs(fract((sp.x - sp.y * 0.55 + wob * 1.3) * 0.07) - 0.5) * 2.0;
  float shadow = 1.0 - smoothstep(0.55, 0.9, lit);
  float stroke = smoothstep(0.5, 0.72, l1 + (grain - 0.5) * 0.6);
  gl_FragColor.rgb *= 1.0 - shadow * stroke * 0.42 * uSketch;
  float scrib = smoothstep(0.78, 0.95, l2 + (grain - 0.5) * 0.7);
  gl_FragColor.rgb *= 1.0 - scrib * 0.09 * uSketch;
  gl_FragColor.rgb += (grain - 0.5) * 0.045 * uSketch;
}
`;

function sketchify(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBoil = styleUniforms.uBoil;
    sh.uniforms.uPx = styleUniforms.uPx;
    sh.uniforms.uSketch = styleUniforms.uSketch;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${NOISE_GLSL}`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>\n${SKETCH_GLSL}`);
  };
}

export function toon(color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  sketchify(mat);
  return mat;
}

const outlineCache = new Map<string, THREE.MeshBasicMaterial>();

function outlineMaterial(thickness: number, color: number): THREE.MeshBasicMaterial {
  const key = `${thickness}:${color}`;
  let mat = outlineCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBoil = styleUniforms.uBoil;
      sh.uniforms.uT = { value: thickness };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uBoil;\nuniform float uT;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float ow = fract(sin(dot(position.xyz * 9.0 + uBoil, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
           transformed += normalize(normal) * uT * (0.7 + 0.6 * ow);`,
        );
    };
    // Tiap ketebalan butuh program sendiri karena nilainya menempel di uniform.
    mat.customProgramCacheKey = () => `outline:${key}`;
    outlineCache.set(key, mat);
  }
  return mat;
}

// Garis tepi dengan teknik "inverted hull": salinan mesh yang digembungkan,
// hanya sisi belakangnya yang digambar.
export function addOutline<T extends THREE.Mesh>(mesh: T, thickness = 0.022, color = INK): T {
  const mat = outlineMaterial(thickness, color);
  let hull: THREE.Mesh;
  if (mesh instanceof THREE.SkinnedMesh) {
    // Mesh berangka: garis tepinya ikut dikuliti dengan rangka yang sama.
    const sk = new THREE.SkinnedMesh(mesh.geometry, mat);
    sk.bind(mesh.skeleton, mesh.bindMatrix);
    sk.frustumCulled = false;
    hull = sk;
  } else {
    hull = new THREE.Mesh(mesh.geometry, mat);
  }
  hull.name = "outline";
  mesh.add(hull);
  return mesh;
}
