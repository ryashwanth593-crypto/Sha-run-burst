import * as THREE from 'three'

export type PowerUpKind = 'shield' | 'magnet' | 'overdrive'
export type PowerUpPickup = { kind: PowerUpKind; at: THREE.Vector3 }
type Item = { kind: PowerUpKind; mesh: THREE.Group; home: THREE.Vector3; taken: boolean; phase: number }

const COLORS: Record<PowerUpKind, string> = { shield: '#57e8ff', magnet: '#ff76c8', overdrive: '#ffd257' }

export class PowerUps {
  readonly group = new THREE.Group()
  private items: Item[] = []
  private time = 0
  constructor(spots: Array<{ kind: PowerUpKind; at: THREE.Vector3 }>) {
    for (const spot of spots) {
      const kind = spot.kind
      const root = new THREE.Group(); root.position.copy(spot.at)
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 0), new THREE.MeshStandardMaterial({ color: COLORS[kind], emissive: COLORS[kind], emissiveIntensity: 3, flatShading: true }))
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 6, 20), new THREE.MeshBasicMaterial({ color: COLORS[kind], transparent: true, opacity: 0.9 }))
      ring.rotation.x = Math.PI / 2
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), new THREE.MeshBasicMaterial({ color: COLORS[kind], transparent: true, opacity: 0.08, depthWrite: false }))
      root.add(halo, orb, ring); this.group.add(root)
      this.items.push({ kind, mesh: root, home: spot.at.clone(), taken: false, phase: spot.at.z * 0.14 })
    }
  }
  reset(): void { for (const item of this.items) { item.taken = false; item.mesh.visible = true } }
  collect(player: THREE.Vector3, radius: number): PowerUpPickup[] {
    const out: PowerUpPickup[] = []
    for (const item of this.items) if (!item.taken && item.home.distanceToSquared(player) < radius * radius) { item.taken = true; item.mesh.visible = false; out.push({ kind: item.kind, at: item.home.clone() }) }
    return out
  }
  animate(dt: number): void {
    this.time += dt
    for (const item of this.items) if (!item.taken) { item.mesh.position.y = item.home.y + Math.sin(this.time * 3 + item.phase) * 0.16; item.mesh.rotation.y += dt * 1.8; item.mesh.children[2].rotation.z = this.time * 1.3 }
  }
}
