import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import type { PowerUpKind } from './powerups'

/** Legacy deterministic helpers kept for the starter's level tests. */
export type Island = { x: number; z: number; top: number; r: number; cores: number; decor?: boolean }
export const ISLANDS: Island[] = [
  { x: 0, z: 0, top: 0, r: 7, cores: 2, decor: true }, { x: 15, z: 3, top: 1.5, r: 4, cores: 2, decor: true },
  { x: 24, z: -8, top: 3.2, r: 3.5, cores: 2 }, { x: 14, z: -19, top: 4.8, r: 4.5, cores: 2, decor: true },
  { x: 0, z: -27, top: 6.5, r: 5, cores: 2, decor: true }, { x: -15, z: -16, top: 4.5, r: 4, cores: 2, decor: true },
  { x: -23, z: 1, top: 2.8, r: 3.5, cores: 2 }, { x: -11, z: 17, top: 1.2, r: 4.5, cores: 2, decor: true },
  { x: 7, z: 17, top: 2.5, r: 3.5, cores: 2 }, { x: 0, z: -12, top: 10.5, r: 3, cores: 3 },
]
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export function planStones(a: Island, b: Island): { x: number; z: number; top: number }[] {
  const dx = b.x - a.x; const dz = b.z - a.z; const d = Math.hypot(dx, dz); const gap = d - a.r - b.r; const dy = b.top - a.top
  let n = 0; while ((gap - n * 1.8) / (n + 1) > 2.3 || Math.abs(dy) / (n + 1) > 1.05) n += 1
  const g = (gap - n * 1.8) / (n + 1); const out: { x: number; z: number; top: number }[] = []
  for (let i = 1; i <= n; i += 1) { const along = a.r + g * i + 1.8 * (i - 0.5); out.push({ x: a.x + (dx / d) * along, z: a.z + (dz / d) * along, top: a.top + (dy * i) / (n + 1) }) }
  return out
}

export type MovingPlatform = { mesh: THREE.Mesh; body: never; from: THREE.Vector3; to: THREE.Vector3; period: number; phase: number; delta: THREE.Vector3; half: THREE.Vector3 }
export type DroneRoute = { center: THREE.Vector3; radius: number; phase: number; dir: 1 | -1; kind?: 'creeper' | 'glider' | 'boss' }

export const PALETTE = {
  skyTop: new THREE.Color('#2788d9'), horizon: new THREE.Color('#b8efff'), grass: new THREE.Color('#72d66e'), grassDark: new THREE.Color('#318f57'),
  soil: new THREE.Color('#8b5c43'), soilDark: new THREE.Color('#4d3d48'), rock: new THREE.Color('#5b7894'), stone: new THREE.Color('#e6c56d'),
  leaf: [new THREE.Color('#2f9c63'), new THREE.Color('#67c957'), new THREE.Color('#9dd84f')], trunk: new THREE.Color('#71462e'),
  emerald: new THREE.Color('#29efb3'), cyan: new THREE.Color('#57e8ff'), gold: new THREE.Color('#ffd257'), red: new THREE.Color('#ff5272'),
}

const flat = (color: THREE.Color | string) => new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true })
const glow = (color: THREE.Color | string, emissiveIntensity = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity, roughness: 0.24, flatShading: true })

export class World {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly spawn = new THREE.Vector3(0, 1.25, 3.1)
  readonly coreSpots: THREE.Vector3[] = []
  readonly powerupSpots: Array<{ kind: PowerUpKind; at: THREE.Vector3 }> = []
  readonly droneRoutes: DroneRoute[] = []
  readonly movers: MovingPlatform[] = []
  private readonly water: THREE.Mesh[] = []
  private readonly clouds: THREE.Object3D[] = []
  private time = 0
  private weatherTime = 0
  private weatherMode: 'sunny' | 'rain' | 'night' = 'sunny'

  constructor(private readonly physics: Physics, shadowMapSize: number) {
    const random = rng(7441)
    this.scene.background = PALETTE.horizon.clone()
    this.scene.fog = new THREE.Fog(PALETTE.horizon, 35, 155)
    this.scene.add(this.makeSky(), new THREE.HemisphereLight('#d8f6ff', '#4b3a43', 1.25))
    this.sun = new THREE.DirectionalLight('#fff7d6', 2.4)
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03
    this.scene.add(this.sun, this.sun.target)
    this.buildTrack(random)
    this.addDistantIslands(random)
    this.addClouds(random)
    this.addSwordTotem()
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt
    this.water.forEach((m, i) => { m.scale.y = 1 + Math.sin(this.time * 2.2 + i) * 0.08; (m.material as THREE.MeshStandardMaterial).opacity = 0.36 + Math.sin(this.time * 1.4 + i) * 0.05 })
    this.weatherTime += dt
    const phase = Math.floor(this.weatherTime / 24) % 3
    const weather: 'sunny' | 'rain' | 'night' = phase === 1 ? 'rain' : phase === 2 ? 'night' : 'sunny'
    if (weather !== this.weatherMode) { this.weatherMode = weather; this.applyWeather() }
    this.clouds.forEach(c => { c.position.x += dt * (c.userData.speed as number); if (c.position.x > 110) c.position.x = -110 })
    this.sun.position.set(focus.x + 18, focus.y + 34, focus.z + 12); this.sun.target.position.copy(focus)
  }

