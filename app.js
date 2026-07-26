(() => {
  "use strict";

  const THREE = window.THREE;
  const canvas = document.querySelector("#visualizer");
  const startupNotice = document.querySelector("#startupNotice");

  if (!THREE) {
    startupNotice.textContent = "THREE.JS FAILED TO LOAD";
    throw new Error("Three.js failed to load. Check vendor/three.min.js.");
  }

  const GRID_SIZE = 160;
  const CORE_COUNT = GRID_SIZE * GRID_SIZE;
  const MAX_ATMOSPHERE = 24000;
  const METEOR_SLOTS = 3;
  const METEOR_PARTICLES = 256;
  const RIPPLE_SLOTS = 6;
  const IMPACT_SLOTS = 8;
  const HARD_PARTICLE_LIMIT = 65536;
  const FIELD_SPACING = 0.27;
  const FIELD_HALF = ((GRID_SIZE - 1) * FIELD_SPACING) / 2;
  const FORM_CANVAS_SIZE = 160;
  const MOTION_TUNING = Object.freeze({
    rippleCooldown: 0.14,
    rippleDensityFloor: 0.72,
    impactCooldown: 0.34,
    impactDensityFloor: 2.15,
    meteorCooldown: 0.42,
    meteorDensityFloor: 1.35,
    idleRippleInterval: 1.45,
    idleImpactInterval: 4.4,
    idleMeteorInterval: 6.2,
  });

  const QUALITY_PROFILES = {
    stable: { label: "STABLE", atmosphere: 3000, pixelRatio: 1, glow: false },
    laptop: { label: "LAPTOP", atmosphere: 8000, pixelRatio: 1.25, glow: true },
    high: { label: "HIGH", atmosphere: 24000, pixelRatio: 1.25, glow: true },
  };

  if (CORE_COUNT + MAX_ATMOSPHERE > HARD_PARTICLE_LIMIT) {
    throw new Error("Particle budget exceeds the 65,536 point hard limit.");
  }

  const state = {
    scene: 0,
    speed: 0.32,
    density: 0.72,
    feedback: 0.58,
    warp: 0.42,
    size: 0.48,
    audioGain: 0.7,
    hue: 0.9,
    intensity: 0.8,
    blackout: false,
    freeze: false,
    echo: true,
    mode: "range",
    effect: 0,
    morph: 0,
    morphTarget: 0,
    particleLabel: "",
    quality: "laptop",
    calibrated: false,
    bass: 0,
    mid: 0,
    high: 0,
    subBass: 0,
    lowMid: 0,
    bpm: 0,
    bpmConfidence: 0,
    fps: 0,
    p95: 0,
    syntheticStress: false,
  };

  const SCENE_PRESETS = [
    { name: "RANGE ECHO", hue: 0.9, warp: 0.42, feedback: 0.58, camera: [0, 10.2, 27.5] },
    { name: "SILK CURRENT", hue: 0.5, warp: 0.3, feedback: 0.64, camera: [-7, 7.8, 25] },
    { name: "LIQUID LENS", hue: 0.78, warp: 0.2, feedback: 0.5, camera: [0, 14.2, 23.5] },
    { name: "ORBITAL", hue: 0.58, warp: 0.52, feedback: 0.72, camera: [9, 8.5, 25.5] },
    { name: "AURORA", hue: 0.38, warp: 0.66, feedback: 0.76, camera: [-10, 6.7, 24] },
    { name: "MONOLITH", hue: 0.08, warp: 0.14, feedback: 0.42, camera: [0, 8.2, 29] },
    { name: "SOLAR BLOOM", hue: 0.94, warp: 0.36, feedback: 0.68, camera: [7, 12.5, 25] },
    { name: "DEEP SPACE", hue: 0.7, warp: 0.62, feedback: 0.86, camera: [-5, 4.8, 24] },
  ];

  const dom = Object.fromEntries(
    [
      "audioStatus",
      "midiStatus",
      "oscStatus",
      "bassReadout",
      "midReadout",
      "highReadout",
      "bpmReadout",
      "modeLabel",
      "audioToggle",
      "audioInput",
      "echoToggle",
      "blackoutToggle",
      "freezeToggle",
      "randomize",
      "particleText",
      "textParticle",
      "imageInput",
      "clearParticle",
      "panelToggle",
      "panelClose",
      "rack",
      "scrim",
      "qualityReadout",
      "fpsReadout",
      "frameReadout",
      "particleReadout",
      "dprReadout",
    ].map((id) => [id, document.querySelector(`#${id}`)]),
  );

  const sliders = [...document.querySelectorAll("[data-param]")];
  const sceneButtons = [...document.querySelectorAll(".scene")];
  const modeButtons = [...document.querySelectorAll(".mode")];
  const effectButtons = [...document.querySelectorAll(".effect")];
  const qualityButtons = [...document.querySelectorAll(".quality")];

  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0));
    return x * x * (3 - 2 * x);
  }

  function setStatus(element, text, hot = false) {
    element.textContent = text;
    element.classList.toggle("hot", hot);
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
  } catch (error) {
    startupNotice.textContent = "WEBGL UNAVAILABLE";
    startupNotice.classList.remove("done");
    throw error;
  }

  renderer.setClearColor(0x030106, 1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030106, 0.018);

  const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 120);
  camera.position.set(0, 10.2, 27.5);
  camera.lookAt(0, 1.4, 0);

  const rippleUniforms = Array.from({ length: RIPPLE_SLOTS }, () => new THREE.Vector4(0, 0, 2, 0));
  const impactUniforms = Array.from({ length: IMPACT_SLOTS }, () => new THREE.Vector4(0, 0, 2, 0));
  const meteorUniforms = Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 0, 2, 0));
  const bandUniforms = Array.from({ length: 8 }, () => 0);
  const rawBandValues = Array.from({ length: 8 }, () => 0);

  const coreUniforms = {
    uTime: { value: 0 },
    uBands: { value: bandUniforms },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uIntensity: { value: state.intensity },
    uSize: { value: state.size },
    uWarp: { value: state.warp },
    uDensity: { value: state.density },
    uHue: { value: state.hue },
    uMode: { value: 0 },
    uMorph: { value: 0 },
    uEffect: { value: 0 },
    uEffectAmount: { value: 0 },
    uSceneStyle: { value: 0 },
    uSceneTransition: { value: 0 },
    uPointScale: { value: 1 },
    uRipples: { value: rippleUniforms },
    uImpacts: { value: impactUniforms },
  };

  const coreVertexShader = `
    precision highp float;
    attribute float aSeed;
    attribute float aBand;
    attribute float aMask;
    attribute vec3 aTarget;

    uniform float uTime;
    uniform float uBands[8];
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uIntensity;
    uniform float uSize;
    uniform float uWarp;
    uniform float uDensity;
    uniform float uHue;
    uniform float uMode;
    uniform float uMorph;
    uniform float uEffect;
    uniform float uEffectAmount;
    uniform float uSceneStyle;
    uniform float uSceneTransition;
    uniform float uPointScale;
    uniform vec4 uRipples[6];
    uniform vec4 uImpacts[8];

    varying float vEnergy;
    varying float vAlpha;
    varying float vSeed;
    varying float vHue;

    float readBand(float index) {
      if (index < 0.5) return uBands[0];
      if (index < 1.5) return uBands[1];
      if (index < 2.5) return uBands[2];
      if (index < 3.5) return uBands[3];
      if (index < 4.5) return uBands[4];
      if (index < 5.5) return uBands[5];
      if (index < 6.5) return uBands[6];
      return uBands[7];
    }

    mat2 rotate2d(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    void main() {
      vec3 field = position;
      float distanceFromCenter = length(field.xz);
      float bandEnergy = readBand(aBand);
      float radialFade = 1.0 - smoothstep(18.2, 23.0, distanceFromCenter);
      float densityGate = 1.0 - smoothstep(0.2 + uDensity * 0.74, 1.0, aSeed);
      float idle = 0.14
        + sin(distanceFromCenter * 0.54 - uTime * 0.72 + aSeed * 4.0) * 0.09
        + sin(field.x * 0.21 + field.z * 0.17 + uTime * 0.31) * 0.05;
      float angle = atan(field.z, field.x);
      float travelingBand = (
        sin(
          distanceFromCenter * (0.48 + aBand * 0.035)
          - uTime * (1.15 + uMid * 2.7)
          + aBand * 0.82
        ) * 0.5 + 0.5
      ) * bandEnergy;
      float crossCurrent = sin(
        field.x * 0.34
        + field.z * 0.27
        - uTime * (0.74 + uHigh * 3.6)
        + aSeed * 4.0
      ) * (uMid * 0.24 + uHigh * 0.16);
      float audioLift =
        pow(max(0.0, bandEnergy), 1.14) * (1.0 + uIntensity * 4.6)
        + travelingBand * (0.55 + uIntensity * 1.2)
        + crossCurrent;
      float centerForce = exp(-distanceFromCenter * 0.19) * (uBass * 5.2 + uMid * 1.7);
      float rippleLift = 0.0;
      float rippleFlash = 0.0;
      float impactLift = 0.0;
      float impactFlash = 0.0;

      for (int i = 0; i < 6; i++) {
        vec4 pulse = uRipples[i];
        float p = pulse.z;
        float radius = p * 27.5;
        float width = 0.48 + p * 0.9;
        float shell = exp(-pow((distanceFromCenter - radius) / width, 2.0));
        float wake = step(distanceFromCenter, radius)
          * max(0.0, sin((radius - distanceFromCenter) * 2.25))
          * exp(-(radius - distanceFromCenter) * 0.19);
        float fade = pow(max(0.0, 1.0 - p), 0.55) * pulse.w;
        rippleLift += (shell * 3.7 + wake * 0.46) * fade;
        rippleFlash += shell * fade;
      }

      for (int i = 0; i < 8; i++) {
        vec4 impact = uImpacts[i];
        float p = impact.z;
        float d = length(field.xz - impact.xy);
        float radius = p * 12.5;
        float shell = exp(-pow((d - radius) / (0.42 + p * 0.74), 2.0));
        float core = exp(-d * 0.7) * max(0.0, 1.0 - p * 2.8);
        float fade = pow(max(0.0, 1.0 - p), 0.72) * impact.w;
        impactLift += (shell * 5.2 - core * 2.1) * fade;
        impactFlash += (shell * 1.35 + core) * fade;
      }

      float totalLift = idle + audioLift + centerForce + rippleLift + impactLift;
      totalLift = sign(totalLift) * log(1.0 + abs(totalLift) * 0.82) * 1.55;
      field.y += totalLift;
      field.xz += vec2(
        sin(field.z * 0.3 + uTime + aSeed * 4.0),
        cos(field.x * 0.27 - uTime + aSeed * 3.0)
      ) * uWarp * (uMid * 0.16 + uHigh * 0.07);
      field.xz += vec2(cos(angle), sin(angle))
        * sin(angle * 6.0 - uTime * (0.9 + uHigh * 2.0) + distanceFromCenter * 0.22)
        * uWarp * (uMid + uHigh) * 0.075;

      // Eight scene memories share one field, but use genuinely different
      // spatial grammars. Keeping this in the vertex shader makes scene
      // changes cheap enough for the M1 budget.
      float sceneBand = floor(uSceneStyle + 0.5);
      if (sceneBand > 0.5 && sceneBand < 1.5) {
        // SILK CURRENT — broad, continuous travelling folds.
        field.y += sin(field.x * 0.22 + uTime * 0.74) * 1.25
          + cos(field.z * 0.17 - uTime * 0.48) * 0.72;
        field.x += sin(field.z * 0.13 + uTime * 0.3) * 0.55;
      } else if (sceneBand > 1.5 && sceneBand < 2.5) {
        // LIQUID LENS — smooth central bowl and pearlescent breathing.
        float lens = exp(-distanceFromCenter * 0.075);
        field.y += lens * (2.4 + sin(uTime * 0.58) * 1.15);
        field.xz *= 0.92 + lens * 0.1;
      } else if (sceneBand > 2.5 && sceneBand < 3.5) {
        // ORBITAL — a slowly opening spiral disc.
        field.xz = rotate2d(distanceFromCenter * 0.045 + uTime * 0.1) * field.xz;
        field.y += sin(angle * 4.0 + distanceFromCenter * 0.26 - uTime) * 0.72;
      } else if (sceneBand > 3.5 && sceneBand < 4.5) {
        // AURORA — diagonal ribbons with long, silky motion.
        field.y += sin(field.x * 0.16 + field.z * 0.09 - uTime * 0.62) * 1.65;
        field.z += sin(field.x * 0.11 + uTime * 0.28) * 0.85;
      } else if (sceneBand > 4.5 && sceneBand < 5.5) {
        // MONOLITH — restrained monochrome terraces.
        field.y = floor((field.y + sin(distanceFromCenter * 0.38 - uTime * 0.6)) * 2.2) / 2.2;
        field.xz *= 0.94;
      } else if (sceneBand > 5.5 && sceneBand < 6.5) {
        // BLOOM — petal-like radial sculpture.
        field.y += pow(max(0.0, cos(angle * 7.0 + uTime * 0.22)), 5.0)
          * exp(-distanceFromCenter * 0.055) * 3.2;
        field.xz *= 0.9 + 0.08 * sin(angle * 7.0);
      } else if (sceneBand > 6.5) {
        // DEEP SPACE — suspended constellation with greater Z depth.
        field.y += (aSeed - 0.5) * 5.2 + sin(aSeed * 31.0 + uTime * 0.3) * 0.5;
        field.z += (aSeed - 0.5) * 6.0;
      }

      // Scene changes contract, corkscrew and bloom. The event is visible,
      // while the particle pool and draw calls remain unchanged.
      float transitionBell = sin(clamp(uSceneTransition, 0.0, 1.0) * 3.14159265);
      float transitionTurn = transitionBell * (1.4 + aSeed * 2.3);
      field.xz = rotate2d(transitionTurn) * field.xz;
      field *= 1.0 - transitionBell * (0.2 + aSeed * 0.18);
      field.y += (aSeed - 0.5) * transitionBell * 8.0;

      vec3 form = aTarget;
      float effect = uEffectAmount;
      if (uEffect > 0.5 && uEffect < 1.5) {
        vec3 direction = normalize(form + vec3(aSeed - 0.5, aSeed * 0.4, 0.25));
        form += direction * effect * (4.0 + aSeed * 7.0);
      } else if (uEffect > 1.5 && uEffect < 2.5) {
        float turn = effect * (1.2 + length(form.xz) * 0.11) + uTime * 0.22;
        form.xz = rotate2d(turn) * form.xz;
        form.y += sin(length(form.xz) * 0.6 - uTime * 1.4) * effect * 0.7;
      } else if (uEffect > 2.5 && uEffect < 3.5) {
        form *= 1.0 + sin(uTime * 2.2 + aSeed * 2.0) * 0.12 * effect;
      } else if (uEffect > 3.5) {
        form.z += sin(form.x * 0.72 + uTime * 1.7 + aSeed * 2.0) * 1.7 * effect;
        form.y += cos(form.x * 0.31 + uTime) * 0.35 * effect;
      }

      vec3 transformed = mix(field, form, uMorph);
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      float energy = clamp(
        bandEnergy * 0.62 + rippleFlash * 0.72 + impactFlash + uBass * 0.18,
        0.0,
        2.2
      );
      float perspectiveSize = (16.0 + uSize * 21.0 + energy * 12.0)
        * (0.72 + aSeed * 0.46)
        * uPointScale
        / max(2.8, -mvPosition.z);

      gl_PointSize = clamp(perspectiveSize * 8.5, 1.0, 18.0);
      gl_Position = projectionMatrix * mvPosition;

      float formAlpha = mix(1.0, smoothstep(0.035, 0.52, aMask), uMorph);
      vAlpha = radialFade * densityGate * formAlpha;
      vEnergy = energy;
      vSeed = aSeed;
      vHue = uHue;
    }
  `;

  const coreFragmentShader = `
    precision highp float;
    varying float vEnergy;
    varying float vAlpha;
    varying float vSeed;
    varying float vHue;
    uniform float uIntensity;
    uniform float uSceneStyle;

    vec3 palette(float hueShift, float energy) {
      vec3 violet = vec3(0.31, 0.055, 0.52);
      vec3 magenta = vec3(1.0, 0.055, 0.58);
      vec3 pearl = vec3(1.0, 0.91, 0.99);
      float drift = clamp(hueShift + vSeed * 0.1, 0.0, 1.0);
      float style = floor(uSceneStyle + 0.5);
      vec3 base = mix(violet, magenta, 0.35 + drift * 0.45);
      if (style > 0.5 && style < 1.5) base = mix(vec3(0.05, 0.48, 0.78), vec3(0.66, 0.92, 1.0), drift);
      else if (style > 1.5 && style < 2.5) base = mix(vec3(0.38, 0.18, 0.55), vec3(1.0, 0.72, 0.84), drift);
      else if (style > 2.5 && style < 3.5) base = mix(vec3(0.18, 0.06, 0.55), vec3(0.18, 0.88, 0.78), drift);
      else if (style > 3.5 && style < 4.5) base = mix(vec3(0.08, 0.38, 0.52), vec3(0.72, 1.0, 0.68), drift);
      else if (style > 4.5 && style < 5.5) base = mix(vec3(0.18), vec3(0.92), drift);
      else if (style > 5.5 && style < 6.5) base = mix(vec3(0.72, 0.12, 0.22), vec3(1.0, 0.67, 0.12), drift);
      else if (style > 6.5) base = mix(vec3(0.12, 0.14, 0.48), vec3(0.58, 0.4, 1.0), drift);
      return mix(base, pearl, smoothstep(0.55, 1.7, energy));
    }

    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float radial = length(vec2(p.x * 1.5, p.y * 0.42));
      float core = 1.0 - smoothstep(0.02, 0.2, radial);
      float halo = 1.0 - smoothstep(0.08, 0.52, radial);
      float taper = 1.0 - smoothstep(0.34, 0.5, abs(p.y));
      float alpha = (core * 0.7 + halo * 0.13) * taper * vAlpha * 0.32;
      if (alpha < 0.012) discard;
      vec3 color = palette(vHue, vEnergy);
      float whiteCore = core * smoothstep(0.42, 1.5, vEnergy);
      color = mix(color, vec3(1.0, 0.97, 1.0), whiteCore);
      gl_FragColor = vec4(color * (0.48 + uIntensity * 0.42 + vEnergy * 0.24), alpha);
    }
  `;

  const coreGeometry = new THREE.BufferGeometry();
  const corePositions = new Float32Array(CORE_COUNT * 3);
  const coreTargets = new Float32Array(CORE_COUNT * 3);
  const coreSeeds = new Float32Array(CORE_COUNT);
  const coreBands = new Float32Array(CORE_COUNT);
  const coreMasks = new Float32Array(CORE_COUNT);

  for (let z = 0; z < GRID_SIZE; z += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = z * GRID_SIZE + x;
      const offset = index * 3;
      const gx = x * FIELD_SPACING - FIELD_HALF;
      const gz = z * FIELD_SPACING - FIELD_HALF;
      const radius = Math.sqrt(gx * gx + gz * gz);
      const normalizedFrequency = Math.pow(x / (GRID_SIZE - 1), 1.7);
      const seed = ((Math.sin(index * 12.9898) * 43758.5453) % 1 + 1) % 1;

      corePositions[offset] = gx;
      corePositions[offset + 1] = 0;
      corePositions[offset + 2] = gz;
      coreTargets[offset] = gx;
      coreTargets[offset + 1] = 0;
      coreTargets[offset + 2] = gz;
      coreSeeds[index] = seed;
      coreBands[index] = Math.min(7, Math.floor(normalizedFrequency * 8));
      coreMasks[index] = radius < FIELD_HALF * 1.06 ? 1 : smoothstep(FIELD_HALF * 1.22, FIELD_HALF, radius);
    }
  }

  coreGeometry.setAttribute("position", new THREE.BufferAttribute(corePositions, 3));
  coreGeometry.setAttribute("aTarget", new THREE.BufferAttribute(coreTargets, 3));
  coreGeometry.setAttribute("aSeed", new THREE.BufferAttribute(coreSeeds, 1));
  coreGeometry.setAttribute("aBand", new THREE.BufferAttribute(coreBands, 1));
  coreGeometry.setAttribute("aMask", new THREE.BufferAttribute(coreMasks, 1));

  const coreMaterial = new THREE.ShaderMaterial({
    uniforms: coreUniforms,
    vertexShader: coreVertexShader,
    fragmentShader: coreFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const coreField = new THREE.Points(coreGeometry, coreMaterial);
  coreField.frustumCulled = false;
  scene.add(coreField);

  const atmosphereUniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uIntensity: { value: state.intensity },
    uHue: { value: state.hue },
    uPointScale: { value: 1 },
    uMeteors: { value: meteorUniforms },
  };

  const atmosphereVertexShader = `
    precision highp float;
    attribute float aSeed;
    attribute float aKind;
    attribute float aLane;
    uniform float uTime;
    uniform float uBass;
    uniform float uMid;
    uniform float uHigh;
    uniform float uIntensity;
    uniform float uPointScale;
    uniform vec4 uMeteors[3];
    varying float vAlpha;
    varying float vHeat;
    varying float vMeteor;
    varying float vMeteorHead;
    varying float vDepth;

    mat2 rotate2d(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    vec4 meteorForLane(float lane) {
      if (lane < 0.5) return uMeteors[0];
      if (lane < 1.5) return uMeteors[1];
      return uMeteors[2];
    }

    void main() {
      vec3 transformed = position;
      vAlpha = 0.0;
      vHeat = 0.0;
      vMeteor = 0.0;
      vMeteorHead = 0.0;
      vDepth = 0.0;

      if (aKind > 0.5) {
        vec4 meteor = meteorForLane(aLane);
        float head = meteor.z;
        float headParticle = 1.0 - step(0.055, aSeed);
        float trailSeed = clamp((aSeed - 0.055) / 0.945, 0.0, 1.0);
        float brokenTail = step(
          0.84,
          fract(sin((floor(trailSeed * 34.0) + aLane * 9.0) * 71.31) * 43758.54)
        );
        float trail = headParticle > 0.5 ? aSeed * 0.008 : 0.008 + pow(trailSeed, 0.62) * 0.025;
        float p = head - trail;
        if (meteor.w > 0.0 && p > 0.0 && p < 1.0) {
          vec3 start = vec3(meteor.x + 7.4 - aLane * 1.1, 21.5 + aLane * 1.6, meteor.y - 13.0);
          vec3 end = vec3(meteor.x, 0.35, meteor.y);
          transformed = mix(start, end, p);
          vec3 direction = normalize(end - start);
          vec3 side = normalize(cross(direction, vec3(0.0, 0.0, 1.0)));
          float shardNoise = sin(aSeed * 391.7 + aLane * 13.0);
          transformed += side * shardNoise * mix(0.025, 0.48, trailSeed);
          transformed.z += cos(aSeed * 277.0) * mix(0.018, 0.54, trailSeed);
          vAlpha = mix(
            1.0,
            brokenTail * pow(1.0 - trailSeed, 1.5) * 0.5,
            1.0 - headParticle
          ) * meteor.w;
          vHeat = 1.0;
          vMeteor = 1.0;
          vMeteorHead = headParticle;
        } else {
          transformed = vec3(0.0, -200.0, 0.0);
        }
      } else {
        float drift = uTime * (0.18 + aSeed * 0.2 + uHigh * 0.58);
        float swirl = uTime * (0.008 + uMid * 0.052) * (aSeed - 0.5);
        float zSpeed = 2.8 + uMid * 4.5 + uHigh * 9.0 + aSeed * 1.8;
        float zTravel = mod(position.z + uTime * zSpeed + aSeed * 53.0, 58.0) - 29.0;
        float depth = smoothstep(-29.0, 24.0, zTravel);
        transformed.z = zTravel;
        transformed.xz = rotate2d(swirl) * transformed.xz;
        transformed.y = mod(
          position.y + drift * (1.0 + uBass * 1.2 + uHigh * 2.6),
          17.0
        ) - 1.0;
        transformed.x += sin(drift * 1.4 + aSeed * 23.0) * (0.8 + uMid * 1.6)
          + (aSeed - 0.5) * depth * 2.4;
        transformed.y += (aSeed - 0.5) * depth * 1.2;
        vAlpha = (0.075 + uHigh * 0.3 + uMid * 0.07)
          * (0.3 + aSeed * 0.7)
          * mix(0.42, 1.0, depth);
        vDepth = depth;
      }

      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      float meteorSize = mix(5.5 + (1.0 - aSeed) * 4.5, 24.0, vMeteorHead);
      float atmosphereSize = mix(2.0, 7.0, vDepth);
      gl_PointSize = clamp(
        mix(atmosphereSize, meteorSize, vMeteor)
          * uPointScale
          / max(2.6, -mvPosition.z)
          * 12.0,
        1.0,
        vMeteorHead > 0.5 ? 28.0 : 15.0
      );
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const atmosphereFragmentShader = `
    precision highp float;
    uniform float uIntensity;
    uniform float uHue;
    varying float vAlpha;
    varying float vHeat;
    varying float vMeteor;
    varying float vMeteorHead;
    varying float vDepth;

    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float angle = -0.33;
      mat2 meteorRotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      vec2 q = meteorRotation * p;
      float roundGlow = 1.0 - smoothstep(0.04, 0.5, length(p));
      float spearDistance = abs(q.x) * 2.25 + abs(q.y) * 0.42;
      float spearCore = 1.0 - smoothstep(0.035, 0.18, spearDistance);
      float spearHalo = 1.0 - smoothstep(0.08, 0.52, spearDistance);
      float headGlow = 1.0 - smoothstep(0.025, 0.5, length(q * vec2(1.0, 1.35)));
      float meteorGlow = spearCore * mix(0.82, 1.25, vMeteorHead)
        + spearHalo * mix(0.24, 0.46, vMeteorHead);
      float glow = mix(roundGlow * mix(0.55, 1.0, vDepth), meteorGlow, vMeteor);
      if (glow * vAlpha < 0.01) discard;
      vec3 pink = mix(vec3(0.55, 0.08, 0.72), vec3(1.0, 0.17, 0.67), uHue);
      vec3 color = mix(pink, vec3(1.0, 0.98, 0.91), vHeat);
      color = mix(color, vec3(1.0, 1.0, 1.0), vMeteorHead * headGlow);
      gl_FragColor = vec4(color * (0.58 + uIntensity * 0.56), glow * vAlpha);
    }
  `;

  const atmosphereGeometry = new THREE.BufferGeometry();
  const atmospherePositions = new Float32Array(MAX_ATMOSPHERE * 3);
  const atmosphereSeeds = new Float32Array(MAX_ATMOSPHERE);
  const atmosphereKinds = new Float32Array(MAX_ATMOSPHERE);
  const atmosphereLanes = new Float32Array(MAX_ATMOSPHERE);

  for (let i = 0; i < MAX_ATMOSPHERE; i += 1) {
    const offset = i * 3;
    const seed = ((Math.sin((i + 91) * 78.233) * 23157.774) % 1 + 1) % 1;
    const meteorIndex = i < METEOR_SLOTS * METEOR_PARTICLES ? Math.floor(i / METEOR_PARTICLES) : -1;
    atmospherePositions[offset] = (seed - 0.5) * 48;
    atmospherePositions[offset + 1] = ((seed * 17.37) % 1) * 17 - 1;
    atmospherePositions[offset + 2] = ((((seed + 0.37) * 31.71) % 1) - 0.5) * 42;
    atmosphereSeeds[i] =
      meteorIndex >= 0 ? (i % METEOR_PARTICLES) / METEOR_PARTICLES : seed;
    atmosphereKinds[i] = meteorIndex >= 0 ? 1 : 0;
    atmosphereLanes[i] = Math.max(0, meteorIndex);
  }

  atmosphereGeometry.setAttribute("position", new THREE.BufferAttribute(atmospherePositions, 3));
  atmosphereGeometry.setAttribute("aSeed", new THREE.BufferAttribute(atmosphereSeeds, 1));
  atmosphereGeometry.setAttribute("aKind", new THREE.BufferAttribute(atmosphereKinds, 1));
  atmosphereGeometry.setAttribute("aLane", new THREE.BufferAttribute(atmosphereLanes, 1));

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: atmosphereUniforms,
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const atmosphere = new THREE.Points(atmosphereGeometry, atmosphereMaterial);
  atmosphere.frustumCulled = false;
  scene.add(atmosphere);

  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postUniforms = {
    uScene: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uGlow: { value: 1 },
    uSceneStyle: { value: 0 },
  };
  const postMaterial = new THREE.ShaderMaterial({
    uniforms: postUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uScene;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform float uGlow;
      uniform float uSceneStyle;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 texel = 1.0 / max(uResolution, vec2(1.0));
        vec3 center = texture2D(uScene, vUv).rgb;
        vec3 bloom = vec3(0.0);
        bloom += texture2D(uScene, vUv + texel * vec2(2.0, 0.0)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(-2.0, 0.0)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(0.0, 2.0)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(0.0, -2.0)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(1.5, 1.5)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(-1.5, 1.5)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(1.5, -1.5)).rgb;
        bloom += texture2D(uScene, vUv + texel * vec2(-1.5, -1.5)).rgb;
        bloom *= 0.125;
        float vignette = smoothstep(0.86, 0.28, length(vUv - 0.5));
        float modernity = step(0.5, uSceneStyle);
        float grain = (hash(vUv * uResolution + uTime) - 0.5)
          * mix(0.012, 0.0025, modernity);
        vec3 color = center + max(bloom - 0.1, 0.0) * 0.18 * uGlow;
        color *= mix(0.72 + vignette * 0.28, 0.88 + vignette * 0.12, modernity);
        color += grain;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

  let renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  postUniforms.uScene.value = renderTarget.texture;

  const formCanvas = document.createElement("canvas");
  formCanvas.width = FORM_CANVAS_SIZE;
  formCanvas.height = FORM_CANVAS_SIZE;
  const formContext = formCanvas.getContext("2d", { willReadFrequently: true });

  const ripples = [];
  const impacts = [];
  const meteors = Array.from({ length: METEOR_SLOTS }, () => ({
    active: false,
    age: 0,
    life: 1,
    x: 0,
    z: 0,
    strength: 0,
  }));
  let rippleCursor = 0;
  let impactCursor = 0;
  let meteorCursor = 0;
  const eventCounters = {
    ripples: 0,
    impacts: 0,
    meteors: 0,
    densityFloorRipples: 0,
    densityFloorImpacts: 0,
    densityFloorMeteors: 0,
  };
  const motionDebug = {
    rawLowMid: 0,
    rawSubBass: 0,
    rawHigh: 0,
    lowFlux: 0,
    subFlux: 0,
    highFlux: 0,
    rippleThreshold: 0,
    impactThreshold: 0,
    meteorThreshold: 0,
    audible: false,
  };

  let audioContext;
  let analyser;
  let frequencyData;
  let audioSource;
  let microphoneStream;
  let audioElement;
  let audioObjectUrl;
  let testBandValues = null;
  let pointerX = 0.5;
  let pointerY = 0.48;
  let time = 0;
  let lastFrameAt = performance.now();
  let lastAudioAt = 0;
  let lastRippleAt = -10;
  let lastImpactAt = -10;
  let lastMeteorAt = -10;
  let previousRawLowMid = 0;
  let previousRawSubBass = 0;
  let previousRawHigh = 0;
  let rotation = 0;
  let rotationTarget = 0;
  const beatOnsets = [];
  let lastTempoOnsetAt = -10;
  let sceneTransition = 1;
  let sceneTransitionStartedAt = -10;
  let sceneTransitionDuration = 1.25;
  let cameraCutOffset = 0;
  let cameraDollyPulse = 0;
  let cameraCutPending = false;
  let tempoBeatCount = 0;
  const lowMidHistory = [];
  const subBassHistory = [];
  const highHistory = [];
  const frameTimes = [];
  let statsUpdatedAt = 0;
  let calibrationStartedAt = performance.now();
  let lowFpsDuration = 0;
  let idlePulseAt = -10;
  let idleImpactAt = -10;
  let idleMeteorAt = -10;

  function configureQuality(profileName) {
    const resolvedName = QUALITY_PROFILES[profileName] ? profileName : "laptop";
    const profile = QUALITY_PROFILES[resolvedName];
    state.quality = resolvedName;
    atmosphereGeometry.setDrawRange(0, profile.atmosphere);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    postUniforms.uGlow.value = profile.glow ? 1 : 0;
    qualityButtons.forEach((button) =>
      button.classList.toggle("active", button.dataset.quality === resolvedName),
    );
    dom.qualityReadout.textContent = profile.label;
    dom.particleReadout.textContent = `${((CORE_COUNT + profile.atmosphere) / 1000).toFixed(1)}k`;
    dom.dprReadout.textContent = String(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    resize();
  }

  function downgradeQuality() {
    if (state.quality === "high") {
      configureQuality("laptop");
      return;
    }
    if (state.quality === "laptop") configureQuality("stable");
  }

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const profile = QUALITY_PROFILES[state.quality];
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const effectiveDpr = Math.min(window.devicePixelRatio || 1, profile.pixelRatio);
    const targetWidth = Math.max(1, Math.floor((width * effectiveDpr) / 2));
    const targetHeight = Math.max(1, Math.floor((height * effectiveDpr) / 2));
    renderTarget.setSize(targetWidth, targetHeight);
    postUniforms.uResolution.value.set(targetWidth, targetHeight);
    coreUniforms.uPointScale.value = Math.sqrt(effectiveDpr);
    atmosphereUniforms.uPointScale.value = Math.sqrt(effectiveDpr);
  }

  function openPanel(open) {
    dom.rack.classList.toggle("open", open);
    dom.scrim.classList.toggle("open", open);
    dom.rack.setAttribute("aria-hidden", String(!open));
    dom.panelToggle.setAttribute("aria-expanded", String(open));
  }

  function setParam(name, value, shouldSend = true) {
    state[name] = clamp(Number(value));
    const slider = sliders.find((item) => item.dataset.param === name);
    if (slider) slider.value = state[name];
    if (shouldSend) sendParam(name, state[name]);
  }

  function setScene(index, shouldSend = true) {
    const nextScene = Math.max(0, Math.min(SCENE_PRESETS.length - 1, Number(index) || 0));
    if (nextScene !== state.scene || shouldSend) {
      sceneTransition = 0;
      sceneTransitionStartedAt = performance.now() / 1000;
      sceneTransitionDuration = state.bpmConfidence > 0.35 && state.bpm
        ? clamp(60 / state.bpm * 1.6, 0.75, 1.45)
        : 1.2;
      cameraCutOffset = (Math.random() - 0.5) * 0.72;
      cameraDollyPulse = 1;
      cameraCutPending = true;
    }
    state.scene = nextScene;
    sceneButtons.forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.scene) === state.scene),
    );
    const preset = SCENE_PRESETS[state.scene];
    setParam("hue", preset.hue, false);
    setParam("warp", preset.warp, false);
    setParam("feedback", preset.feedback, false);
    coreUniforms.uSceneStyle.value = state.scene;
    updateModeLabel();
    if (shouldSend) sendParam("scene", state.scene);
  }

  function setMode(mode) {
    state.mode = mode === "form" ? "form" : "range";
    if (state.mode === "form" && !state.particleLabel) applyTextForm();
    state.morphTarget = state.mode === "form" ? 1 : 0;
    modeButtons.forEach((button) =>
      button.classList.toggle("active", button.dataset.mode === state.mode),
    );
    updateModeLabel();
  }

  function setEffect(effect) {
    state.effect = Number(effect) || 0;
    effectButtons.forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.effect) === state.effect),
    );
    coreUniforms.uEffect.value = state.effect;
  }

  function updateModeLabel() {
    const audioLabel = analyser ? "LIVE AUDIO" : "IDLE";
    dom.modeLabel.textContent =
      state.mode === "form"
        ? `PARTICLE FORM / ${state.particleLabel || "ARE"}`
        : `${SCENE_PRESETS[state.scene].name} / ${audioLabel}`;
  }

  function normalizeTempo(bpm) {
    let value = bpm;
    while (value < 72) value *= 2;
    while (value > 168) value /= 2;
    return value;
  }

  function registerTempoOnset(nowSeconds, strength = 1) {
    if (nowSeconds - lastTempoOnsetAt < 0.24) return;
    lastTempoOnsetAt = nowSeconds;
    tempoBeatCount += 1;
    cameraDollyPulse = Math.max(cameraDollyPulse, strength * 0.7);
    beatOnsets.push({ time: nowSeconds, strength: clamp(strength, 0.15, 1) });
    while (beatOnsets.length > 36 || nowSeconds - beatOnsets[0].time > 18) beatOnsets.shift();
    if (beatOnsets.length < 5) return;

    const bins = new Float32Array(193); // 72–168 BPM in 0.5 BPM steps.
    for (let end = 1; end < beatOnsets.length; end += 1) {
      for (let gap = 1; gap <= 4 && end - gap >= 0; gap += 1) {
        const interval = beatOnsets[end].time - beatOnsets[end - gap].time;
        if (interval < 0.25 || interval > 3.4) continue;
        const candidate = normalizeTempo((60 * gap) / interval);
        const center = Math.round((candidate - 72) * 2);
        const recency = 0.55 + end / beatOnsets.length * 0.45;
        const weight =
          Math.sqrt(beatOnsets[end].strength * beatOnsets[end - gap].strength) *
          recency /
          Math.sqrt(gap);
        for (let offset = -3; offset <= 3; offset += 1) {
          const bin = center + offset;
          if (bin >= 0 && bin < bins.length) bins[bin] += weight * Math.exp(-offset * offset / 3.2);
        }
      }
    }

    let bestIndex = 0;
    let bestScore = 0;
    let totalScore = 0;
    bins.forEach((score, index) => {
      const candidate = 72 + index * 0.5;
      const continuity =
        state.bpm > 0 ? Math.exp(-Math.abs(candidate - state.bpm) / 16) * 0.18 + 0.82 : 1;
      const adjusted = score * continuity;
      totalScore += adjusted;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIndex = index;
      }
    });
    const estimate = 72 + bestIndex * 0.5;
    const confidence = clamp((bestScore / Math.max(0.001, totalScore)) * 9.5);
    state.bpmConfidence = state.bpmConfidence * 0.7 + confidence * 0.3;
    if (state.bpmConfidence > 0.2) {
      if (!state.bpm) state.bpm = estimate;
      else {
        const delta = estimate - state.bpm;
        const safeDelta = Math.abs(delta) > 24 && state.bpmConfidence < 0.58 ? 0 : delta;
        state.bpm += safeDelta * (0.08 + state.bpmConfidence * 0.16);
      }
    }
    if (
      strength > 0.72 &&
      state.bpmConfidence > 0.5 &&
      tempoBeatCount % 8 === 0
    ) {
      cameraCutOffset = (Math.random() < 0.5 ? -1 : 1) * (0.38 + Math.random() * 0.32);
      cameraCutPending = true;
    }
  }

  async function sendParam(name, value) {
    const isLocalServer =
      location.protocol.startsWith("http") &&
      ["localhost", "127.0.0.1"].includes(location.hostname);
    if (!isLocalServer) {
      setStatus(dom.oscStatus, "WEB ONLY", false);
      return;
    }
    try {
      const response = await fetch("/api/param", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, value }),
      });
      if (!response.ok) throw new Error(`OSC bridge returned ${response.status}`);
      setStatus(dom.oscStatus, "OSC SENT", true);
    } catch {
      setStatus(dom.oscStatus, "OSC OFF", false);
    }
  }

  function ensureAnalyser() {
    audioContext ||= new AudioContext();
    analyser ||= audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.68;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    return analyser;
  }

  function disconnectAudioSource() {
    try {
      audioSource?.disconnect();
    } catch {
      // The source may already have been disconnected by the browser.
    }
    audioSource = null;
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
    if (audioElement) {
      audioElement.pause();
      audioElement.src = "";
      audioElement = null;
    }
    if (audioObjectUrl) {
      URL.revokeObjectURL(audioObjectUrl);
      audioObjectUrl = null;
    }
  }

  async function connectAudioNode(source, monitor = false) {
    const nextAnalyser = ensureAnalyser();
    nextAnalyser.disconnect();
    audioSource = source;
    source.connect(nextAnalyser);
    if (monitor) nextAnalyser.connect(audioContext.destination);
    if (audioContext.state === "suspended") await audioContext.resume();
    updateModeLabel();
  }

  function describeAudioError(error) {
    if (!window.isSecureContext) return "MIC NEEDS HTTPS";
    if (!navigator.mediaDevices?.getUserMedia) return "NO MIC API";
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "MIC DENIED";
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "NO MIC";
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "MIC BUSY";
    return "AUDIO BLOCK";
  }

  async function startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("Microphone API unavailable"), { name: "NotSupportedError" });
    }
    disconnectAudioSource();
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const context = ensureAnalyser().context;
    await connectAudioNode(context.createMediaStreamSource(microphoneStream), false);
    setStatus(dom.audioStatus, "MIC LIVE", true);
    dom.audioToggle.classList.add("active");
  }

  async function startAudioFile(file) {
    if (!file) return;
    disconnectAudioSource();
    audioObjectUrl = URL.createObjectURL(file);
    audioElement = new Audio(audioObjectUrl);
    audioElement.loop = true;
    audioElement.crossOrigin = "anonymous";
    const context = ensureAnalyser().context;
    await connectAudioNode(context.createMediaElementSource(audioElement), true);
    const playback = audioElement.play();
    setStatus(dom.audioStatus, "FILE LIVE", true);
    dom.audioToggle.classList.remove("active");
    await playback;
  }

  function bandEnergy(fromHz, toHz) {
    if (!frequencyData || !audioContext) return 0;
    const nyquist = audioContext.sampleRate / 2;
    const start = Math.max(1, Math.floor((fromHz / nyquist) * frequencyData.length));
    const end = Math.min(
      frequencyData.length,
      Math.max(start + 1, Math.ceil((toHz / nyquist) * frequencyData.length)),
    );
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += frequencyData[index];
    return clamp((sum / Math.max(1, end - start) / 255) * state.audioGain * 1.55);
  }

  function channelStats(history, fallback = 0.03) {
    if (!history.length) return { mean: fallback, deviation: fallback * 0.35 };
    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const variance =
      history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
    return { mean, deviation: Math.sqrt(variance) };
  }

  function recordChannel(history, value) {
    history.push(value);
    if (history.length > 150) history.shift();
  }

  function spawnRipple(strength = 0.6, source = "audio") {
    const pulse = {
      age: 0,
      life: 1.75 + state.feedback * 1.05,
      strength: clamp(strength, 0.12, 1),
    };
    if (ripples.length < RIPPLE_SLOTS) ripples.push(pulse);
    else ripples[rippleCursor++ % RIPPLE_SLOTS] = pulse;
    eventCounters.ripples += 1;
    if (source === "density-floor") eventCounters.densityFloorRipples += 1;
  }

  function spawnImpact(strength = 0.75, x, z, source = "audio") {
    const radius = FIELD_HALF * 0.82 * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    const impact = {
      x: Number.isFinite(x) ? x : Math.cos(angle) * radius,
      z: Number.isFinite(z) ? z : Math.sin(angle) * radius,
      age: 0,
      life: 1.28 + state.feedback * 0.55,
      strength: clamp(strength, 0.18, 1),
    };
    if (impacts.length < IMPACT_SLOTS) impacts.push(impact);
    else impacts[impactCursor++ % IMPACT_SLOTS] = impact;
    eventCounters.impacts += 1;
    if (source === "density-floor") eventCounters.densityFloorImpacts += 1;
  }

  function spawnMeteor(strength = 0.72, source = "audio") {
    const slot = meteors[meteorCursor++ % METEOR_SLOTS];
    const radius = FIELD_HALF * 0.72 * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    slot.active = true;
    slot.age = 0;
    slot.life = 0.72 + (1 - strength) * 0.34;
    slot.x = Math.cos(angle) * radius;
    slot.z = Math.sin(angle) * radius;
    slot.strength = clamp(strength, 0.25, 1);
    eventCounters.meteors += 1;
    if (source === "density-floor") eventCounters.densityFloorMeteors += 1;
  }

  function updateAudio(nowSeconds) {
    const ranges = [
      [20, 55],
      [55, 95],
      [95, 165],
      [165, 310],
      [310, 620],
      [620, 1180],
      [1180, 2200],
      [2200, 3500],
    ];
    const analyserLive = Boolean(analyser && frequencyData);
    const live = analyserLive || Boolean(testBandValues);

    if (analyserLive) {
      analyser.getByteFrequencyData(frequencyData);
      ranges.forEach(([from, to], index) => {
        rawBandValues[index] = bandEnergy(from, to);
        bandUniforms[index] = bandUniforms[index] * 0.58 + rawBandValues[index] * 0.42;
      });
    } else if (testBandValues) {
      testBandValues.forEach((value, index) => {
        rawBandValues[index] = clamp(Number(value) || 0);
        bandUniforms[index] = bandUniforms[index] * 0.58 + rawBandValues[index] * 0.42;
      });
    } else {
      ranges.forEach((_, index) => {
        const wave =
          0.045 +
          Math.max(0, Math.sin(time * (0.42 + index * 0.055) - index * 0.74)) *
            (0.025 + (7 - index) * 0.004);
        rawBandValues[index] = wave;
        bandUniforms[index] = bandUniforms[index] * 0.9 + wave * 0.1;
      });
    }

    const subBass = bandUniforms[0] * 0.7 + bandUniforms[1] * 0.3;
    const bass = bandUniforms[1] * 0.35 + bandUniforms[2] * 0.65;
    const lowMid = bandUniforms[3] * 0.66 + bandUniforms[4] * 0.34;
    const mid = bandUniforms[4] * 0.42 + bandUniforms[5] * 0.38 + bandUniforms[6] * 0.2;
    let liveHigh;
    if (analyserLive) {
      liveHigh = bandEnergy(3500, 9500);
    } else if (testBandValues) {
      liveHigh = Math.max(testBandValues[7] || 0, (testBandValues[6] || 0) * 0.72);
    } else {
      liveHigh = 0.035 + Math.max(0, Math.sin(time * 0.71)) * 0.03;
    }

    state.subBass = state.subBass * 0.76 + subBass * 0.24;
    state.bass = state.bass * 0.78 + bass * 0.22;
    state.lowMid = state.lowMid * 0.8 + lowMid * 0.2;
    state.mid = state.mid * 0.84 + mid * 0.16;
    state.high = state.high * 0.76 + liveHigh * 0.24;

    if (state.syntheticStress) {
      state.subBass = 0.82;
      state.bass = 0.78;
      state.lowMid = 0.68;
      state.mid = 0.56;
      state.high = 0.7;
      bandUniforms.forEach((_, index) => {
        bandUniforms[index] = 0.48 + Math.sin(time * 2 + index) * 0.18;
      });
    }

    const lowMidEnergy = state.bass * 0.65 + state.lowMid * 0.92;
    const rawSubBass = rawBandValues[0] * 0.74 + rawBandValues[1] * 0.26;
    const rawLowMid =
      rawBandValues[2] * 0.18 + rawBandValues[3] * 0.54 + rawBandValues[4] * 0.28;
    const rawHigh = Math.max(
      liveHigh,
      rawBandValues[6] * 0.28 + rawBandValues[7] * 0.72,
    );
    const lowFlux = Math.max(0, rawLowMid - previousRawLowMid);
    const subFlux = Math.max(0, rawSubBass - previousRawSubBass);
    const highFlux = Math.max(0, rawHigh - previousRawHigh);
    const lowStats = channelStats(lowMidHistory, rawLowMid || 0.03);
    const subStats = channelStats(subBassHistory, rawSubBass || 0.025);
    const highStats = channelStats(highHistory, rawHigh || 0.018);
    const rippleThreshold = Math.max(0.035, lowStats.mean + lowStats.deviation * 0.28);
    const impactThreshold = Math.max(0.032, subStats.mean + subStats.deviation * 0.38);
    const meteorThreshold = Math.max(0.012, highStats.mean + highStats.deviation * 0.3);
    const rippleTransient =
      rawLowMid > rippleThreshold &&
      lowFlux > Math.max(0.0032, lowStats.deviation * 0.1);
    const subBassTransient =
      rawSubBass > impactThreshold &&
      subFlux > Math.max(0.0035, subStats.deviation * 0.12);
    const fallbackImpact =
      !subBassTransient &&
      rawLowMid > lowStats.mean + lowStats.deviation * 0.62 &&
      lowFlux > Math.max(0.005, lowStats.deviation * 0.16);
    const meteorTransient =
      rawHigh > meteorThreshold &&
      highFlux > Math.max(0.0018, highStats.deviation * 0.1);
    const tempoTransient =
      rippleTransient ||
      subBassTransient ||
      (
        rawLowMid > lowStats.mean + lowStats.deviation * 0.18 &&
        lowFlux > Math.max(0.0042, lowStats.deviation * 0.13)
      ) ||
      (
        rawSubBass > subStats.mean + subStats.deviation * 0.22 &&
        subFlux > Math.max(0.0044, subStats.deviation * 0.15)
      ) ||
      (
        rawLowMid > lowStats.mean &&
        highFlux > Math.max(0.012, highStats.deviation * 0.45)
      );
    const rippleActive = rawLowMid > Math.max(0.024, lowStats.mean * 0.72);
    const impactActive =
      Math.max(rawSubBass, rawLowMid * 0.68) >
      Math.max(0.025, Math.min(subStats.mean, lowStats.mean) * 0.7);
    const meteorActive = rawHigh > Math.max(0.009, highStats.mean * 0.68);
    const audible = rawLowMid > 0.012 || rawSubBass > 0.012 || rawHigh > 0.008;
    const rippleFloor = clamp(
      MOTION_TUNING.rippleDensityFloor - rawLowMid * 0.18,
      0.5,
      MOTION_TUNING.rippleDensityFloor,
    );

    if (live && audible && tempoTransient) {
      registerTempoOnset(
        nowSeconds,
        clamp(
          0.2 +
          rawLowMid * 0.82 +
          rawSubBass * 0.5 +
          lowFlux * 4.2 +
          subFlux * 3.2 +
          highFlux * 0.8,
        ),
      );
    } else if (nowSeconds - lastTempoOnsetAt > 3.5) {
      state.bpmConfidence *= 0.992;
      if (state.bpmConfidence < 0.08 && nowSeconds - lastTempoOnsetAt > 8) {
        state.bpm = 0;
      }
    }

    if (live && audible && nowSeconds - lastRippleAt > MOTION_TUNING.rippleCooldown) {
      const densityFloorHit = rippleActive && nowSeconds - lastRippleAt > rippleFloor;
      if (rippleTransient || densityFloorHit) {
        spawnRipple(
          clamp(0.24 + rawLowMid * 1.35 + lowFlux * 4.2),
          densityFloorHit && !rippleTransient ? "density-floor" : "audio",
        );
        if (rippleTransient) lastAudioAt = nowSeconds;
        lastRippleAt = nowSeconds;
      }
    }

    if (live && audible && nowSeconds - lastImpactAt > MOTION_TUNING.impactCooldown) {
      const densityFloorHit =
        impactActive && nowSeconds - lastImpactAt > MOTION_TUNING.impactDensityFloor;
      if (subBassTransient || fallbackImpact || densityFloorHit) {
        const sourceEnergy = subBassTransient ? rawSubBass : rawLowMid * 0.82;
        spawnImpact(
          clamp(0.26 + sourceEnergy * 1.55 + Math.max(subFlux, lowFlux) * 3.2),
          undefined,
          undefined,
          densityFloorHit && !subBassTransient && !fallbackImpact
            ? "density-floor"
            : "audio",
        );
        lastImpactAt = nowSeconds;
      }
    }

    if (live && audible && nowSeconds - lastMeteorAt > MOTION_TUNING.meteorCooldown) {
      const densityFloorHit =
        meteorActive && nowSeconds - lastMeteorAt > MOTION_TUNING.meteorDensityFloor;
      if (meteorTransient || densityFloorHit) {
        spawnMeteor(
          clamp(0.28 + rawHigh * 2.45 + highFlux * 5.2),
          densityFloorHit && !meteorTransient ? "density-floor" : "audio",
        );
        lastMeteorAt = nowSeconds;
      }
    }

    if (!live || !audible) {
      if (nowSeconds - idlePulseAt > MOTION_TUNING.idleRippleInterval) {
        spawnRipple(0.28, "idle");
        idlePulseAt = nowSeconds;
      }
      if (nowSeconds - idleImpactAt > MOTION_TUNING.idleImpactInterval) {
        spawnImpact(0.3, undefined, undefined, "idle");
        idleImpactAt = nowSeconds;
      }
      if (nowSeconds - idleMeteorAt > MOTION_TUNING.idleMeteorInterval) {
        spawnMeteor(0.32, "idle");
        idleMeteorAt = nowSeconds;
      }
    }

    recordChannel(lowMidHistory, rawLowMid);
    recordChannel(subBassHistory, rawSubBass);
    recordChannel(highHistory, rawHigh);
    previousRawLowMid = rawLowMid;
    previousRawSubBass = rawSubBass;
    previousRawHigh = rawHigh;
    Object.assign(motionDebug, {
      rawLowMid,
      rawSubBass,
      rawHigh,
      lowFlux,
      subFlux,
      highFlux,
      rippleThreshold,
      impactThreshold,
      meteorThreshold,
      audible,
    });

    coreUniforms.uBass.value = state.bass;
    coreUniforms.uMid.value = state.mid;
    coreUniforms.uHigh.value = state.high;
    atmosphereUniforms.uBass.value = state.bass;
    atmosphereUniforms.uMid.value = state.mid;
    atmosphereUniforms.uHigh.value = state.high;
    dom.bassReadout.textContent = state.bass.toFixed(2);
    dom.midReadout.textContent = state.mid.toFixed(2);
    dom.highReadout.textContent = state.high.toFixed(2);
    dom.bpmReadout.textContent =
      state.bpm && state.bpmConfidence > 0.18
        ? `${Math.round(state.bpm)}${state.bpmConfidence < 0.42 ? "?" : ""}`
        : "--";
  }

  function updateEvents(delta) {
    for (let index = ripples.length - 1; index >= 0; index -= 1) {
      ripples[index].age += delta;
      if (ripples[index].age >= ripples[index].life) ripples.splice(index, 1);
    }
    for (let index = impacts.length - 1; index >= 0; index -= 1) {
      impacts[index].age += delta;
      if (impacts[index].age >= impacts[index].life) impacts.splice(index, 1);
    }
    meteors.forEach((meteor) => {
      if (!meteor.active) return;
      meteor.age += delta;
      if (meteor.age >= meteor.life) {
        meteor.active = false;
        spawnImpact(meteor.strength * 0.72, meteor.x, meteor.z);
      }
    });

    if (state.syntheticStress) {
      while (ripples.length < RIPPLE_SLOTS) spawnRipple(0.82);
      while (impacts.length < IMPACT_SLOTS) spawnImpact(0.88);
      meteors.forEach((meteor) => {
        if (!meteor.active) spawnMeteor(0.82);
      });
    }

    for (let index = 0; index < RIPPLE_SLOTS; index += 1) {
      const pulse = ripples[index];
      rippleUniforms[index].set(
        0,
        0,
        pulse ? clamp(pulse.age / pulse.life) : 2,
        pulse ? pulse.strength * (state.echo ? 1 : 0) : 0,
      );
    }
    for (let index = 0; index < IMPACT_SLOTS; index += 1) {
      const impact = impacts[index];
      impactUniforms[index].set(
        impact?.x || 0,
        impact?.z || 0,
        impact ? clamp(impact.age / impact.life) : 2,
        impact ? impact.strength : 0,
      );
    }
    for (let index = 0; index < METEOR_SLOTS; index += 1) {
      const meteor = meteors[index];
      meteorUniforms[index].set(
        meteor.x,
        meteor.z,
        meteor.active ? clamp(meteor.age / meteor.life) : 2,
        meteor.active ? meteor.strength : 0,
      );
    }
  }

  function updatePerformance(now, delta) {
    const milliseconds = delta * 1000;
    if (milliseconds > 0 && milliseconds < 200) {
      frameTimes.push(milliseconds);
      if (frameTimes.length > 360) frameTimes.shift();
    }

    if (now - statsUpdatedAt > 500 && frameTimes.length > 10) {
      const recent = frameTimes.slice(-120);
      const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
      const sorted = [...recent].sort((a, b) => a - b);
      state.fps = Math.min(60, 1000 / average);
      state.p95 = sorted[Math.floor(sorted.length * 0.95)] || average;
      dom.fpsReadout.textContent = state.fps.toFixed(0);
      dom.frameReadout.textContent = `${state.p95.toFixed(1)} ms`;
      statsUpdatedAt = now;
    }

    if (!state.calibrated && now - calibrationStartedAt >= 3000) {
      state.calibrated = true;
      if (state.fps > 0 && state.fps < 54) configureQuality("stable");
      startupNotice.classList.add("done");
    }

    if (state.calibrated && state.fps > 0 && state.fps < 52) lowFpsDuration += delta;
    else lowFpsDuration = Math.max(0, lowFpsDuration - delta * 0.5);

    if (lowFpsDuration >= 2 && state.quality !== "stable") {
      downgradeQuality();
      lowFpsDuration = 0;
    }
  }

  function renderFrame() {
    const profile = QUALITY_PROFILES[state.quality];
    renderer.info.reset();
    if (profile.glow) {
      renderer.setRenderTarget(renderTarget);
      renderer.setClearColor(0x030106, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x030106, 1);
      renderer.render(postScene, postCamera);
    } else {
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x030106, 1);
      renderer.render(scene, camera);
    }
  }

  function draw(now) {
    const delta = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;

    if (!state.freeze) {
      time += delta * (0.72 + state.speed * 0.9);
      updateAudio(now / 1000);
      updateEvents(delta);
      const bpm = state.bpm || 72;
      rotationTarget = (bpm / 60) * (0.012 + state.speed * 0.034);
      rotation += delta * rotationTarget;
      state.morph += (state.morphTarget - state.morph) * Math.min(1, delta * 2.8);
      if (sceneTransition < 1) {
        sceneTransition = clamp(
          (now / 1000 - sceneTransitionStartedAt) / sceneTransitionDuration,
        );
      }
      cameraDollyPulse *= Math.exp(-delta * 3.6);
      cameraCutOffset *= Math.exp(-delta * 0.72);
    }

    coreUniforms.uTime.value = time;
    coreUniforms.uIntensity.value = state.intensity;
    coreUniforms.uSize.value = state.size;
    coreUniforms.uWarp.value = state.warp;
    coreUniforms.uDensity.value = state.density;
    coreUniforms.uHue.value = state.hue;
    coreUniforms.uMode.value = state.mode === "form" ? 1 : 0;
    coreUniforms.uMorph.value = state.morph;
    coreUniforms.uEffect.value = state.effect;
    coreUniforms.uSceneStyle.value = state.scene;
    coreUniforms.uSceneTransition.value = sceneTransition;
    coreUniforms.uEffectAmount.value +=
      ((state.mode === "form" && state.effect > 0 ? 1 : 0) -
        coreUniforms.uEffectAmount.value) *
      Math.min(1, delta * 2.2);
    atmosphereUniforms.uTime.value = time;
    atmosphereUniforms.uIntensity.value = state.intensity;
    atmosphereUniforms.uHue.value = state.hue;
    postUniforms.uTime.value = time;
    postUniforms.uSceneStyle.value = state.scene;

    coreField.visible = !state.blackout;
    atmosphere.visible = !state.blackout;
    const desiredCoreRotation =
      state.mode === "form" ? Math.sin(time * 0.22) * 0.08 : rotation;
    coreField.rotation.y +=
      (desiredCoreRotation - coreField.rotation.y) * Math.min(1, delta * 3.6);
    atmosphere.rotation.y = rotation * 0.58;

    const cameraPreset = SCENE_PRESETS[state.scene].camera;
    const bpmPhase = time * ((state.bpm || 72) / 60);
    const orbit =
      (pointerX - 0.5) * 0.32 +
      Math.sin(bpmPhase * 0.32 + state.scene) * (0.05 + state.scene * 0.006) +
      cameraCutOffset;
    const targetX = cameraPreset[0] + Math.sin(orbit) * 8.5;
    const targetY =
      cameraPreset[1] +
      (0.5 - pointerY) * 2.2 +
      Math.sin(bpmPhase * 0.18) * 0.42;
    const targetZ =
      cameraPreset[2] +
      Math.cos(orbit) * 1.3 -
      cameraDollyPulse * (2.2 + state.bass * 1.8);
    const cameraEase = Math.min(1, delta * (state.scene === 0 ? 2.2 : 1.6));
    if (cameraCutPending) {
      camera.position.set(targetX, targetY, targetZ);
      cameraCutPending = false;
    } else {
      camera.position.x += (targetX - camera.position.x) * cameraEase;
      camera.position.y += (targetY - camera.position.y) * cameraEase;
      camera.position.z += (targetZ - camera.position.z) * cameraEase;
    }
    camera.lookAt(
      Math.sin(bpmPhase * 0.22 + state.scene) * 0.7,
      1.3 + state.bass * 1.4,
      Math.cos(bpmPhase * 0.17) * 0.55,
    );

    renderFrame();
    updatePerformance(now, delta);
    requestAnimationFrame(draw);
  }

  function setFormTargetsFromCanvas(label) {
    const pixels = formContext.getImageData(0, 0, FORM_CANVAS_SIZE, FORM_CANVAS_SIZE).data;
    const targetAttribute = coreGeometry.getAttribute("aTarget");
    const maskAttribute = coreGeometry.getAttribute("aMask");

    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const index = y * GRID_SIZE + x;
        const pixelOffset = index * 4;
        const alpha = pixels[pixelOffset + 3] / 255;
        const luminance =
          (pixels[pixelOffset] * 0.2126 +
            pixels[pixelOffset + 1] * 0.7152 +
            pixels[pixelOffset + 2] * 0.0722) /
          255;
        const mask =
          alpha < 0.985
            ? alpha * Math.max(luminance, 0.86)
            : alpha * luminance;
        const offset = index * 3;
        const jitter = (coreSeeds[index] - 0.5) * 0.2;
        targetAttribute.array[offset] = (x / (GRID_SIZE - 1) - 0.5) * 23.5;
        targetAttribute.array[offset + 1] = (0.5 - y / (GRID_SIZE - 1)) * 15.5 + 6.1;
        targetAttribute.array[offset + 2] = (luminance - 0.5) * 1.7 + jitter;
        maskAttribute.array[index] = mask;
      }
    }

    targetAttribute.needsUpdate = true;
    maskAttribute.needsUpdate = true;
    state.particleLabel = label;
    setMode("form");
  }

  function applyTextForm() {
    const label = (dom.particleText.value.trim() || "ARE").toUpperCase();
    formContext.clearRect(0, 0, FORM_CANVAS_SIZE, FORM_CANVAS_SIZE);
    formContext.fillStyle = "#ffffff";
    formContext.textAlign = "center";
    formContext.textBaseline = "middle";
    const fontSize = Math.max(28, Math.min(72, 124 / Math.max(1, label.length * 0.56)));
    formContext.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
    formContext.fillText(label, FORM_CANVAS_SIZE / 2, FORM_CANVAS_SIZE / 2, 146);
    setFormTargetsFromCanvas(label);
  }

  async function applyImageForm(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !file.name.toLowerCase().endsWith(".svg")) {
      setStatus(dom.audioStatus, "IMAGE TYPE", false);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      formContext.clearRect(0, 0, FORM_CANVAS_SIZE, FORM_CANVAS_SIZE);
      const scale = Math.min(
        (FORM_CANVAS_SIZE * 0.86) / image.naturalWidth,
        (FORM_CANVAS_SIZE * 0.86) / image.naturalHeight,
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      formContext.drawImage(
        image,
        (FORM_CANVAS_SIZE - width) / 2,
        (FORM_CANVAS_SIZE - height) / 2,
        width,
        height,
      );
      setFormTargetsFromCanvas(file.name.replace(/\.[^.]+$/, "").toUpperCase().slice(0, 14));
    } catch {
      setStatus(dom.audioStatus, "IMAGE FAILED", false);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function clearParticleForm() {
    state.particleLabel = "";
    state.morphTarget = 0;
    setMode("range");
  }

  function randomizeParameters() {
    setParam("speed", 0.18 + Math.random() * 0.42);
    setParam("density", 0.56 + Math.random() * 0.38);
    setParam("feedback", 0.42 + Math.random() * 0.48);
    setParam("warp", 0.18 + Math.random() * 0.58);
    setParam("size", 0.34 + Math.random() * 0.36);
    setParam("hue", 0.62 + Math.random() * 0.38);
    setParam("intensity", 0.66 + Math.random() * 0.3);
  }

  function connectMidi() {
    if (!navigator.requestMIDIAccess) {
      setStatus(dom.midiStatus, "NO MIDI", false);
      return;
    }
    navigator
      .requestMIDIAccess()
      .then((access) => {
        const attach = () => {
          const inputs = [...access.inputs.values()];
          setStatus(dom.midiStatus, inputs.length ? "MIDI ON" : "MIDI WAIT", Boolean(inputs.length));
          inputs.forEach((input) => {
            input.onmidimessage = onMidi;
          });
        };
        attach();
        access.onstatechange = attach;
      })
      .catch(() => setStatus(dom.midiStatus, "MIDI BLOCK", false));
  }

  function onMidi(event) {
    const [status, control, value] = event.data;
    const command = status & 0xf0;
    const normalized = value / 127;
    const ccMap = {
      1: "speed",
      2: "density",
      3: "feedback",
      4: "warp",
      5: "size",
      6: "audioGain",
      7: "hue",
      8: "intensity",
    };
    if (command === 0xb0 && ccMap[control]) setParam(ccMap[control], normalized);
    if (command === 0x90 && value > 0 && control >= 36 && control <= 43) {
      setScene(control - 36);
    }
  }

  sliders.forEach((slider) => {
    slider.addEventListener("input", () => setParam(slider.dataset.param, slider.value));
  });
  sceneButtons.forEach((button) => {
    button.addEventListener("click", () => setScene(button.dataset.scene));
  });
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  effectButtons.forEach((button) => {
    button.addEventListener("click", () => setEffect(button.dataset.effect));
  });
  qualityButtons.forEach((button) => {
    button.addEventListener("click", () => configureQuality(button.dataset.quality));
  });

  dom.panelToggle.addEventListener("click", () => openPanel(true));
  dom.panelClose.addEventListener("click", () => openPanel(false));
  dom.scrim.addEventListener("click", () => openPanel(false));
  dom.audioToggle.addEventListener("click", () => {
    startMicrophone().catch((error) =>
      setStatus(dom.audioStatus, describeAudioError(error), false),
    );
  });
  dom.audioInput.addEventListener("change", () => {
    startAudioFile(dom.audioInput.files?.[0]).catch((error) =>
      setStatus(dom.audioStatus, describeAudioError(error), false),
    );
  });
  dom.echoToggle.addEventListener("click", () => {
    state.echo = !state.echo;
    dom.echoToggle.classList.toggle("active", state.echo);
    sendParam("echo", state.echo ? 1 : 0);
  });
  dom.blackoutToggle.addEventListener("click", () => {
    state.blackout = !state.blackout;
    dom.blackoutToggle.classList.toggle("active", state.blackout);
    sendParam("blackout", state.blackout ? 1 : 0);
  });
  dom.freezeToggle.addEventListener("click", () => {
    state.freeze = !state.freeze;
    dom.freezeToggle.classList.toggle("active", state.freeze);
    sendParam("freeze", state.freeze ? 1 : 0);
  });
  dom.randomize.addEventListener("click", randomizeParameters);
  dom.textParticle.addEventListener("click", applyTextForm);
  dom.particleText.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyTextForm();
  });
  dom.imageInput.addEventListener("change", () => applyImageForm(dom.imageInput.files?.[0]));
  dom.clearParticle.addEventListener("click", clearParticleForm);

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    pointerX = event.clientX / Math.max(1, window.innerWidth);
    pointerY = event.clientY / Math.max(1, window.innerHeight);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") openPanel(false);
  });
  document.addEventListener("visibilitychange", () => {
    lastFrameAt = performance.now();
    if (!document.hidden && audioContext?.state === "suspended") audioContext.resume().catch(() => {});
  });

  window.__AV_TEST__ = {
    metrics: () => ({
      fps: state.fps,
      p95: state.p95,
      quality: state.quality,
      particles: CORE_COUNT + QUALITY_PROFILES[state.quality].atmosphere,
      pixelRatio: renderer.getPixelRatio(),
      coreCount: CORE_COUNT,
      atmosphereCount: QUALITY_PROFILES[state.quality].atmosphere,
      ripples: ripples.length,
      impacts: impacts.length,
      meteors: meteors.filter((meteor) => meteor.active).length,
      eventCounters: { ...eventCounters },
      motion: { ...motionDebug },
      bpm: state.bpm,
      bpmConfidence: state.bpmConfidence,
      scene: state.scene,
      sceneName: SCENE_PRESETS[state.scene].name,
      sceneTransition,
      renderer: renderer.info.render,
    }),
    stress: (enabled = true) => {
      state.syntheticStress = Boolean(enabled);
      if (enabled) {
        while (ripples.length < RIPPLE_SLOTS) spawnRipple(0.82);
        while (impacts.length < IMPACT_SLOTS) spawnImpact(0.88);
        meteors.forEach((meteor) => {
          if (!meteor.active) spawnMeteor(0.82);
        });
      }
      return state.syntheticStress;
    },
    ripple: spawnRipple,
    impact: spawnImpact,
    meteor: spawnMeteor,
    resetCounters: () => {
      Object.keys(eventCounters).forEach((key) => {
        eventCounters[key] = 0;
      });
      return { ...eventCounters };
    },
    feedBands: (values) => {
      if (values == null) {
        testBandValues = null;
        return null;
      }
      testBandValues = Array.from({ length: 8 }, (_, index) =>
        clamp(Number(values[index]) || 0),
      );
      return [...testBandValues];
    },
    tuning: MOTION_TUNING,
    quality: (name) => configureQuality(name),
    scene: setScene,
    mode: setMode,
    effect: setEffect,
    tempoOnset: registerTempoOnset,
    resetTempo: () => {
      beatOnsets.length = 0;
      lastTempoOnsetAt = -10;
      state.bpm = 0;
      state.bpmConfidence = 0;
    },
  };

  configureQuality("laptop");
  setScene(0, false);
  setEffect(0);
  setMode("range");
  spawnRipple(0.48);
  spawnImpact(0.35, -4.8, 2.5);
  connectMidi();
  resize();
  calibrationStartedAt = performance.now();
  requestAnimationFrame(draw);
})();
