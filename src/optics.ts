/** Tiny optics helpers mirroring the water fragment formulas. */

/** Schlick fresnel. f0 = 0.02 for water. */
export function schlick(cosTheta: number, f0 = 0.02): number {
  const t = Math.min(Math.max(1 - cosTheta, 0), 1);
  return f0 + (1 - f0) * t ** 5;
}

/** Beer-Lambert transmission per channel for a water column. */
export function beerLambert(
  thickness: number,
  coeff: [number, number, number]
): [number, number, number] {
  const t = Math.max(thickness, 0);
  return [Math.exp(-coeff[0] * t), Math.exp(-coeff[1] * t), Math.exp(-coeff[2] * t)];
}
