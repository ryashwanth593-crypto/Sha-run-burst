import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import { tuning } from './tuning'
import type { MovingPlatform } from './world'

export type PlayerIntent = { moveX: number; moveY: number; sprint: boolean; jumpPressed: boolean; jumpHeld: boolean; dashPressed: boolean }
export type PlayerEvent = { type: 'jump' } | { type: 'land'; impact: number } | { type: 'dash' }
const P = CONFIG.player
const UP = new THREE.Vector3(0, 1, 0)

export class Player {
  readonly root = new THREE.Group(); readonly body: RAPIER.RigidBody; readonly collider: RAPIER.Collider; readonly velocity = new THREE.Vector3(); readonly safe = new THREE.Vector3()
  grounded = false; facing = 0; autoRunSpeed = 0
  private readonly controller: RAPIER.KinematicCharacterController; private readonly model = new THREE.Group(); private readonly eyes: THREE.Mesh; private readonly shadow: THREE.Mesh
  private coyote = 0; private jumpBuffer = 0; private jumping = false; private dashTime = 0; private dashCooldown = 0; private squash = 0; private runCycle = 0; private platform?: MovingPlatform; private safeTimer = 0

  constructor(private readonly physics: Physics, spawn: THREE.Vector3, private readonly movers: MovingPlatform[]) {
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z))
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(P.halfHeight, P.radius).setFriction(0), this.body)
    this.controller = physics.world.createCharacterController(0.02); this.controller.enableAutostep(0.4, 0.25, false); this.controller.enableSnapToGround(0.35); this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(50)); this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(35)); this.controller.setApplyImpulsesToDynamicBodies(true)
    this.safe.copy(spawn); this.root.position.copy(spawn); this.eyes = this.buildModel(); this.root.add(this.model); physics.bind(this.body, this.root)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(P.radius * 1.5, 20), new THREE.MeshBasicMaterial({ color: '#24313d', transparent: true, opacity: 0.34, depthWrite: false })); this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1
  }
  get shadowMesh(): THREE.Mesh { return this.shadow }
  get position(): THREE.Vector3 { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z) }
  get dashing(): boolean { return this.dashTime > 0 }
  get dashCooldownRemaining(): number { return this.dashCooldown }

  step(dt: number, intent: PlayerIntent, cameraYaw: number, events: PlayerEvent[]): void {
    const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw)); const right = new THREE.Vector3().crossVectors(forward, UP)
    const forwardAmount = Math.abs(intent.moveY) > 0.01 ? THREE.MathUtils.clamp(intent.moveY, -1, 1) : 0
    const wish = new THREE.Vector3().addScaledVector(forward, forwardAmount).addScaledVector(right, intent.moveX); if (wish.lengthSq() > 0.001) wish.normalize()
    const strafe = THREE.MathUtils.clamp(intent.moveX, -1, 1)
    this.coyote = this.grounded ? P.coyoteTime : Math.max(0, this.coyote - dt); this.jumpBuffer = intent.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt); this.dashCooldown = Math.max(0, this.dashCooldown - dt)
    const speed = Math.min(P.maxRunSpeed, this.autoRunSpeed > 0 ? this.autoRunSpeed : P.walkSpeed)
    if (intent.dashPressed && this.dashCooldown <= 0) { tuning.activate('dash'); this.facing = Math.atan2(-wish.x, -wish.z); this.velocity.set(wish.x * Math.max(speed, P.dashSpeed), Math.max(this.velocity.y, 0), wish.z * Math.max(speed, P.dashSpeed)); this.dashTime = P.dashTime; this.dashCooldown = P.dashCooldown; events.push({ type: 'dash' }) }
    if (this.dashTime > 0) { this.dashTime -= dt; this.velocity.y = Math.max(this.velocity.y, 0) } else {
      const sideSpeed = Math.max(P.strafeSpeed, speed)
      const target = new THREE.Vector3(forward.x * speed + right.x * strafe * sideSpeed, this.velocity.y, forward.z * speed + right.z * strafe * sideSpeed)
      const horizontal = new THREE.Vector3(this.velocity.x, 0, this.velocity.z); horizontal.lerp(new THREE.Vector3(target.x, 0, target.z), 1 - Math.exp(-(P.acceleration / 6) * dt)); this.velocity.x = horizontal.x; this.velocity.z = horizontal.z
      if (this.jumpBuffer > 0 && this.coyote > 0) { tuning.activate('jump'); this.velocity.y = P.jumpSpeed; this.jumping = true; this.jumpBuffer = 0; this.coyote = 0; this.grounded = false; this.squash = -0.35; events.push({ type: 'jump' }) }
      const rising = this.velocity.y > 0; const gravity = rising && this.jumping && !intent.jumpHeld ? P.lowJumpGravity : P.gravity; this.velocity.y = Math.max(P.maxFall, this.velocity.y + gravity * dt)
    }
    if (Math.abs(strafe) > 0.1) this.facing = dampAngle(this.facing, Math.atan2(-wish.x, -wish.z), P.turnSpeed, dt)
    else this.facing = dampAngle(this.facing, Math.atan2(-forward.x, -forward.z), P.turnSpeed, dt)
    const desired = this.velocity.clone().multiplyScalar(dt); if (this.platform) desired.add(this.platform.delta); this.controller.computeColliderMovement(this.collider, desired); const moved = this.controller.computedMovement(); const wasGrounded = this.grounded; this.grounded = this.controller.computedGrounded()
    if (this.velocity.y > 0 && moved.y < desired.y - 1e-3) this.velocity.y = 0
    if (this.grounded) { if (!wasGrounded && this.velocity.y < -6) { events.push({ type: 'land', impact: Math.min(1, -this.velocity.y / 30) }); this.squash = Math.min(0.45, -this.velocity.y / 60) } if (this.velocity.y < 0) this.velocity.y = -1; this.jumping = false }
    const cur = this.body.translation(); const next = { x: cur.x + moved.x, y: cur.y + moved.y, z: cur.z + moved.z }; this.body.setNextKinematicTranslation(next); this.platform = this.grounded ? this.findPlatform(next) : undefined
    if (this.grounded && !this.platform) { this.safeTimer += dt; if (this.safeTimer > 0.35) this.safe.set(next.x, next.y + 0.2, next.z) } else this.safeTimer = 0
  }
  private findPlatform(pos: { x: number; y: number; z: number }): MovingPlatform | undefined { const feet = pos.y - P.halfHeight - P.radius; return this.movers.find(m => Math.abs(feet - (m.body as never as { translation(): { y: number } }).translation().y) < 0.2 && Math.abs(pos.x - m.from.x) < m.half.x && Math.abs(pos.z - m.from.z) < m.half.z) }
  teleport(to: THREE.Vector3): void { this.body.setTranslation(to, true); this.body.setNextKinematicTranslation(to); this.velocity.set(0, 0, 0); this.platform = undefined; this.dashTime = 0; this.root.position.copy(to); this.physics.snap(this.body) }
  knockback(from: THREE.Vector3): void { const away = this.position.sub(from).setY(0); if (away.lengthSq() < 1e-4) away.set(1, 0, 0); away.normalize().multiplyScalar(7); this.velocity.set(away.x, 7, away.z); this.dashTime = 0; this.grounded = false; this.platform = undefined }
  animate(frameSeconds: number, time: number, invulnerable: boolean, ground: number | null): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z); this.model.rotation.y = this.facing; this.squash = THREE.MathUtils.damp(this.squash, 0, 10, frameSeconds); const stretch = this.grounded ? 0 : THREE.MathUtils.clamp(this.velocity.y / 60, -0.12, 0.18); const s = 1 - this.squash + stretch; this.model.scale.set(1 / Math.sqrt(Math.max(s, 0.5)), s, 1 / Math.sqrt(Math.max(s, 0.5)))
    if (this.grounded && speed > 0.5) this.runCycle += frameSeconds * speed * 1.6; const bob = this.grounded ? Math.abs(Math.sin(this.runCycle)) * 0.08 : 0; this.model.position.y = bob; this.model.rotation.x = -Math.min(0.28, speed / 40) * (this.dashing ? 1.6 : 1); this.model.visible = !invulnerable || Math.floor(time * 16) % 2 === 0; (this.eyes.material as THREE.MeshStandardMaterial).emissiveIntensity = this.dashing ? 5 : 2.4
    if (ground === null) this.shadow.visible = false; else { const feet = this.root.position.y - P.halfHeight - P.radius; const height = Math.max(0, feet - ground); this.shadow.visible = height < 14; this.shadow.position.set(this.root.position.x, ground + 0.03, this.root.position.z); const k = THREE.MathUtils.clamp(1 - height / 14, 0.25, 1); this.shadow.scale.setScalar(k); (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 * k }
  }
  private buildModel(): THREE.Mesh {
    const skin = new THREE.MeshStandardMaterial({ color: '#c97d56', roughness: 0.72, flatShading: true }); const shirt = new THREE.MeshStandardMaterial({ color: '#f5f0e6', roughness: 0.62, flatShading: true }); const pants = new THREE.MeshStandardMaterial({ color: '#29334d', roughness: 0.8, flatShading: true }); const teal = new THREE.MeshStandardMaterial({ color: '#2eddb0', emissive: '#0e9f7f', emissiveIntensity: 1.7, flatShading: true }); const dark = new THREE.MeshStandardMaterial({ color: '#1d2941', roughness: 0.45, flatShading: true })
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.38), shirt); torso.position.y = -0.12
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.56, 0.52), skin); head.position.y = 0.53
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.2, 0.56), dark); hair.position.set(0, 0.86, 0.02)
    const eyeGeo = new THREE.BoxGeometry(0.07, 0.09, 0.04); const eyeL = new THREE.Mesh(eyeGeo, teal); const eyeR = eyeL.clone(); eyeL.position.set(-0.13, 0.56, -0.28); eyeR.position.set(0.13, 0.56, -0.28)
    const legGeo = new THREE.BoxGeometry(0.2, 0.56, 0.23); const legL = new THREE.Mesh(legGeo, pants); const legR = legL.clone(); legL.position.set(-0.18, -0.74, 0); legR.position.set(0.18, -0.74, 0)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.18), teal); pack.position.set(0, -0.08, 0.28)
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 0.12), teal); sword.position.set(0.42, 0.1, 0.08); sword.rotation.z = -0.38
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.1), new THREE.MeshStandardMaterial({ color: '#ffd257', emissive: '#a56f10', emissiveIntensity: 1.2, flatShading: true })); guard.position.set(0.39, -0.18, 0.08); guard.rotation.z = -0.38
    for (const m of [torso, head, hair, eyeL, eyeR, legL, legR, pack, sword, guard]) { m.castShadow = true; this.model.add(m) }
    return eyeL
  }
}
function dampAngle(from: number, to: number, lambda: number, dt: number): number { let delta = (to - from) % (Math.PI * 2); if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2; return from + delta * (1 - Math.exp(-lambda * dt)) }
