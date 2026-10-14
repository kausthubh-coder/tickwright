import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BLOCKS,
  SIZE_X,
  SIZE_Y,
  SIZE_Z,
  MIN_X,
  MIN_Z,
  blockAt,
  type World,
  type Player,
  type Mob,
  type Drop,
} from "../../../packages/sim/src/world";

const palette = [0x000000, 0x79b88d, 0x83919b, 0xad8060, 0xffd477, 0xa3ddd2];
const box = new THREE.BoxGeometry(1, 1, 1);
const grassBox = box.clone();
const grassColors = [];
for (let i = 0; i < grassBox.attributes.position.count; i++) {
  const n = grassBox.attributes.normal.getY(i);
  const c = new THREE.Color(
    n > 0.5 ? 0x7cac81 : n < -0.5 ? 0x817568 : 0xa08062,
  );
  grassColors.push(c.r, c.g, c.b);
}
grassBox.setAttribute(
  "color",
  new THREE.Float32BufferAttribute(grassColors, 3),
);
const matrix = new THREE.Matrix4(),
  color = new THREE.Color();
const direction = new THREE.Vector3(),
  target = new THREE.Vector3(),
  point = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-10, -10);
const hits: THREE.Intersection[] = [];
const coatColors = [0x607bab, 0xc87d88, 0xbcb47c, 0x7eabb4, 0xa18abd, 0xd2a06b];
const material = (hex: number) => new THREE.MeshToonMaterial({ color: hex });
const sharedMaterials = new Map<number, THREE.MeshToonMaterial>();
function mat(hex: number) {
  if (!sharedMaterials.has(hex)) sharedMaterials.set(hex, material(hex));
  return sharedMaterials.get(hex)!;
}

