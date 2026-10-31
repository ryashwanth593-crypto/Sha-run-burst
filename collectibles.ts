import * as THREE from 'three'

type Core = { mesh: THREE.Group; home: THREE.Vector3; taken: boolean; phase: number }

export class Collectibles {
  readonly group = new THREE.Group()
  private cores: Core[] = []
  private time = 0

  constructor(spots: THREE.Vector3[]) {
    const emerald = new THREE.OctahedronGeometry(0.34, 0)
    const gemMat = new THREE.MeshStandardMaterial({ color: '#31f0b4', emissive: '#13c990', emissiveIntensity: 3, flatShading: true, roughness: 0.25 })
    const coin = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8)
    const coinMat = new THREE.MeshStandardMaterial({ color: '#ffd35c', emissive: '#ff9f1c', emissiveIntensity: 2.1, flatShading: true, roughness: 0.3, metalness: 0.2 })
    const ringGeo = new THREE.TorusGeometry(0.55, 0.035, 6, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 })
    const halo = haloTexture()
    spots.forEach((spot, index) => {
      const mesh = new THREE.Group()
      const g = new THREE.Mesh(index % 3 === 0 ? coin : emerald, index % 3 === 0 ? coinMat : gemMat)
      g.castShadow = true
      if (index % 3 === 0) g.rotation.x = Math.PI / 2
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: index % 3 === 0 ? '#ffd257' : '#29efb3', transparent: true, opacity: 0.72, depthWrite: false, blending: THREE.AdditiveBlending }))
      glow.scale.setScalar(2.1); mesh.add(glow, g, ring); mesh.position.copy(spot); this.group.add(mesh)
      this.cores.push({ mesh, home: spot.clone(), taken: false, phase: spot.x * 0.7 + spot.z * 0.3 + index })
    })
  }

  get total(): number { return this.cores.length }
  remaining(): THREE.Vector3[] { return this.cores.filter(c => !c.taken).map(c => c.home) }
  collect(player: THREE.Vector3, radius: number): THREE.Vector3[] {
    const got: THREE.Vector3[] = []
    for (const c of this.cores) { if (c.taken) continue; if (c.home.distanceToSquared(player) < radius * radius) { c.taken = true; c.mesh.visible = false; got.push(c.home.clone()) } }
    return got
  }
  reset(): void { for (const c of this.cores) { c.taken = false; c.mesh.visible = true } }
  animate(frameSeconds: number): void {
    this.time += frameSeconds
    for (const c of this.cores) { if (c.taken) continue; c.mesh.position.y = c.home.y + Math.sin(this.time * 2.4 + c.phase) * 0.13; c.mesh.children[1].rotation.y = this.time * 1.9 + c.phase; c.mesh.children[2].rotation.z = this.time * 0.9; c.mesh.children[2].scale.setScalar(1 + Math.sin(this.time * 4 + c.phase) * 0.08) }
  }
}

let haloCache: THREE.Texture | undefined
export function haloTexture(): THREE.Texture {
  if (haloCache) return haloCache
  const size = 128; const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size)
  haloCache = new THREE.CanvasTexture(canvas); haloCache.colorSpace = THREE.SRGBColorSpace; return haloCache
}
