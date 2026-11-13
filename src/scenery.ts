import * as THREE from "three";
import { COURT_HALF, NET_H, NET_R } from "./sim";
import { addOutline, toon } from "./style";

// Arena: lapangan kampung saat lomba 17-an. Semua dari bentuk dasar + shader gambar tangan.

const DEPTH = 7;

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 512;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#2f8fd0");
  grad.addColorStop(0.45, "#7fcbe6");
  grad.addColorStop(0.72, "#fbe7b4");
  grad.addColorStop(1, "#f6b77a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function house(w: number, h: number, d: number, wall: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  const body = addOutline(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toon(wall)), 0.06);
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  const top = addOutline(new THREE.Mesh(new THREE.ConeGeometry(1, h * 0.55, 4), toon(roof)), 0.06);
  top.rotation.y = Math.PI / 4;
  top.scale.set(w * 0.82, 1, d * 0.82);
  top.position.y = h + h * 0.27;
  g.add(top);
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.2, h * 0.55, 0.05), toon(0x5a3a28));
  door.position.set(-w * 0.2, h * 0.275, d / 2 + 0.02);
  g.add(door);
  const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.26, h * 0.26, 0.05), toon(0xffe9a0));
  win.position.set(w * 0.2, h * 0.58, d / 2 + 0.02);
  g.add(win);
  return g;
}

function palm(height: number): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = toon(0x9a6b43);
  const leafMat = toon(0x3f9a4c);
  const segs = 5;
  let x = 0;
  for (let i = 0; i < segs; i++) {
    const seg = addOutline(
      new THREE.Mesh(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, height / segs + 0.05, 7), trunkMat),
      0.05,
    );
    x += i * 0.07;
    seg.position.set(x, (i + 0.5) * (height / segs), 0);
    seg.rotation.z = -i * 0.06;
    g.add(seg);
  }
  for (let k = 0; k < 7; k++) {
    const leaf = addOutline(new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.8, 5), leafMat), 0.05);
    const a = (k / 7) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(x + 0.1, height, 0);
    pivot.rotation.y = a;
    leaf.scale.z = 0.35;
    leaf.rotation.z = -1.95;
    leaf.position.set(1.2, -0.45, 0);
    pivot.add(leaf);
    g.add(pivot);
  }
  return g;
}

function cloud(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfffdf4 });
  const blobs: Array<[number, number, number]> = [
    [0, 0, 1.6], [1.7, 0.3, 1.9], [3.5, 0, 1.5], [1.2, -0.5, 1.5], [2.6, -0.5, 1.4],
  ];
  for (const [x, y, r] of blobs) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 18), mat);
    m.position.set(x, y, 0);
    g.add(m);
  }
  return g;
}

interface Fan {
  body: THREE.Object3D;
  baseY: number;
  phase: number;
}

export class Scenery {
  private clouds: THREE.Group[] = [];
  private flags: THREE.Mesh[] = [];
  private fans: Fan[] = [];
  private cheerUntil = 0;