export class IslandScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 250);
  readonly renderer: THREE.WebGLRenderer;
  readonly terrain = new THREE.Group();
  readonly decorations = new THREE.Group();
  readonly avatars = new Map<string, THREE.Group>();
  readonly selection = new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({ color: 0xfff6cb }),
  );
  readonly mobs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.48, 12, 8),
    mat(0x34294e),
    60,
  );
  readonly eyes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 0.16, 0.07),
    new THREE.MeshBasicMaterial({ color: 0x97fff2 }),
    120,
  );
  readonly loot = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.22),
    new THREE.MeshBasicMaterial({ color: 0xbc9cf7 }),
    128,
  );
  angle = Math.PI / 4;
  zoom = 40;
  layer = SIZE_Y;
  sight = false;
  hover: {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    block: number;
  } | null = null;
  private focus = new THREE.Vector3(-1, 5, 1);
  private terrainMeshes: THREE.InstancedMesh[] = [];
  private revision = -1;
  private builtLayer = -1;
  private lastPick = 0;
  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Tickwright game world",
    );
    this.renderer.domElement.tabIndex = 0;
    this.scene.fog = new THREE.Fog(0xc5d6d4, 90, 170);
    this.scene.add(new THREE.HemisphereLight(0xffedce, 0x66658e, 1.5));
    const sun = new THREE.DirectionalLight(0xffe2b1, 1.5);
    sun.position.set(-20, 35, 15);
    this.scene.add(sun);
    this.scene.add(
      this.terrain,
      this.decorations,
      this.selection,
      this.mobs,
      this.eyes,
      this.loot,
    );
    this.selection.scale.setScalar(1.015);
    this.selection.visible = false;
    this.mobs.count = this.eyes.count = this.loot.count = 0;
    this.mobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.loot.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mobs.frustumCulled =
      this.eyes.frustumCulled =
      this.loot.frustumCulled =
        false;
    this.decorate();
    this.resize();
    addEventListener("resize", () => this.resize());
    this.renderer.domElement.addEventListener("pointermove", (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    });
    this.renderer.domElement.addEventListener("pointerleave", () =>
      pointer.set(-10, -10),
    );
    this.renderer.domElement.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoom = THREE.MathUtils.clamp(
          this.zoom + event.deltaY * 0.025,
          19,
          75,
        );
      },
      { passive: false },
    );
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  private part(
    parent: THREE.Group,
    hex: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    geometry: THREE.BufferGeometry = box,
  ) {
    const mesh = new THREE.Mesh(geometry, mat(hex));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  private combine(group: THREE.Group) {
    group.updateMatrixWorld(true);
    const geometries: THREE.BufferGeometry[] = [];
    group.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        !(object.material instanceof THREE.MeshToonMaterial)
      )
        return;
      const geometry = (
        object.geometry.index
          ? object.geometry.toNonIndexed()
          : object.geometry.clone()
      ).applyMatrix4(object.matrixWorld);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = object.material.color.r;
        colors[i + 1] = object.material.color.g;
        colors[i + 2] = object.material.color.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.deleteAttribute("uv");
      geometries.push(geometry);
    });
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    group.clear();
    if (merged)
      group.add(
        new THREE.Mesh(
          merged,
          new THREE.MeshToonMaterial({ vertexColors: true }),
        ),
      );
  }
  private avatar(p: Player) {
    const group = new THREE.Group();
    const outline = 0x302c43,
      skin = 0xffdcc0,
      hair = 0x393b57,
      coat = coatColors[p.color % coatColors.length];
    this.part(group, outline, -0.18, 0.19, 0, 0.22, 0.38, 0.28);
    this.part(group, outline, 0.18, 0.19, 0, 0.22, 0.38, 0.28);
    this.part(group, coat, 0, 0.7, 0, 0.66, 0.67, 0.4);
    this.part(group, skin, 0, 1.28, -0.015, 0.68, 0.63, 0.56);
    this.part(group, hair, 0, 1.61, 0.015, 0.75, 0.16, 0.65);
    this.part(group, hair, -0.31, 1.39, 0.02, 0.18, 0.42, 0.62);
    this.part(group, hair, 0.25, 1.53, -0.28, 0.3, 0.26, 0.13);
    this.part(group, outline, -0.14, 1.3, -0.306, 0.075, 0.13, 0.025);
    this.part(group, outline, 0.14, 1.3, -0.306, 0.075, 0.13, 0.025);
    this.part(group, 0xdda86e, 0, 1.02, -0.22, 0.7, 0.13, 0.15);
    const scarf = this.part(group, 0xe4ad78, 0.3, 0.8, 0.22, 0.16, 0.65, 0.08);
    scarf.rotation.x = -0.3;
    const left = this.part(group, coat, -0.43, 0.69, 0, 0.19, 0.5, 0.23);
    left.name = "leftArm";
    const right = this.part(group, coat, 0.43, 0.69, 0, 0.19, 0.5, 0.23);
    right.name = "rightArm";
    const blade = this.part(
      group,
      0xe5e4cf,
      0.48,
      0.54,
      -0.25,
      0.06,
      0.75,
      0.13,
    );
    blade.rotation.x = -0.5;
    this.combine(group);
    const merged = (group.children[0] as THREE.Mesh).geometry;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(merged, 40),
      new THREE.LineBasicMaterial({
        color: 0x343543,
        transparent: true,
        opacity: 0.35,
      }),
    );
    group.add(edges);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({
        color: 0x383550,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    group.add(shadow);
    this.scene.add(group);
    this.avatars.set(p.id, group);
    return group;
  }
  private decorate() {
    const leaves = new THREE.IcosahedronGeometry(1, 1),
      cone = new THREE.ConeGeometry(1, 1, 6);
    for (const [x, z, size] of [
      [-3, -12, 1.6],
      [17, -4, 1.8],
      [13, 14, 1.4],
      [-7, 14, 1.6],
      [-15, 10, 1.3],
      [3, -16, 1.3],
    ]) {
      const tree = new THREE.Group();
      tree.position.set(x, 4, z);
      this.part(tree, 0x9e7761, 0, 1, 0, 0.4, 2, 0.4);
      this.part(tree, 0x8caf91, -0.5, 2.7, 0, size, size * 0.8, size, leaves);
      this.part(
        tree,
        0xb8c69a,
        0.5,
        3.2,
        0.1,
        size * 0.85,
        size * 0.75,
        size * 0.85,
        leaves,
      );
      this.part(tree, 0x6e9f88, 0, 2.4, -0.4, size, size * 0.7, size, leaves);
      this.decorations.add(tree);
    }
    for (let i = 0; i < 80; i++) {
      const x = ((i * 73) % 42) - 21,
        z = ((i * 31) % 34) - 17;
      if (
        (x / 23) ** 2 + (z / 18) ** 2 > 0.85 ||
        (x < -10 && z < 3) ||
        (x > 3 && x < 12 && z > 5 && z < 13)
      )
        continue;
      const plant = new THREE.Group();
      plant.position.set(x + 0.3, 4, z + 0.3);
      this.part(
        plant,
        i % 3 === 0 ? 0xe7bfaf : 0xa0c792,
        0,
        0.14,
        0,
        0.15,
        0.28,
        0.15,
        cone,
      );
      if (i % 3 === 0)
        this.part(plant, 0xf2ddbd, 0, 0.3, 0, 0.2, 0.15, 0.2, leaves);
      this.decorations.add(plant);
    }
    // Distant islands are scenery outside the build boundary.
    for (const [x, y, z, s] of [
      [-58, -1, -35, 8],
      [38, -7, -60, 12],
      [62, 2, 16, 7],
      [-52, -11, 43, 10],
    ]) {
      const island = new THREE.Group();
      island.position.set(x, y, z);
      this.part(island, 0x859898, 0, -s * 0.5, 0, s, s, s, cone).rotation.z =
        Math.PI;
      this.part(
        island,
        0x9ab49f,
        0,
        0,
        0,
        s * 0.92,
        0.5,
        s * 0.92,
        new THREE.CylinderGeometry(1, 1, 1, 6),
      );
      this.part(
        island,
        0x8faaa0,
        0,
        s * 0.25,
        0,
        s * 0.25,
        s * 0.5,
        s * 0.25,
        leaves,
      );
      this.decorations.add(island);
    }
    const altar = new THREE.Group();
    altar.position.set(8, 4, 11);
    this.part(altar, 0xb3aaa1, 0, 0.22, 0, 1.8, 0.44, 1.4);
    this.part(altar, 0x6a687e, 0, 0.58, 0, 1.1, 0.28, 0.9);
    const crystal = this.part(
      altar,
      0xb8dfd7,
      0,
      1.2,
      0,
      0.42,
      0.75,
      0.42,
      new THREE.OctahedronGeometry(1),
    );
    crystal.rotation.z = 0.1;
    this.decorations.add(altar);
    this.combine(this.decorations);
  }
  rebuild(w: World) {
    if (w.revision === this.revision && this.layer === this.builtLayer) return;
    this.revision = w.revision;
    this.builtLayer = this.layer;
    for (const mesh of this.terrainMeshes) {
      mesh.dispose();
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of mats) m.dispose();
    }
    this.terrain.clear();
    this.terrainMeshes = [];
    const buckets = new Map<string, { type: number; cells: number[] }>();
    for (let y = 0; y < Math.min(SIZE_Y, this.layer); y++)
      for (let z = MIN_Z; z < MIN_Z + SIZE_Z; z++)
        for (let x = MIN_X; x < MIN_X + SIZE_X; x++) {
          const type = blockAt(w, x, y, z);
          if (!type) continue;
          if (
            y + 1 < this.layer &&
            blockAt(w, x + 1, y, z) &&
            blockAt(w, x - 1, y, z) &&
            blockAt(w, x, y + 1, z) &&
            blockAt(w, x, y - 1, z) &&
            blockAt(w, x, y, z + 1) &&
            blockAt(w, x, y, z - 1)
          )
            continue;
          const key = `${Math.floor(x / 16)},${Math.floor(z / 16)},${type}`;
          if (!buckets.has(key)) buckets.set(key, { type, cells: [] });
          buckets.get(key)!.cells.push(x, y, z);
        }
    for (const { type, cells } of buckets.values()) {
      const base = material(palette[type]);
      let materials: THREE.Material | THREE.Material[] = base;
      if (type === 1) {
        base.color.setHex(0xffffff);
        base.vertexColors = true;
      }
      if (type === 4) {
        base.emissive.setHex(0xffb84f);
        base.emissiveIntensity = 0.6;
      }
      if (type === 5) {
        base.transparent = true;
        base.opacity = 0.45;
        base.depthWrite = false;
      }
      const mesh = new THREE.InstancedMesh(
        type === 1 ? grassBox : box,
        materials,
        cells.length / 3,
      );
      mesh.userData.cells = cells;
      for (let i = 0; i < cells.length; i += 3) {
        const [x, y, z] = [cells[i], cells[i + 1], cells[i + 2]];
        matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(i / 3, matrix);
        color.setScalar(0.92 + ((x * 31 + z * 17 + y * 11) & 7) * 0.012);
        mesh.setColorAt(i / 3, color);
      }
      mesh.computeBoundingSphere();
      this.terrain.add(mesh);
      this.terrainMeshes.push(mesh);
    }
  }
  update(
    w: World,
    players: Player[],
    mobs: Mob[],
    drops: Drop[],
    me: Player | undefined,
    dt: number,
    now: number,
  ) {
    this.rebuild(w);
    const easing = 1 - Math.exp(-10 * dt);
    if (me) {
      target.set(me.x, me.y + 1, me.z);
      this.focus.lerp(target, 1 - Math.exp(-5 * dt));
    }
    this.camera.position.set(
      this.focus.x + Math.sin(this.angle) * this.zoom,
      this.focus.y + this.zoom * 0.95,
      this.focus.z + Math.cos(this.angle) * this.zoom,
    );
    this.camera.lookAt(this.focus);
    for (const p of players) {
      const avatar = this.avatars.get(p.id) ?? this.avatar(p);
      target.set(p.x, p.y, p.z);
      if (avatar.userData.initialized) avatar.position.lerp(target, easing);
      else {
        avatar.position.copy(target);
        avatar.userData.initialized = true;
      }
      avatar.rotation.y = Math.atan2(-p.facingX, -p.facingZ);
      avatar.scale.y = p.dashCd > 20 ? 0.86 : 1;
    }
    for (const [id, avatar] of this.avatars)
      if (!players.some((p) => p.id === id)) {
        this.scene.remove(avatar);
        this.avatars.delete(id);
      }
    this.mobs.count = mobs.length;
    this.eyes.count = mobs.length * 2;
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i],
        bob = Math.abs(Math.sin(now * 0.005 + m.id)) * 0.12;
      matrix.makeScale(1, 0.78 + bob, 1);
      matrix.setPosition(m.x, m.y + 0.36 + bob, m.z);
      this.mobs.setMatrixAt(i, matrix);
      for (let side = 0; side < 2; side++) {
        matrix.makeTranslation(
          m.x + (side ? 0.15 : -0.15),
          m.y + 0.48 + bob,
          m.z + 0.41,
        );
        this.eyes.setMatrixAt(i * 2 + side, matrix);
      }
    }
    this.mobs.instanceMatrix.needsUpdate =
      this.eyes.instanceMatrix.needsUpdate = true;
    this.loot.count = drops.length;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      matrix.makeRotationY(now * 0.0015);
      matrix.setPosition(
        d.x,
        d.y + 0.25 + Math.sin(now * 0.003 + d.id) * 0.07,
        d.z,
      );
      this.loot.setMatrixAt(i, matrix);
    }
    this.loot.instanceMatrix.needsUpdate = true;
    if (now - this.lastPick > 80) {
      this.pick(w);
      this.lastPick = now;
    }
    this.renderer.render(this.scene, this.camera);
  }
  pick(w: World) {
    hits.length = 0;
    raycaster.setFromCamera(pointer, this.camera);
    raycaster.intersectObjects(this.terrainMeshes, false, hits);
    const hit = hits[0];
    if (hit?.instanceId !== undefined && hit.face) {
      const cells = hit.object.userData.cells as number[],
        i = hit.instanceId * 3;
      const x = cells[i],
        y = cells[i + 1],
        z = cells[i + 2];
      this.hover = {
        x,
        y,
        z,
        nx: hit.face.normal.x,
        ny: hit.face.normal.y,
        nz: hit.face.normal.z,
        block: blockAt(w, x, y, z),
      };
      this.selection.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.selection.visible = true;
    } else {
      this.hover = null;
      this.selection.visible = false;
    }
  }
  project(x: number, y: number, z: number) {
    point.set(x, y, z).project(this.camera);
    return {
      x: ((point.x + 1) * this.host.clientWidth) / 2,
      y: ((1 - point.y) * this.host.clientHeight) / 2,
    };
  }
  movement(x: number, z: number) {
    direction.set(
      Math.cos(this.angle) * x + Math.sin(this.angle) * z,
      0,
      -Math.sin(this.angle) * x + Math.cos(this.angle) * z,
    );
    return direction;
  }
  blockName() {
    return this.hover ? BLOCKS[this.hover.block] : "";
  }
}
