// Camera-ray construction + ray/sphere picking. The render camera composes
// world→camera space as rotX(pitch) * rotY(yaw) * transl(-camPos) (see
// cyberspace/mount.ts); a pick ray needs the inverse of that rotation to go
// from a screen point back to a world-space direction, so this applies
// rotX(-pitch) then rotY(-yaw) to the camera-space direction.

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number];
}

export function rayFromCamera(
  camPos: readonly [number, number, number],
  yaw: number,
  pitch: number,
  ndcX: number,
  ndcY: number,
  fovY: number,
  aspect: number
): Ray {
  const t = Math.tan(fovY / 2);
  let x = ndcX * aspect * t;
  let y = ndcY * t;
  let z = -1;

  const cp = Math.cos(-pitch), sp = Math.sin(-pitch);
  const y1 = cp * y - sp * z;
  const z1 = sp * y + cp * z;
  y = y1; z = z1;

  const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
  const x1 = cy * x + sy * z;
  const z2 = -sy * x + cy * z;
  x = x1; z = z2;

  const len = Math.hypot(x, y, z) || 1;
  return {
    origin: [camPos[0], camPos[1], camPos[2]],
    dir: [x / len, y / len, z / len]
  };
}

export function intersectSphere(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  center: readonly [number, number, number],
  radius: number
): number | null {
  const ox = origin[0] - center[0], oy = origin[1] - center[1], oz = origin[2] - center[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  const t1 = -b + sq;
  const t = t0 >= 0 ? t0 : t1;
  return t >= 0 ? t : null;
}
