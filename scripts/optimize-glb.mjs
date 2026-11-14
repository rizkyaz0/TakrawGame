// Mengecilkan GLB hasil generator 3D AI (jutaan segitiga, tekstur 4096) jadi ±30 ribu segitiga, tekstur 1024 WebP, Draco.
// Pakai: node scripts/optimize-glb.mjs masuk.glb keluar.glb 0.02   (0.02 = sisakan 2% segitiga)
// Butuh sementara (tidak ada di package.json): npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer draco3dgltf sharp
import {NodeIO} from '@gltf-transform/core';
import {KHRDracoMeshCompression,KHRMaterialsSpecular} from '@gltf-transform/extensions';
import {weld,simplify,textureCompress,prune,center} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
const [,, inp,out,ratio]=process.argv;
await MeshoptSimplifier.ready;
const io=new NodeIO().registerExtensions([KHRDracoMeshCompression,KHRMaterialsSpecular]).registerDependencies({'draco3d.decoder':await draco3d.createDecoderModule(),'draco3d.encoder':await draco3d.createEncoderModule()});
const doc=await io.read(inp);
// buang peta normal & metal-roughness, game memakai toon
const mat=doc.getRoot().listMaterials()[0];
mat.setNormalTexture(null);mat.setMetallicRoughnessTexture(null);
mat.setMetallicFactor(0).setRoughnessFactor(0.6);
mat.getExtension('KHR_materials_specular')?.dispose();
await doc.transform(weld({tolerance:1e-6}),
  simplify({simplifier:MeshoptSimplifier,ratio:+ratio,error:0.01,lockBorder:false}),
  prune(),
  textureCompress({encoder:sharp,resize:[1024,1024],targetFormat:'webp',quality:82}));
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({method:KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,quantizePosition:14,quantizeTexcoord:12});
await io.write(out,doc);
const p=doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log('tris',p.getIndices().getCount()/3,'verts',p.getAttribute('POSITION').getCount());
