import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { FollowCamera } from './camera'
import { Collectibles } from './collectibles'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { Drones } from './drones'
import { Effects } from './fx'
import { Player, type PlayerEvent } from './player'
import { collect, createRun, damage, tick, type RunState } from './rules'
import { World } from './world'
import { PowerUps, type PowerUpKind } from './powerups'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'
export type Hint = 'move' | 'look' | 'jump' | 'dash' | 'cores'
export type Compass = { angle: number; distance: number; rise: number }
export type GameHooks = { popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt'): void; hurt(): void; hint(hint: Hint | null): void; tutorialDone(): void; mission(text: string): void; end(run: RunState): void }

export class Game {
  mode: Mode = 'attract'; run: RunState; reducedMotion = false
  private readonly physics: Physics; private readonly world: World; private readonly player: Player; private readonly cam: FollowCamera; private readonly cores: Collectibles; private readonly powerups: PowerUps; private readonly drones: Drones; private readonly fx = new Effects(); private simTime = 0; private time = 0; private tutorial: Hint | null = null; private tutorialStart = new THREE.Vector3(); private shield = 0; private magnet = 0; private overdrive = 0; private powerupCount = 0; private dashCount = 0; private bossCount = 0; private readonly down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio, private readonly hooks: GameHooks) {
    this.physics = new Physics(CONFIG.player.gravity); this.world = new World(this.physics, renderer.shadowMapSize); this.player = new Player(this.physics, this.world.spawn, this.world.movers); this.cam = new FollowCamera(this.physics, this.player.collider); this.cores = new Collectibles(this.world.coreSpots); this.powerups = new PowerUps(this.world.powerupSpots); this.drones = new Drones(this.physics, this.world.droneRoutes); this.world.scene.add(this.player.root, this.player.shadowMesh, this.cores.group, this.powerups.group, this.drones.group, this.fx.mesh); this.run = createRun(this.cores.total); this.cam.reset(this.world.spawn, 0.0)
  }
  get camera(): THREE.PerspectiveCamera { return this.cam.camera }
  get dashCooldown(): number { return this.player.dashCooldownRemaining }
  start(tutorial: boolean): void { tuning.activate('run'); this.cores.reset(); this.powerups.reset(); this.fx.clear(); this.shield = 0; this.magnet = 0; this.overdrive = 0; this.powerupCount = 0; this.dashCount = 0; this.bossCount = 0; this.player.teleport(this.world.spawn); this.player.facing = 0; this.player.autoRunSpeed = CONFIG.player.sprintSpeed; this.cam.pitch = 0.32; this.cam.reset(this.world.spawn, 0); this.run = { ...createRun(this.cores.total), unranked: tuning.unranked }; this.mode = 'playing'; this.input.endFrame(); this.input.takeLook(); this.tutorial = tutorial ? 'move' : null; this.tutorialStart.copy(this.world.spawn); this.hooks.hint(this.tutorial) }
  pause(): void { if (this.mode === 'playing') this.mode = 'paused' }
  resume(): void { if (this.mode !== 'paused') return; this.mode = 'playing'; this.input.endFrame(); this.input.takeLook() }
  toTitle(): void { this.mode = 'attract'; this.hooks.hint(null) }
  setQuality(quality: Quality): void { this.renderer.applyQuality(quality); const size = this.renderer.shadowMapSize; const shadow = this.world.sun.shadow; shadow.map?.dispose(); shadow.map = null; shadow.mapSize.set(size, size); this.world.scene.traverse(obj => { const material = (obj as THREE.Mesh).material; for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true }) }

  step(dt: number): void {
    this.simTime += dt; const jumpPressed = this.input.consume('jump'); const dashPressed = this.input.consume('dash'); const playing = this.mode === 'playing'; const rage = playing && this.run.timeLeft <= CONFIG.drones.rageAt; this.world.stepMovers(this.simTime)
    const events: PlayerEvent[] = []
    if (playing) { this.shield = Math.max(0, this.shield - dt); this.magnet = Math.max(0, this.magnet - dt); this.overdrive = Math.max(0, this.overdrive - dt); this.player.autoRunSpeed = Math.min(CONFIG.player.maxRunSpeed, CONFIG.player.sprintSpeed + this.run.elapsed * 0.065 + (this.overdrive > 0 ? 3.5 : 0)); this.player.step(dt, { moveX: this.input.move.x, moveY: 1, sprint: false, jumpPressed, jumpHeld: this.input.held('jump'), dashPressed }, this.cam.yaw, events); if (events.some(e => e.type === 'dash')) this.dashCount += 1 }
    this.drones.step(dt, rage); this.physics.step(dt); if (!playing) return
    this.run.unranked ||= tuning.unranked; const pos = this.player.position; this.run = { ...this.run, distance: Math.max(this.run.distance, Math.max(0, this.world.spawn.z - pos.z)) }
    events.forEach(e => this.onPlayerEvent(e, pos))
    for (const pickup of this.powerups.collect(pos, CONFIG.player.radius + 0.78)) this.activatePowerup(pickup.kind, pickup.at)
    const coreRadius = CONFIG.player.radius + (this.magnet > 0 ? 2.4 : 0.78)
    for (const at of this.cores.collect(pos, coreRadius)) { const result = collect(this.run); this.run = result.state; this.audio.play('pickup'); this.fx.burst(at, '#29efb3', 24, 6); const combo = this.run.combo > 1 ? `  ×${this.run.combo}` : ''; this.hooks.popup(`+${result.points}${combo}`, this.project(at), 'score'); if (this.tutorial === 'cores') { this.advanceTutorial(null); this.hooks.tutorialDone() } }
    const hitFrom = this.drones.hits(pos, CONFIG.player.radius)[0]; if (hitFrom) { if (this.shield > 0) { this.shield = 0; this.audio.play('powerup'); this.hooks.mission('Shield shattered!'); this.fx.burst(pos, '#57e8ff', 32, 7) } else { const result = damage(this.run); if (result.hurt) { this.run = result.state; this.player.knockback(hitFrom); this.onHurt(pos) } } }
    if (pos.y < CONFIG.run.killY) { this.run = damage(this.run, true).state; this.onHurt(pos); if (this.run.phase === 'playing') { this.player.teleport(this.player.safe); this.cam.reset(this.player.safe) } }
    this.run = tick(this.run, dt); this.updateTutorial(pos)
    if (this.run.phase !== 'playing') { this.mode = 'ended'; this.hooks.hint(null); this.audio.play(this.run.phase === 'won' ? 'win' : 'lose'); if (this.run.phase === 'won') this.fx.burst(pos.clone().setY(pos.y + 1), '#ffd257', 60, 10); this.hooks.end(this.run) }
  }
  render(alpha: number, frameSeconds: number): void { this.time += frameSeconds; this.physics.sync(alpha); const target = this.player.root.position; if (this.mode === 'attract') { const t = this.time * 0.045; const cam = this.cam.camera; cam.position.set(Math.sin(t) * 24, 10 + Math.sin(this.time * 0.2) * 1.5, 12 + Math.cos(t) * 24); cam.lookAt(0, 1.3, -18) } else { const look = this.mode === 'playing' ? this.input.takeLook() : { x: 0, y: 0 }; if (this.mode === 'playing' && this.tutorial === 'look' && Math.abs(look.x) + Math.abs(look.y) > 0.05) this.advanceTutorial('jump'); this.cam.update(target, look, frameSeconds, false, this.reducedMotion) } this.player.animate(frameSeconds, this.time, this.run.invulnerable > 0 && this.mode === 'playing', this.groundBelow(target)); this.cores.animate(frameSeconds); this.powerups.animate(frameSeconds); this.drones.animate(frameSeconds, this.mode === 'playing' && this.run.timeLeft <= CONFIG.drones.rageAt); this.fx.update(frameSeconds); this.world.update(frameSeconds, target); this.renderer.render(this.world.scene, this.cam.camera) }
  compass(): Compass | null { const pos = this.player.position; const remaining = this.cores.remaining(); if (remaining.length === 0) return null; const best = remaining.reduce((a, b) => a.distanceToSquared(pos) < b.distanceToSquared(pos) ? a : b); const toCore = Math.atan2(-(best.x - pos.x), -(best.z - pos.z)); let angle = toCore - this.cam.yaw; angle = Math.atan2(Math.sin(angle), Math.cos(angle)); return { angle, distance: Math.sqrt(best.distanceToSquared(pos)), rise: best.y - pos.y } }
  private onPlayerEvent(e: PlayerEvent, pos: THREE.Vector3): void { const feet = pos.clone().setY(pos.y - CONFIG.player.halfHeight - CONFIG.player.radius); if (e.type === 'jump') { this.audio.play('jump'); this.fx.puff(feet, 0.3); if (this.tutorial === 'jump') this.advanceTutorial('dash') } else if (e.type === 'land') { this.audio.play('land'); this.fx.puff(feet, e.impact); if (e.impact > 0.5) this.cam.addShake(e.impact * 0.5) } else { this.audio.play('dash'); this.fx.burst(pos, '#57e8ff', 14, 4); if (this.tutorial === 'dash') this.advanceTutorial('cores') } }
  private onHurt(pos: THREE.Vector3): void { this.audio.play('hurt'); this.cam.addShake(0.75); this.fx.burst(pos, '#ff5272', 30, 8); this.hooks.hurt(); this.hooks.popup('-1', this.project(pos.clone().setY(pos.y + 1)), 'hurt') }
  private updateTutorial(pos: THREE.Vector3): void { if (this.tutorial === 'move' && pos.distanceTo(this.tutorialStart) > 2.5) this.advanceTutorial(this.input.method === 'touch' ? 'jump' : 'look') }
  private advanceTutorial(next: Hint | null): void { this.tutorial = next; this.hooks.hint(next) }
  private groundBelow(p: THREE.Vector3): number | null { this.down.origin = { x: p.x, y: p.y, z: p.z }; const hit = this.physics.world.castRay(this.down, 30, true, undefined, undefined, this.player.collider); return hit ? p.y - hit.timeOfImpact : null }
  project(world: THREE.Vector3): { x: number; y: number } { const v = world.clone().project(this.cam.camera); const canvas = this.renderer.canvas; return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight } }
  progress(): { powerups: number; dashes: number; bosses: number; distance: number; active: PowerUpKind | null } { return { powerups: this.powerupCount, dashes: this.dashCount, bosses: Math.max(this.bossCount, Math.floor(this.run.distance / 125)), distance: Math.floor(this.run.distance), active: this.shield > 0 ? 'shield' : this.magnet > 0 ? 'magnet' : this.overdrive > 0 ? 'overdrive' : null } }
  private activatePowerup(kind: PowerUpKind, at: THREE.Vector3): void { this.powerupCount += 1; if (kind === 'shield') this.shield = 12; if (kind === 'magnet') this.magnet = 10; if (kind === 'overdrive') this.overdrive = 8; this.audio.play('powerup'); this.fx.burst(at, kind === 'shield' ? '#57e8ff' : kind === 'magnet' ? '#ff76c8' : '#ffd257', 30, 8); this.hooks.popup(kind.toUpperCase(), this.project(at), 'score'); this.hooks.mission(kind === 'shield' ? 'Shield online' : kind === 'magnet' ? 'Magnet active' : 'Overdrive active') }
}
