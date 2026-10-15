import * as THREE from "three";
import { ENGINE, skyScale, solid } from "../../../packages/sim/src/codex/engine";
import type { World, Player } from "../../../packages/sim/src/world";
import type { MeshData } from "../../../packages/sim/src/mesh";

export interface Hover { x: number; y: number; z: number; nx: number; ny: number; nz: number; block: number }
export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 420);
  readonly renderer: THREE.WebGLRenderer;
  readonly terrain = new Map<string, THREE.Mesh>();
  readonly avatars = new Map<string, THREE.Mesh>();
  readonly worker = new Worker(new URL("./mesh.worker.ts", import.meta.url), { type: "module" });
  readonly selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005,1.005,1.005)), new THREE.LineBasicMaterial({ color: 0xffefab }));
  readonly material = new THREE.ShaderMaterial({
    uniforms: { daylight: { value: 1 }, fogColor: { value: new THREE.Color(0xbacfd9) } },
    vertexColors: true,
    vertexShader: `attribute vec2 light; varying vec3 vColor; varying vec2 vLight; varying float vShade; varying float vDistance;
      void main(){vColor=color;vLight=light;vShade=0.68+0.32*max(0.0,dot(normal,normalize(vec3(-0.4,0.8,0.2))));vec4 p=modelViewMatrix*vec4(position,1.0);vDistance=length(p.xyz);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform float daylight;uniform vec3 fogColor;varying vec3 vColor;varying vec2 vLight;varying float vShade;varying float vDistance;
      void main(){float brightness=0.035+0.965*max(vLight.x*daylight,vLight.y);vec3 c=vColor*brightness*vShade;gl_FragColor=vec4(mix(c,fogColor,smoothstep(280.0,384.0,vDistance)),1.0);}`,
  });
  yaw = 0;
  pitch = -0.25;
  firstPerson = false;
  hover: Hover | null = null;
  generation = 0;
  meshJobs = 0;
  private focus = new THREE.Vector3();
  private initialized = false;
  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private target = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private avatarGeometry = new THREE.BoxGeometry(0.6, ENGINE.bodyHeight, 0.5);
  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setClearColor(0xbacfd9);
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Tickwright game world");
    this.selection.visible = false; this.scene.add(this.selection);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x707060, 2));
    this.worker.onmessage = (event: MessageEvent<MeshData & { type: string; key: string; generation: number }>) => {
      const data = event.data; if (data.generation !== this.generation) return;
      const old = this.terrain.get(data.key);
      if (old) { old.geometry.dispose(); this.scene.remove(old); this.terrain.delete(data.key); }
      if (data.type === "empty" || !data.indices.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
      geometry.setAttribute("light", new THREE.BufferAttribute(data.lights, 2));
      geometry.setIndex(new THREE.BufferAttribute(data.indices, 1)); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material); this.terrain.set(data.key, mesh); this.scene.add(mesh);
      this.meshJobs++;
    };
    this.worker.onerror = event => console.error("Chunk worker failed", event.message);
    window.addEventListener("resize", () => this.resize()); this.resize();
    this.renderer.domElement.addEventListener("pointermove", event => {
      if (document.pointerLockElement === this.renderer.domElement) {
        this.yaw -= event.movementX * 0.002; this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.002, -1.5, 1.5);
        this.pointer.set(0, 0);
      } else this.pointer.set(event.clientX / this.host.clientWidth * 2 - 1, 1 - event.clientY / this.host.clientHeight * 2);
    });
  }
  async lock() {
    try { await this.renderer.domElement.requestPointerLock({ unadjustedMovement: true }); }
    catch { try { await this.renderer.domElement.requestPointerLock(); } catch { /* The visible Resume button lets the player retry. */ } }
  }
  resize() { this.renderer.setSize(this.host.clientWidth, this.host.clientHeight); this.camera.aspect = this.host.clientWidth / this.host.clientHeight; this.camera.updateProjectionMatrix(); }
  reset(seed: number, mode: string) {
    this.generation++; this.initialized = false; this.meshJobs = 0;
    for (const mesh of this.terrain.values()) { this.scene.remove(mesh); mesh.geometry.dispose(); } this.terrain.clear();
    this.worker.postMessage({ type: "reset", seed, mode, generation: this.generation });
  }
  packet(buffer: ArrayBuffer) { this.worker.postMessage({ type: "packet", buffer }, [buffer]); }
  edit(x: number, y: number, z: number, block: number) { this.worker.postMessage({ type: "edit", x, y, z, block }); }
  unload(key: string) {
    const [cx, cz] = key.split(",");
    for (let sy = 0; sy < 6; sy++) {
      const sk = `${cx},${sy},${cz}`, mesh = this.terrain.get(sk);
      if (mesh) { mesh.geometry.dispose(); this.scene.remove(mesh); this.terrain.delete(sk); }
    }
    this.worker.postMessage({ type: "unload", key });
  }
  update(world: World, players: Player[], me: Player | undefined, dt: number) {
    const daylight = skyScale(world.tick), fog = this.material.uniforms.fogColor.value as THREE.Color;
    fog.setRGB(0.73 * daylight, 0.81 * daylight, 0.85 * daylight);
    this.material.uniforms.daylight.value = daylight; this.renderer.setClearColor(fog);
    if (me) {
      this.target.set(me.x, me.y + 1.5, me.z);
      if (!this.initialized) { this.focus.copy(this.target); this.initialized = true; }
      this.focus.lerp(this.target, 1 - Math.exp(-25 * dt));
      this.direction.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      this.camera.position.copy(this.focus);
      if (!this.firstPerson) {
        this.target.copy(this.focus).addScaledVector(this.direction, -4.8);
        this.target.x += Math.cos(this.yaw) * 0.65; this.target.z -= Math.sin(this.yaw) * 0.65;
        const displacement = this.target.clone().sub(this.focus), distance = displacement.length(); displacement.normalize();
        for (let d = 0.1; d < distance; d += 0.1) {
          const point = this.focus.clone().addScaledVector(displacement, d);
          if (solid(world.peek(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)))) { this.target.copy(this.focus).addScaledVector(displacement, Math.max(0, d - 0.2)); break; }
        }
        this.camera.position.copy(this.target);
      }
      this.camera.lookAt(this.camera.position.clone().add(this.direction)); this.camera.updateMatrixWorld();
    }
    for (const p of players) {
      let avatar = this.avatars.get(p.id);
      if (!avatar) { avatar = new THREE.Mesh(this.avatarGeometry, new THREE.MeshLambertMaterial({ color: [0x426dba,0xcb6572,0xc8b959,0x50a69e,0x906bb0,0xc88a4c][p.color % 6] })); this.avatars.set(p.id, avatar); this.scene.add(avatar); }
      avatar.position.set(p.x, p.y + ENGINE.bodyHeight / 2, p.z); avatar.rotation.y = Math.atan2(-p.facingX, -p.facingZ);
      avatar.visible = p.id !== me?.id || !this.firstPerson;
    }
    for (const [id, avatar] of this.avatars) if (!players.some(p => p.id === id)) { this.scene.remove(avatar); (avatar.material as THREE.Material).dispose(); this.avatars.delete(id); }
    this.pick(world, me);
    this.renderer.render(this.scene, this.camera);
  }
  pick(world: World, me?: Player) {
    if (!me) return;
    if (document.pointerLockElement === this.renderer.domElement) this.pointer.set(0, 0);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray, last = new THREE.Vector3(), current = new THREE.Vector3();
    last.copy(ray.origin).floor(); this.hover = null;
    for (let distance = 0; distance < ENGINE.reach + 5; distance += 0.035) {
      current.copy(ray.direction).multiplyScalar(distance).add(ray.origin).floor();
      const state = world.peek(current.x, current.y, current.z);
      if (state) {
        if (Math.hypot(me.x-current.x-0.5, me.y+1.5-current.y-0.5, me.z-current.z-0.5) <= ENGINE.reach) {
          const normal = last.clone().sub(current);
          // Only one face is chosen at an exact edge/corner.
          if (normal.x) normal.set(normal.x,0,0); else if (normal.y) normal.set(0,normal.y,0); else normal.set(0,0,normal.z || 1);
          this.hover = { x: current.x, y: current.y, z: current.z, nx: normal.x, ny: normal.y, nz: normal.z, block: state };
        }
        break;
      }
      last.copy(current);
    }
    this.selection.visible = !!this.hover;
    if (this.hover) this.selection.position.set(this.hover.x+0.5, this.hover.y+0.5, this.hover.z+0.5);
  }
  project(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x,y,z).project(this.camera);
    return { x: (p.x+1)*this.host.clientWidth/2, y: (1-p.y)*this.host.clientHeight/2, visible: p.z > -1 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 };
  }
  movement(x: number, z: number) { return { x: Math.cos(this.yaw)*x+Math.sin(this.yaw)*z, z: -Math.sin(this.yaw)*x+Math.cos(this.yaw)*z }; }
}