  stepMovers(_elapsed: number): void { /* The runner uses fixed floating islands; there are no moving colliders. */ }

  private buildTrack(random: () => number): void {
    let x = 0
    const length = 7.2
    for (let i = 0; i < 88; i += 1) {
      const z = 0.1 - i * 8.45
      x = THREE.MathUtils.clamp(x + (random() - 0.5) * 2.4, -2.6, 2.6)
      const width = 5.7 + random() * 1.2
      const top = i === 0 ? 0 : (i % 11 === 0 ? 0.75 : i % 7 === 0 ? -0.25 : 0)
      this.addIslandChunk(x, z, width, length, top, i, random)
      if (i > 1 && i % 5 === 0) this.addWaterfall(x + (random() > 0.5 ? width * 0.42 : -width * 0.42), z, top, random)
    }
  }

  private addIslandChunk(x: number, z: number, width: number, length: number, top: number, index: number, random: () => number): void {
    const group = new THREE.Group(); group.position.set(x, top, z)
    const biome = index % 3
    const baseColor = biome === 1 ? '#8c4d3f' : biome === 2 ? '#405c87' : PALETTE.soil
    const grassColor = biome === 1 ? '#d27a4c' : biome === 2 ? '#70e4e1' : PALETTE.grass
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, 1.22, length), flat(baseColor)); base.position.y = -0.58; base.castShadow = true; base.receiveShadow = true
    const grass = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.18, length + 0.08), flat(grassColor)); grass.position.y = 0.06; grass.castShadow = true; grass.receiveShadow = true
    group.add(base, grass)
    for (let b = 0; b < 5; b += 1) { const block = new THREE.Mesh(new THREE.BoxGeometry(0.65 + random() * 0.45, 0.4 + random() * 0.6, 0.65 + random() * 0.45), flat(b % 2 ? PALETTE.soilDark : PALETTE.rock)); block.position.set((random() - 0.5) * width * 0.86, -1.1 - random() * 0.5, (random() - 0.5) * length * 0.82); block.rotation.y = random() * Math.PI; group.add(block) }
    this.scene.add(group)
    this.physics.addStaticBox(new THREE.Vector3(x, top - 0.58, z), new THREE.Vector3(width, 1.22, length))
    for (let c = 0; c < 2; c += 1) {
      const offset = c === 0 ? -width * 0.2 : width * 0.2
      this.coreSpots.push(new THREE.Vector3(x + offset, top + 0.95, z - 0.65 + (index % 3) * 0.3))
    }
    if (index > 2 && index % 6 === 0) this.droneRoutes.push({ center: new THREE.Vector3(x - width * 0.2, top + 0.9, z), radius: Math.min(0.7, width * 0.13), phase: index * 0.7, dir: index % 2 ? 1 : -1, kind: 'creeper' })
    if (index > 6 && index % 9 === 0) this.droneRoutes.push({ center: new THREE.Vector3(x + width * 0.23, top + 0.72, z - 1), radius: 0.45, phase: index, dir: 1, kind: 'glider' })
    if (index > 8 && index % 16 === 0) this.droneRoutes.push({ center: new THREE.Vector3(x, top + 0.75, z - 2.2), radius: 0.9, phase: index * 0.4, dir: index % 32 ? 1 : -1, kind: 'boss' })
    if (index > 3 && index % 8 === 3) this.powerupSpots.push({ kind: index % 16 === 3 ? 'shield' : index % 16 === 11 ? 'magnet' : 'overdrive', at: new THREE.Vector3(x, top + 1.15, z - 1.1) })
    if (index % 4 === 1) this.addTree(x - width * 0.35, top, z + length * 0.23, 0.76 + random() * 0.3, random)
    if (index % 5 === 2) this.addLantern(x + width * 0.37, top, z - length * 0.2)
    if (index % 7 === 4) this.addCritter(x + width * 0.34, top, z + 0.6, random() > 0.5 ? 'pig' : 'chicken')
    if (index % 10 === 0) this.addSwordMarker(x, top, z + length * 0.27)
  }

  private addTree(x: number, y: number, z: number, scale: number, random: () => number): void {
    const tree = new THREE.Group(); tree.position.set(x, y, z); tree.scale.setScalar(scale)
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.6, 0.34), flat(PALETTE.trunk)); trunk.position.y = 0.8; trunk.castShadow = true
    tree.add(trunk)
    for (let i = 0; i < 4; i += 1) { const leaves = new THREE.Mesh(new THREE.BoxGeometry(1.05 - i * 0.08, 0.7, 1.05 - i * 0.08), flat(PALETTE.leaf[Math.floor(random() * PALETTE.leaf.length)])); leaves.position.set((random() - 0.5) * 0.18, 1.55 + i * 0.42, (random() - 0.5) * 0.18); leaves.castShadow = true; tree.add(leaves) }
    this.scene.add(tree)
  }

  private addLantern(x: number, y: number, z: number): void {
    const post = new THREE.Group(); post.position.set(x, y, z)
    const wood = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), flat(PALETTE.trunk)); wood.position.y = 0.52
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), glow('#ffca58', 3.5)); light.position.y = 1.15
    post.add(wood, light); this.scene.add(post)
  }

  private addCritter(x: number, y: number, z: number, kind: 'pig' | 'chicken'): void {
    const root = new THREE.Group(); root.position.set(x, y + 0.15, z); root.scale.setScalar(kind === 'pig' ? 0.6 : 0.48)
    const body = new THREE.Mesh(new THREE.BoxGeometry(kind === 'pig' ? 0.85 : 0.62, 0.55, 0.7), flat(kind === 'pig' ? '#f38b9f' : '#fff5dd')); body.position.y = 0.48
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.48), flat(kind === 'pig' ? '#f6a4b0' : '#fffaf0')); head.position.set(0, 0.72, -0.43)
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), flat('#392638')); eye.position.set(0.16, 0.78, -0.68)
    root.add(body, head, eye); this.scene.add(root)
  }

  private addWaterfall(x: number, z: number, y: number, random: () => number): void {
    for (let i = 0; i < 3; i += 1) { const water = new THREE.Mesh(new THREE.BoxGeometry(0.24 + random() * 0.18, 4 + random() * 2.2, 0.12), new THREE.MeshStandardMaterial({ color: PALETTE.cyan, emissive: PALETTE.cyan, emissiveIntensity: 0.4, transparent: true, opacity: 0.42, roughness: 0.15 })); water.position.set(x + (i - 1) * 0.3, y - 3.2 - random(), z + (random() - 0.5) * 0.7); water.rotation.z = (random() - 0.5) * 0.08; this.water.push(water); this.scene.add(water) }
  }

  private addSwordMarker(x: number, y: number, z: number): void {
    const root = new THREE.Group(); root.position.set(x, y + 0.24, z); root.rotation.y = -0.4
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.65, 0.24), glow(PALETTE.cyan, 2.6)); blade.rotation.z = -0.18; blade.position.y = 0.9
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.24), flat(PALETTE.gold)); guard.position.y = 0.15
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), flat(PALETTE.soilDark)); grip.position.y = -0.18
    root.add(blade, guard, grip); this.scene.add(root)
  }

  private addSwordTotem(): void {
    this.addSwordMarker(0, 0, 1.35)
  }

  private makeSky(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: PALETTE.skyTop }, horizon: { value: PALETTE.horizon } }, vertexShader: 'varying vec3 vDir; void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){float h=clamp(vDir.y,-1.0,1.0); vec3 col=mix(horizon,top,pow(max(h,0.0),0.55)); gl_FragColor=vec4(col,1.0);}' })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat); sky.renderOrder = -1; return sky
  }

  private addClouds(random: () => number): void {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.72, depthWrite: false })
    for (let i = 0; i < 18; i += 1) { const cloud = new THREE.Group(); const puffs = 2 + Math.floor(random() * 3); for (let p = 0; p < puffs; p += 1) { const puff = new THREE.Mesh(new THREE.BoxGeometry(2.4 + random() * 2.4, 0.7 + random() * 0.8, 1.1 + random() * 1.4), mat); puff.position.set(p * 1.4, random() * 0.35, (random() - 0.5) * 0.8); cloud.add(puff) } cloud.position.set((random() - 0.5) * 120, 9 + random() * 22, -random() * 180); cloud.userData.speed = 0.3 + random() * 0.7; this.clouds.push(cloud); this.scene.add(cloud) }
  }

  private addDistantIslands(random: () => number): void {
    for (let i = 0; i < 12; i += 1) { const g = new THREE.Group(); const r = 4 + random() * 5; const top = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 0.7, r * 1.2), flat(PALETTE.grassDark)); const rock = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 2.2, 5), flat(PALETTE.rock)); rock.rotation.x = Math.PI; rock.position.y = -1.5; g.add(top, rock); g.position.set((random() - 0.5) * 110, -4 + random() * 16, -30 - random() * 125); g.rotation.y = random() * Math.PI; this.scene.add(g) }
  }

  private applyWeather(): void {
    const night = this.weatherMode === 'night'
    const rain = this.weatherMode === 'rain'
    this.scene.background = new THREE.Color(night ? '#102246' : rain ? '#6c9bb7' : '#b8efff')
    if (this.scene.fog) this.scene.fog.color.set(night ? '#1d3157' : rain ? '#789eb2' : '#b8efff')
    this.sun.color.set(night ? '#9ebcff' : rain ? '#d4e7ef' : '#fff7d6')
    this.sun.intensity = night ? 0.72 : rain ? 1.45 : 2.4
  }
}
