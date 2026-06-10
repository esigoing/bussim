// Vereinfachtes Pacejka-Reifenmodell mit Reibkreis-Kombination.
// Eingaben sind bereits mit Anti-NaN-Floors versehen (siehe RaycastVehicle).

const BX = 12, CX = 1.65;   // längs
const BY = 8.5, CY = 1.3;   // quer

export function tireForces(Fz, slipRatio, slipAngle, mu, out) {
  if (Fz <= 0) {
    out.fx = 0; out.fy = 0;
    return out;
  }
  const Dx = mu;
  const Dy = mu * 0.95;

  let fx = Fz * Dx * Math.sin(CX * Math.atan(BX * slipRatio));
  let fy = -Fz * Dy * Math.sin(CY * Math.atan(BY * slipAngle));

  // Reibkreis: kombinierter Schlupf darf das Maximum nicht überschreiten
  const fxMax = Fz * Dx, fyMax = Fz * Dy;
  const s = Math.sqrt((fx / fxMax) ** 2 + (fy / fyMax) ** 2);
  if (s > 1) {
    fx /= s;
    fy /= s;
  }
  out.fx = fx;
  out.fy = fy;
  return out;
}
