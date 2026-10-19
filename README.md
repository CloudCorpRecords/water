# water

Advanced real-time water for the web: ocean rendering + buoyancy physics,
built in the open toward UE5 parity. v0.3 is a hybrid ocean — Gerstner swell
plus a GPU FFT detail layer — with planar reflections, depth absorption,
a breaching island with shore foam, sun glitter, shadows, floating bodies,
sky, and a headless render gate.

## Run

```sh
cd water
npm install
npm test        # 31 unit tests (waves, FFT math, buoyancy, optics, CPU/GPU agreement)
npm run typecheck
npm run build   # static bundle in dist/
npm run shot    # build + headless screenshots + render assertions
npm run dev     # local demo at http://localhost:5173
```

Controls: drag to orbit, scroll to zoom, right-drag to pan. Honors
`prefers-reduced-motion` (freezes the waves, orbit still works).

## Architecture

One wave model, two consumers, plus a GPU detail layer:

- `src/waves.ts` — pure math. Four Gerstner waves with deep-water dispersion
  (ω = √(g·k)). `waveHeight` / `waveNormal` sample the field on CPU.
- `src/waterMaterial.ts` — generates the GLSL vertex shader from those same
  constants (no hand-duplicated numbers), adding horizontal Gerstner chop.
  Fragment: planar reflection, refraction with Beer–Lambert absorption,
  fresnel, sun glint + glitter normals, crest + shore foam, blob shadows.
- `src/reflection.ts` — mirrored-camera planar reflection with oblique
  near-plane clipping and projective texturing (half-res, HDR target).
- `src/seabed.ts` — displaced dune bed with a breaching island, baked sand
  vertex colors, receives real sun shadows.
- `src/optics.ts` — pure-math optics (fresnel, Beer–Lambert, depth
  reconstruction, blob shadows) mirroring the shader, agreement-tested.
- `src/buoyancy.ts` — per-floater spring-damper against the sampled swell
  height, slope drift, and tilt-to-normal. Follows the swell; the FFT
  detail (±0.3 m chop) is visual-only by design. Tested headless in Node.
- `src/spectrum.ts` + `src/fft.ts` — Phillips spectrum (wind-aligned,
  band-limited to the 1–16 m detail range) and a CPU FFT reference proven
  against naive DFT. Calibrates the GPU FFT's amplitude offline.
- `src/ocean.ts` — GPU FFT detail: per-frame spectrum evolution plus a
  256² inverse FFT (bit-reversal + DIT stages) into a displacement texture.
- `src/sky.ts` — gradient dome with sun disc, sharing the sun vector.
- `src/main.ts` — scene, lights, water mesh, four floaters, loop.
- `scripts/shot.mjs` — headless render gate (screenshots + non-blank,
  animated, error-free, layout assertions). `?detail=0` disables FFT for A/B;
  `?debug=1..5` shows reflection / refraction / thickness / scene depth /
  foam-mask views.

The CPU sampler ignores horizontal chop (centimeter-scale); the shader bakes
the identical vertical field. A test pins every shared constant into the
generated GLSL so the two can never silently drift.

## Roadmap

See [ROADMAP.md](ROADMAP.md) — phased plan through FFT oceans, reflections,
shallow-water simulation, spray/foam, underwater, and large worlds, with a
UE5 feature checklist as the bar.
