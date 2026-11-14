import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { addOutline, toon } from "./style";

// Model properti dari 3DGarden (public/models/*.glb, terkompresi Draco). Supaya menyatu
// dengan gaya gambar tangan game, bahan aslinya diganti bahan kartun kita (dengan tekstur
// yang sama) dan diberi garis tepi tinta.

const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`));
const cache = new Map<string, Promise<THREE.Group>>();
const mats = new Map<string, THREE.Material>();

function restyle(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    let mat = mats.get(src.uuid);
    if (!mat) {
      mat = toon(src.color?.getHex() ?? 0xffffff, {
        map: src.map ?? null,
        side: THREE.DoubleSide,
        transparent: src.transparent,
        alphaTest: src.alphaTest,
      });
      mats.set(src.uuid, mat);
    }
    mesh.material = mat;
    mesh.castShadow = true;
    // Dipakai bersama oleh semua salinan: tidak boleh dibuang saat arena berganti.
    mesh.userData.shared = true;
    addOutline(mesh, 0.012).userData.shared = true;
    mesh.children[mesh.children.length - 1].userData.shared = true;
  }
}

// Mengembalikan salinan baru tiap dipanggil; file-nya hanya dimuat sekali.
export async function getModel(slug: string): Promise<THREE.Group> {
  let base = cache.get(slug);
  if (!base) {
    base = loader.loadAsync(`${import.meta.env.BASE_URL}models/${slug}.glb`).then((gltf) => {
      restyle(gltf.scene);
      return gltf.scene;
    });
    cache.set(slug, base);
  }
  return (await base).clone();
}

// Menaruh model dengan skala tertentu, berdiri tepat di ketinggian tanah yang diminta.
export function stand(obj: THREE.Object3D, x: number, groundY: number, z: number, scale: number, rotY = 0): void {
  obj.scale.setScalar(scale);
  obj.rotation.y = rotY;
  obj.position.set(x, 0, z);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y = groundY - box.min.y;
}
