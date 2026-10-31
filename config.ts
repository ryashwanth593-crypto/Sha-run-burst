/**
 * Gameplay tuning for sha-runBurst. The run is an auto-sprint across floating voxel islands.
 */
export const DEFAULT_CONFIG = {
  run: {
    seconds: 105,
    lives: 3,
    invulnerable: 1.4,
    killY: -14,
  },
  score: {
    core: 120,
    comboWindow: 3.25,
    comboMax: 6,
    timeBonus: 20,
    lifeBonus: 350,
  },
  player: {
    radius: 0.42,
    halfHeight: 0.5,
    walkSpeed: 7,
    sprintSpeed: 11,
    acceleration: 55,
    airControl: 0.65,
    jumpSpeed: 10.2,
    gravity: -30,
    lowJumpGravity: -58,
    maxFall: -42,
    coyoteTime: 0.12,
    jumpBuffer: 0.14,
    dashSpeed: 20,
    dashTime: 0.22,
    dashCooldown: 1.15,
    turnSpeed: 16,
    strafeSpeed: 8.5,
    maxRunSpeed: 15,
  },
  camera: {
    distance: 7.2,
    height: 2.55,
    minPitch: -0.2,
    maxPitch: 0.9,
    follow: 11,
    fov: 66,
  },
  drones: {
    speed: 1.2,
    radius: 0.65,
    rageSpeed: 2.2,
    rageAt: 25,
  },
} as const

type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