  constructor(scene: THREE.Scene) {
    scene.background = skyTexture();

    // Matahari dan awan sebagai potongan datar jauh di belakang.
    const sun = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    sun.position.set(-16, 15, -58);
    scene.add(sun);
    const spots: Array<[number, number, number]> = [[-22, 16, 1.5], [-2, 19, 1.9], [17, 15, 1.4], [30, 20, 1.7]];
    for (const [x, y, sc] of spots) {
      const c = cloud();
      c.position.set(x, y, -55);
      c.scale.setScalar(sc);
      scene.add(c);
      this.clouds.push(c);
    }

    // Bukit.
    const hills: Array<[number, number, number, number]> = [
      [-20, -34, 20, 0x6aa85a], [12, -40, 26, 0x5d9c58], [36, -32, 18, 0x74b262],
    ];
    for (const [x, z, r, color] of hills) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 12), toon(color));
      hill.scale.y = 0.42;
      hill.position.set(x, -2, z);
      scene.add(hill);
    }

    // Tanah berumput dan lapangan semen.
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 140), toon(0x7dbb5a));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.3;
    grass.receiveShadow = true;
    scene.add(grass);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(COURT_HALF * 2 + 1.2, 0.3, DEPTH + 1.2), toon(0xcdb98c));
    slab.position.y = -0.16;
    slab.receiveShadow = true;
    scene.add(slab);
    const tints = [0xe6cfa0, 0xdcd0a6];
    for (let i = 0; i < 2; i++) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(COURT_HALF, 0.02, DEPTH), toon(tints[i]));
      half.position.set((i === 0 ? -1 : 1) * (COURT_HALF / 2), -0.005, 0);
      half.receiveShadow = true;
      scene.add(half);
    }

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0 });
    const addLine = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), lineMat);
      m.position.set(x, 0.012, z);
      scene.add(m);
    };
    addLine(0, DEPTH / 2 - 0.06, COURT_HALF * 2, 0.12);
    addLine(0, -DEPTH / 2 + 0.06, COURT_HALF * 2, 0.12);
    addLine(-COURT_HALF + 0.06, 0, 0.12, DEPTH);
    addLine(COURT_HALF - 0.06, 0, 0.12, DEPTH);
    addLine(0, 0, 0.12, DEPTH);

    // Net.
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(NET_R * 2, NET_H - 0.7, DEPTH - 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2a2733, transparent: true, opacity: 0.35 }),
    );
    net.position.set(0, 0.7 + (NET_H - 0.7) / 2, 0);
    scene.add(net);
    const tape = addOutline(new THREE.Mesh(new THREE.BoxGeometry(NET_R * 2 + 0.06, 0.16, DEPTH - 0.4), toon(0xfffaf0)), 0.03);
    tape.position.set(0, NET_H - 0.08, 0);
    tape.castShadow = true;
    scene.add(tape);
    const bamboo = toon(0xc9a85a);
    for (const z of [-1, 1]) {
      const post = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, NET_H + 0.3, 8), bamboo), 0.03);
      post.position.set(0, (NET_H + 0.3) / 2, z * (DEPTH / 2 - 0.2));
      post.castShadow = true;
      scene.add(post);
    }

    // Tiang bambu di tepi lapangan: batas pantul bola, sekaligus tiang umbul-umbul.
    const POLE_H = 8.4;
    for (const sx of [-1, 1]) {
      for (const z of [-DEPTH / 2, DEPTH / 2]) {
        const pole = addOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, POLE_H, 8), bamboo), 0.035);
        pole.position.set(sx * (COURT_HALF + 0.15), POLE_H / 2 - 0.2, z);
        pole.castShadow = true;
        scene.add(pole);
      }
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(DEPTH, 13),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      wall.rotation.y = Math.PI / 2;
      wall.position.set(sx * COURT_HALF, 6.5, 0);
      scene.add(wall);
    }

    // Umbul-umbul merah putih melintang di belakang lapangan.
    const flagGeo = new THREE.ShapeGeometry(
      new THREE.Shape([new THREE.Vector2(-0.24, 0), new THREE.Vector2(0.24, 0), new THREE.Vector2(0, -0.62)]),
    );
    const red = new THREE.MeshBasicMaterial({ color: 0xe5392d, side: THREE.DoubleSide });
    const white = new THREE.MeshBasicMaterial({ color: 0xfffaf0, side: THREE.DoubleSide });
    const span = COURT_HALF + 0.15;
    const ropePts: THREE.Vector3[] = [];
    const COUNT = 26;
    for (let i = 0; i <= COUNT; i++) {
      const u = i / COUNT;
      const x = lerpN(-span, span, u);
      const y = POLE_H - 0.5 - Math.sin(u * Math.PI) * 1.3;
      ropePts.push(new THREE.Vector3(x, y, -DEPTH / 2));
      if (i === 0 || i === COUNT) continue;
      const flag = new THREE.Mesh(flagGeo, i % 2 === 0 ? red : white);
      flag.position.set(x, y, -DEPTH / 2);
      scene.add(flag);
      this.flags.push(flag);
    }
    const rope = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ropePts),
      new THREE.LineBasicMaterial({ color: 0x17131c }),
    );
    scene.add(rope);

    // Deretan rumah dan warung.
    const row: Array<[number, number, number, number, number, number]> = [
      [-19, 5.5, 4.2, 0xf2d7a8, 0xc5563a, -13],
      [-12.5, 4.6, 3.6, 0x9fd6cf, 0xa8452f, -12],
      [-6, 5.8, 4.6, 0xf6b9a0, 0x7d4a36, -13.5],
      [1.5, 4.4, 3.4, 0xf7e7b6, 0xc5563a, -12],
      [8, 5.4, 4.4, 0xb7c9ef, 0x8a4630, -13],
      [14.5, 4.8, 3.8, 0xf2d7a8, 0xa8452f, -12.5],
      [21, 5.6, 4.4, 0xc9e5a8, 0x7d4a36, -13.5],
    ];
    for (const [x, w, h, wall, roof, z] of row) {
      const hs = house(w, h, 4, wall, roof);
      hs.position.set(x, -0.3, z);
      scene.add(hs);
    }
    // Tenda warung bergaris di depan salah satu rumah.
    const awning = addOutline(new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 1.6), toon(0xe5392d)), 0.05);
    awning.position.set(1.5, 2.3, -9.4);
    awning.rotation.x = 0.25;
    scene.add(awning);

    // Penonton: dua baris jajanan kecil di belakang lapangan, baris belakang di atas bangku.
    const bench = addOutline(new THREE.Mesh(new THREE.BoxGeometry(COURT_HALF * 2 + 1, 0.5, 0.9), toon(0xa9744a)), 0.04);
    bench.position.set(0, -0.05, -5.75);
    scene.add(bench);
    const fanColors = [0xd4583c, 0x5aa852, 0xa98470, 0xe9b95a, 0xf6cf2f, 0x86dcf0, 0xf7d03a, 0xe88fb0, 0x9a66e0];
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeInk = new THREE.MeshBasicMaterial({ color: 0x17131c });
    for (let row = 0; row < 2; row++) {
      for (let k = 0; k < 15; k++) {
        const x = -7.6 + k * 1.085 + (row === 1 ? 0.5 : 0);
        if (row === 1 && k === 14) continue;
        const kind = (k * 7 + row * 3) % 3;
        const fan = new THREE.Group();
        const geo =
          kind === 0
            ? new THREE.CapsuleGeometry(0.26, 0.3, 4, 12)
            : kind === 1
              ? new THREE.SphereGeometry(0.36, 14, 10)
              : new THREE.CylinderGeometry(0.26, 0.3, 0.72, 12);
        const body = addOutline(new THREE.Mesh(geo, toon(fanColors[(k * 5 + row * 4) % fanColors.length])), 0.03);
        body.position.y = 0.4;
        fan.add(body);
        for (const ex of [-0.1, 0.1]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeWhite);
          eye.position.set(ex, 0.5, kind === 1 ? 0.3 : 0.24);
          eye.scale.z = 0.4;
          fan.add(eye);
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeInk);
          pupil.position.set(ex, 0.5, kind === 1 ? 0.33 : 0.27);
          pupil.scale.z = 0.4;
          fan.add(pupil);
        }
        const baseY = row === 0 ? 0 : 0.2;
        fan.position.set(x, baseY, row === 0 ? -4.7 : -5.7);
        scene.add(fan);
        this.fans.push({ body: fan, baseY, phase: k * 1.7 + row * 0.9 });
      }
    }

    const palms: Array<[number, number, number]> = [[-15.5, -9, 7.5], [-9.5, -10.5, 6.2], [11.5, -9.5, 7], [18, -10, 8]];
    for (const [x, z, h] of palms) {
      const p = palm(h);
      p.position.set(x, -0.3, z);
      scene.add(p);
    }
  }

  // Penonton melonjak bersama selama beberapa saat.
  cheer(seconds = 1.2): void {
    this.cheerUntil = Math.max(this.cheerUntil, performance.now() / 1000 + seconds);
  }

  update(timeSec: number, excite = 0): void {
    // Penonton memantul; makin tegang makin cepat dan tinggi.
    const cheering = timeSec < this.cheerUntil;
    const amp = cheering ? 0.55 : 0.04 + excite * 0.28;
    const speed = cheering ? 13 : 4 + excite * 7;
    for (const fan of this.fans) {
      const hop = Math.abs(Math.sin(timeSec * speed + fan.phase));
      fan.body.position.y = fan.baseY + hop * amp;
      fan.body.scale.y = 1 + hop * amp * 0.25;
      fan.body.rotation.z = Math.sin(timeSec * speed * 0.5 + fan.phase) * (cheering ? 0.2 : 0.05 + excite * 0.1);
    }

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += 0.004 * (1 + i * 0.3);
      if (c.position.x > 48) c.position.x = -48;
    }
    // Bendera berkibar; ikut waktu nyata supaya tetap hidup saat hitstop.
    const step = Math.floor(timeSec * 10);
    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i].rotation.x = Math.sin(step * 0.5 + i * 0.9) * 0.3;
      this.flags[i].rotation.z = Math.sin(step * 0.35 + i * 1.7) * 0.12;
    }
  }
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
