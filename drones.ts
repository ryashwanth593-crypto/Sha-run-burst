import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { CONFIG } from './config'
import type { DroneRoute } from './world'

type Drone = { root: THREE.Group; route: DroneRoute; angle: number; eye?: THREE.Mesh; glow?: THREE.Mesh }

export class Drones {
  readonly group = new THREE.Group()
  private drones: Drone[] = []
  constructor(_physics: Physics, routes: DroneRoute[]) {
    routes.forEach(route => {
      const root = new THREE.Group(); root.position.copy(route.center)
      if (route.kind === 'glider') {
        const shell = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.72), new THREE.MeshStandardMaterial({ color: '#7254c8', emissive: '#3e2792', emissiveIntensity: 1.2, flatShading: true }))
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.24), new THREE.MeshStandardMaterial({ color: '#c7a3ff', emissive: '#8f68ff', emissiveIntensity: 1.4, flatShading: true }))
        wing.position.y = 0.13
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.06), new THREE.MeshStandardMaterial({ color: '#ffe66d', emissive: '#ffbd2e', emissiveIntensity: 4, flatShading: true })); eye.position.z = -0.38
        root.add(shell, wing, eye); this.drones.push({ root, route, angle: route.phase, eye });
      } else {
        const bodyMat = new THREE.MeshStandardMaterial({ color: '#42c778', emissive: '#175e42', emissiveIntensity: 0.65, flatShading: true })
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.46), bodyMat); body.position.y = 0.35
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 0.56), bodyMat); head.position.y = 1.08
        const eyeMat = new THREE.MeshStandardMaterial({ color: '#ffeff4', emissive: '#ff526d', emissiveIntensity: 3, flatShading: true })
        const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.05), eyeMat); eyeL.position.set(-0.18, 1.15, -0.28)
        const eyeR = eyeL.clone(); eyeR.position.x = 0.18
        const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: '#173f35', flatShading: true })); mouth.position.set(0, 0.82, -0.25)
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshStandardMaterial({ color: '#ffb34f', emissive: '#ff4d6d', emissiveIntensity: 4, flatShading: true })); glow.position.set(0, 0.05, 0)
        root.add(body, head, eyeL, eyeR, mouth, glow); this.drones.push({ root, route, angle: route.phase, glow })
      }
      if (route.kind === 'boss') {
        root.scale.setScalar(1.8)
        root.position.y += 0.45
        const crown = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: '#ffd257', emissive: '#ff8d2b', emissiveIntensity: 2.5, flatShading: true }))
        crown.position.y = 1.75
        root.add(crown)
      }
      this.group.add(root)
    })
  }
  private pointOn(route: DroneRoute, angle: number): THREE.Vector3 { return new THREE.Vector3(route.center.x + Math.cos(angle) * route.radius, route.center.y + Math.sin(angle * 2) * 0.18, route.center.z + Math.sin(angle) * route.radius) }
  step(dt: number, rage: boolean): void { const speed = rage ? CONFIG.drones.rageSpeed : CONFIG.drones.speed; for (const d of this.drones) { d.angle += speed * dt * d.route.dir; d.root.position.copy(this.pointOn(d.route, d.angle)); d.root.rotation.y = Math.sin(d.angle) * 0.35 } }
  hits(player: THREE.Vector3, playerRadius: number): THREE.Vector3[] { const out: THREE.Vector3[] = []; for (const d of this.drones) { const p = d.root.position; const reach = CONFIG.drones.radius + playerRadius + (d.route.kind === 'boss' ? 0.75 : 0.18); const dy = THREE.MathUtils.clamp(p.y + (d.route.kind === 'boss' ? 0.9 : 0.5), player.y - CONFIG.player.halfHeight, player.y + CONFIG.player.halfHeight); if (Math.hypot(p.x - player.x, p.z - player.z, dy - player.y) < reach) out.push(p.clone()) } return out }
  animate(frameSeconds: number, rage: boolean): void { this.drones.forEach(d => { if (d.glow) (d.glow.material as THREE.MeshStandardMaterial).emissiveIntensity = rage ? 6 : 4; d.root.position.y += Math.sin(frameSeconds * 30 + d.angle) * 0.003 }) }
}
