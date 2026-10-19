# water — Roadmap to UE5 parity (and beyond)

The bar: Unreal Engine 5 water (Water system plugin, FluidFlux-class FFT
oceans, shallow-water sim, buoyancy, foam/caustics, underwater volumes).
Each phase ships a working demo + tests and ends shippable.

## P0 Foundation (DONE, v0.1)

- Gerstner ocean (4 waves, deep-water dispersion), custom ShaderMaterial:
  vertex displacement + chop, fresnel, sun glint, crest foam, horizon fade.
- Shared CPU/GPU wave model with agreement tests.
- Single-point buoyancy: spring-damper float, slope drift, tilt-to-normal.
- Demo: orbitable ocean, 4 floaters, reduced-motion support.
- 14 unit tests, typecheck, production build.

## P1a FFT detail + sky (DONE, v0.2)

- GPU FFT detail layer: Phillips spectrum (band-limited 1–16 m so Gerstner
  keeps the swell), per-frame evolution, 256² inverse FFT into a
  displacement texture sampled by the water vertex shader.
- CPU FFT reference proven against naive DFT; amplitude calibrated offline
  (peaks ≈ 0.3 m) with a bound test as tripwire.
- Sky dome with sun disc sharing the water's sun vector; value-noise foam.
- Headless render gate (`npm run shot`): screenshots plus non-blank,
  animated, error-free, and layout assertions. `?detail=0` A/B switch.
- 24 unit tests, typecheck, production build, screenshot evidence in shots/.

## P1b Reflections + depth (DONE, v0.3)

- Planar reflection (mirrored camera + oblique near-plane clip, half-res HDR
  target) and scene refraction with a depth texture.
- Beer–Lambert depth absorption over a displaced dune seabed with one
  breaching island; depth-driven shore foam ring at the waterline.
- Fragment-level ripple normals for the sun-glitter path; blob shadows under
  floaters; real sun shadows on the seabed; ACES output on water + sky.
- Debug views (`?debug=1..5`) for reflection, refraction, thickness, scene
  depth, and foam mask — used to verify every pass visually.
- Exit: ocean holds up at grazing angles; no per-frame CPU cost per vertex.
- 31 unit tests, typecheck, production build, screenshot evidence in shots/.

## P2 Buoyancy v2 (NEXT)

- Sampled displaced-volume buoyancy (probe grid per hull) with drag,
  angular response, and wave orbital velocity.
- Floating debris field + wakes/ripples spawned by moving bodies.
- Capsize/righting behavior for hull shapes.
- Exit: crates, buoys, and a plank hull each float distinctively; no jitter.

## P3 Shallow water (LATER)

- Heightfield shallow-water sim (GPU) with depth, flow velocity, obstacles.
- Dynamic ripples from bodies/rain; wetness/drying foam bands.
- Coupling: sim heightfield feeds back into buoyancy sampling.
- Exit: interactive pond demo — poke it and watch rings spread and fade.

## P4 Spray, foam & underwater (LATER)

- GPU spray/foam particles at crests and impacts; foam persistence texture.
- Caustics (analytic + projected), underwater fog/volume + surface-from-below.
- Exit: storm preset looks violent; dive-cam preset reads as underwater.

## P5 Large worlds (LATER)

- Tiled ocean LOD with skirt stitching, distance-simplified spectra.
- Wind fields + weather presets driving spectra, foam, and light.
- Deterministic time + fixed timestep for replays and tests.
- Exit: 10 km ocean at 60 fps on a mid GPU (measured, not hoped).

## P6 Validation (LATER)

- UE5 feature checklist scored honestly, gap by gap.
- Perf budgets per phase (frame time, memory) enforced in CI-lite scripts.
- Visual regression: headless screenshots vs checked-in references.

## Non-goals (for now)

Offline film-quality sim (different tradeoff curve), multiplayer-synced
water, mobile-first perf (desktop GPU is the current target rig).
