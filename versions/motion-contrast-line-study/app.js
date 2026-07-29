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
  const ONBOARDING_KEY = "rangeEchoOnboardingSeenV2";
  const FIELD_SPACING = 0.27;
  const FIELD_HALF = ((GRID_SIZE - 1) * FIELD_SPACING) / 2;
  const FORM_CANVAS_SIZE = 160;
  const MOTION_TUNING = Object.freeze({
    rippleCooldown: 0.14,
    rippleDensityFloor: 0.52,
    impactCooldown: 0.3,
    impactDensityFloor: 1.35,
    meteorCooldown: 0.32,
    meteorDensityFloor: 1.1,
  });
  const AUDIO_TUNING = Object.freeze({
    noiseFloorCeiling: 0.04,
    noiseGateMinimum: 0.05,
    noiseGateMultiplier: 1.8,
  });

  const QUALITY_PROFILES = {
    stable: { label: "STABLE", atmosphere: 3000, pixelRatio: 1, glow: false },
    laptop: { label: "LAPTOP", atmosphere: 8000, pixelRatio: 1.25, glow: true },
    high: { label: "HIGH / LAPTOP MAX", atmosphere: 24000, pixelRatio: 1.25, glow: true },
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
    lowSensitivity: 0.82,
    midSensitivity: 0.74,
    highSensitivity: 0.68,
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
    language: localStorage.getItem("rangeEchoLanguage") || "en",
  };

  const SCENE_PRESETS = [
    {
      name: "RANGE ECHO",
      hueOffset: 0,
      warpScale: 1,
      feedbackOffset: 0,
      fov: 56,
      camera: [0, 8.4, 28.8],
      lookAt: [0, 1.3, 0],
      orbitRate: 0.1,
      orbitRadius: 1.8,
      orbitDepth: 0.8,
      cameraBob: 0.35,
      cameraFollow: 1.8,
      tunnelDirection: 1,
      tunnelSpeed: 0.055,
    },
    {
      name: "SILK CURRENT",
      hueOffset: -0.08,
      warpScale: 1.26,
      feedbackOffset: 0.12,
      fov: 43,
      camera: [-8.5, 14.2, 24.8],
      lookAt: [-1.2, 1.5, 0.4],
      orbitRate: 0.2,
      orbitRadius: 3.6,
      orbitDepth: 1.8,
      cameraBob: 1.0,
      cameraFollow: 2.8,
      tunnelDirection: -1,
      tunnelSpeed: 0.07,
    },
    {
      name: "LIQUID LENS",
      hueOffset: 0.1,
      warpScale: 0.72,
      feedbackOffset: -0.06,
      fov: 32,
      camera: [0, 27.0, 20.5],
      lookAt: [0, 0.8, 0],
      orbitRate: 0.12,
      orbitRadius: 2.2,
      orbitDepth: 1.2,
      cameraBob: 0.5,
      cameraFollow: 2.0,
      tunnelDirection: 1,
      tunnelSpeed: 0.05,
    },
    {
      name: "ORBITAL",
      hueOffset: -0.2,
      warpScale: 1.42,
      feedbackOffset: 0.04,
      fov: 64,
      camera: [10.5, 6.2, 22.2],
      lookAt: [0.5, 1.25, -0.5],
      orbitRate: 0.48,
      orbitRadius: 6.2,
      orbitDepth: 3.8,
      cameraBob: 1.65,
      cameraFollow: 5.4,
      tunnelDirection: 1,
      tunnelSpeed: 0.12,
    },
    {
      name: "AURORA",
      hueOffset: -0.34,
      warpScale: 1.58,
      feedbackOffset: 0.16,
      fov: 47,
      camera: [-12.5, 20.5, 22.2],
      lookAt: [-0.6, 1.2, 0.2],
      orbitRate: 0.26,
      orbitRadius: 4.6,
      orbitDepth: 2.4,
      cameraBob: 1.2,
      cameraFollow: 3.4,
      tunnelDirection: -1,
      tunnelSpeed: 0.085,
    },
    {
      name: "MONOLITH",
      hueOffset: 0.18,
      warpScale: 0.42,
      feedbackOffset: -0.14,
      fov: 28,
      camera: [0, 12.0, 33.5],
      lookAt: [0, 2.1, 0],
      orbitRate: 0.065,
      orbitRadius: 0.9,
      orbitDepth: 0.45,
      cameraBob: 0.22,
      cameraFollow: 1.35,
      tunnelDirection: -1,
      tunnelSpeed: 0.04,
    },
    {
      name: "SOLAR BLOOM",
      hueOffset: 0.06,
      warpScale: 0.86,
      feedbackOffset: 0.1,
      fov: 70,
      camera: [9.0, 29.0, 18.5],
      lookAt: [0.8, 1.0, -0.8],
      orbitRate: 0.32,
      orbitRadius: 4.2,
      orbitDepth: 2.8,
      cameraBob: 1.4,
      cameraFollow: 4.1,
      tunnelDirection: 1,
      tunnelSpeed: 0.1,
    },
    {
      name: "DEEP SPACE",
      hueOffset: -0.14,
      warpScale: 1.18,
      feedbackOffset: 0.22,
      fov: 38,
      camera: [-6.8, 4.8, 19.2],
      lookAt: [0, 1.0, -2.2],
      orbitRate: 0.58,
      orbitRadius: 7.4,
      orbitDepth: 5.0,
      cameraBob: 1.1,
      cameraFollow: 6.0,
      tunnelDirection: -1,
      tunnelSpeed: 0.15,
    },
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
      "sampleToggle",
      "samplePlayer",
      "auditionToggle",
      "auditionPlayer",
      "auditionHelp",
      "guideToggle",
      "languageToggle",
      "onboarding",
      "onboardingStart",
      "onboardingBlackhole",
      "onboardingSample",
      "onboardingSkip",
      "blackholeGuide",
      "blackholeDownload",
      "onboardingHint",
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

  function fract(value) {
    return ((value % 1) + 1) % 1;
  }

  function setStatus(element, text, hot = false) {
    element.textContent = text;
    element.classList.toggle("hot", hot);
  }

  function scenePreset() {
    return SCENE_PRESETS[state.scene] || SCENE_PRESETS[0];
  }

  function effectiveFeedback() {
    return clamp(state.feedback + scenePreset().feedbackOffset, 0, 1);
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
    uSubBass: { value: 0 },
    uBass: { value: 0 },
    uLowMid: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uActivity: { value: 0 },
    uExcursion: { value: 0 },
    uIntensity: { value: state.intensity },
    uSize: { value: state.size },
    uWarp: { value: state.warp },
    uDensity: { value: state.density },
    uHue: { value: state.hue },
    uSceneStyle: { value: state.scene },
    uMode: { value: 0 },
    uMorph: { value: 0 },
    uEffect: { value: 0 },
    uEffectAmount: { value: 0 },
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
    uniform float uSubBass;
    uniform float uBass;
    uniform float uLowMid;
    uniform float uMid;
    uniform float uHigh;
    uniform float uActivity;
    uniform float uExcursion;
    uniform float uIntensity;
    uniform float uSize;
    uniform float uWarp;
    uniform float uDensity;
    uniform float uHue;
    uniform float uSceneStyle;
    uniform float uMode;
    uniform float uMorph;
    uniform float uEffect;
    uniform float uEffectAmount;
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

    void main() {
      vec3 field = position;
      float distanceFromCenter = length(field.xz);
      float bandEnergy = readBand(aBand);
      float radialFade = 1.0 - smoothstep(18.2, 23.0, distanceFromCenter);
      float densityGate = 1.0 - smoothstep(0.2 + uDensity * 0.74, 1.0, aSeed);
      float idle = uActivity * (
        0.018
        + sin(distanceFromCenter * 0.54 - uTime * 0.72 + aSeed * 4.0) * 0.04
        + sin(field.x * 0.21 + field.z * 0.17 + uTime * 0.31) * 0.022
      );
      float audioLift = pow(max(0.0, bandEnergy), 1.18)
        * (0.16 + uIntensity * 0.72)
        * (1.0 + uExcursion * 0.12);
      float centerForce = exp(-distanceFromCenter * 0.17)
        * (uBass * 2.2 + uLowMid * 0.55 + uExcursion * 0.62);
      float sceneBand = floor(uSceneStyle + 0.5);
      if (sceneBand > 0.5 && sceneBand < 1.5) {
        field.x += sin(field.z * 0.42 + uTime * 0.78) * (0.18 + uMid * 0.72);
        field.z += sin(field.x * 0.18 - uTime * 0.34) * (0.08 + uBass * 0.34);
      } else if (sceneBand > 1.5 && sceneBand < 2.5) {
        float lens = exp(-distanceFromCenter * 0.09) * (0.8 + uBass * 2.4);
        field.y += lens * 0.92;
        field.xz *= 1.0 + lens * 0.018;
      } else if (sceneBand > 2.5 && sceneBand < 3.5) {
        float orbitalRing = exp(-pow(distanceFromCenter - 8.5, 2.0) * 0.026);
        field.y += orbitalRing * (0.42 + uBass * 1.75 + uMid * 0.82);
        field.xz *= 1.0 + orbitalRing * (0.012 + uLowMid * 0.018);
        centerForce *= 0.82;
      } else if (sceneBand > 3.5 && sceneBand < 4.5) {
        float curtain = sin(field.x * 0.34 + uTime * 0.62) * sin(field.z * 0.09 - uTime * 0.18);
        field.y += curtain * (0.28 + uMid * 1.5);
        field.x += curtain * 0.22;
      } else if (sceneBand > 4.5 && sceneBand < 5.5) {
        float slab = smoothstep(0.72, 0.98, abs(sin(field.x * 0.18))) * smoothstep(16.5, 2.5, abs(field.z));
        field.y += slab * (1.0 + uBass * 2.6);
        field.x *= 0.96;
      } else if (sceneBand > 5.5 && sceneBand < 6.5) {
        float solar = exp(-pow(distanceFromCenter - 9.2, 2.0) * 0.018);
        field.y += solar * (0.65 + uBass * 1.8 + uHigh * 0.9);
        field.xz *= 1.0 + solar * 0.012;
      } else if (sceneBand > 6.5) {
        float depth = smoothstep(-20.0, 20.0, field.z);
        field.z += sin(uTime * 0.58 + aSeed * 6.28) * (0.8 + depth * 2.2);
        field.y *= 0.72 + depth * 0.42;
      }
      float rippleLift = 0.0;
      float rippleFlash = 0.0;
      float impactLift = 0.0;
      float impactFlash = 0.0;
      float impactQuake = 0.0;

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
        float ringTrain = exp(-abs(distanceFromCenter - radius) * 0.34)
          * max(0.0, sin((distanceFromCenter - radius) * 3.8 + 0.28));
        rippleLift += (shell * 9.4 + wake * 0.52 + ringTrain * 1.28) * fade;
        rippleFlash += (shell * 1.9 + ringTrain * 0.4) * fade;
      }

      for (int i = 0; i < 8; i++) {
        vec4 impact = uImpacts[i];
        float p = impact.z;
        float d = length(field.xz - impact.xy);
        float radius = p * 12.5;
        float shell = exp(-pow((d - radius) / (0.42 + p * 0.74), 2.0));
        float core = exp(-d * 0.7) * max(0.0, 1.0 - p * 2.8);
        float fade = pow(max(0.0, 1.0 - p), 0.72) * impact.w;
        float aftershock = sin(d * 2.5 - p * 34.0)
          * exp(-d * 0.13)
          * exp(-p * 2.2)
          * impact.w;
        impactLift += (shell * 4.8 - core * 1.8) * fade;
        impactFlash += (shell * 1.72 + core) * fade;
        impactQuake += aftershock * (0.05 + uSubBass * 0.3);
      }

      float totalLift = idle + audioLift + centerForce + rippleLift + impactLift + impactQuake;
      totalLift = sign(totalLift) * log(1.0 + abs(totalLift) * 0.82) * 1.55;
      field.y += totalLift;
      field.xz += vec2(
        sin(field.z * 0.3 + uTime + aSeed * 4.0),
        cos(field.x * 0.27 - uTime + aSeed * 3.0)
      ) * uWarp * uMid * 0.1;

      vec3 form = aTarget;
      float effect = uEffectAmount;
      if (uEffect > 0.5 && uEffect < 1.5) {
        vec3 direction = normalize(form + vec3(aSeed - 0.5, aSeed * 0.4, 0.25));
        form += direction * effect * (4.0 + aSeed * 7.0);
      } else if (uEffect > 1.5 && uEffect < 2.5) {
        float radius = length(form.xz);
        float ring = sin(radius * 0.82 - uTime * 1.4);
        vec2 radial = radius > 0.001 ? form.xz / radius : vec2(0.0, 1.0);
        form.xz += radial * ring * effect * 0.72;
        form.y += ring * effect * 0.62;
      } else if (uEffect > 2.5 && uEffect < 3.5) {
        form *= 1.0 + sin(uTime * 2.2 + aSeed * 2.0) * 0.12 * effect;
      } else if (uEffect > 3.5) {
        form.z += sin(form.x * 0.72 + uTime * 1.7 + aSeed * 2.0) * 1.7 * effect;
        form.y += cos(form.x * 0.31 + uTime) * 0.35 * effect;
      }

      vec3 transformed = mix(field, form, uMorph);
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      float energy = clamp(
        bandEnergy * 0.62
          + rippleFlash * 0.78
          + impactFlash * 0.96
          + uBass * 0.16
          + uExcursion * 0.03,
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
      float sceneBand = floor(uSceneStyle + 0.5);
      if (sceneBand > 1.5 && sceneBand < 2.5) violet = vec3(0.06, 0.24, 0.52);
      if (sceneBand > 2.5 && sceneBand < 3.5) magenta = vec3(0.56, 0.22, 1.0);
      if (sceneBand > 3.5 && sceneBand < 4.5) violet = vec3(0.03, 0.36, 0.31);
      if (sceneBand > 4.5 && sceneBand < 5.5) {
        violet = vec3(0.19, 0.16, 0.2);
        magenta = vec3(0.92, 0.78, 0.62);
      }
      if (sceneBand > 5.5 && sceneBand < 6.5) magenta = vec3(1.0, 0.46, 0.16);
      if (sceneBand > 6.5) {
        violet = vec3(0.03, 0.08, 0.28);
        magenta = vec3(0.28, 0.16, 1.0);
      }
      float drift = fract(hueShift + vSeed * 0.1);
      vec3 base = mix(violet, magenta, 0.35 + drift * 0.45);
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
      gl_FragColor = vec4(color * (0.48 + uIntensity * 0.42 + vEnergy * 0.26), alpha);
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
    uHigh: { value: 0 },
    uWaveTension: { value: 0 },
    uHighSensitivity: { value: state.highSensitivity },
    uActivity: { value: 0 },
    uIntensity: { value: state.intensity },
    uHue: { value: state.hue },
    uSceneStyle: { value: state.scene },
    uTunnelDirection: { value: 1 },
    uTunnelSpeed: { value: 0.055 },
    uPointScale: { value: 1 },
    uMeteors: { value: meteorUniforms },
  };

  const atmosphereVertexShader = `
    precision highp float;
    attribute float aSeed;
    attribute float aKind;
    attribute float aLane;
    uniform float uTime;
    uniform float uHigh;
    uniform float uWaveTension;
    uniform float uHighSensitivity;
    uniform float uActivity;
    uniform float uIntensity;
    uniform float uTunnelDirection;
    uniform float uTunnelSpeed;
    uniform float uPointScale;
    uniform vec4 uMeteors[3];
    varying float vAlpha;
    varying float vHeat;

    vec4 meteorForLane(float lane) {
      if (lane < 0.5) return uMeteors[0];
      if (lane < 1.5) return uMeteors[1];
      return uMeteors[2];
    }

    void main() {
      vec3 transformed = position;
      vAlpha = 0.0;
      vHeat = 0.0;

      if (aKind > 0.5) {
        vec4 meteor = meteorForLane(aLane);
        float head = meteor.z;
        float trail = aSeed * 0.16;
        float p = head - trail;
        if (meteor.w > 0.0 && p > 0.0 && p < 1.0) {
          vec3 start = vec3(meteor.x - 5.2, 20.5 + aLane * 1.4, meteor.y - 8.4);
          vec3 end = vec3(meteor.x, 0.35, meteor.y);
          transformed = mix(start, end, p);
          transformed.x += (aSeed - 0.5) * 0.06;
          transformed.z += sin(aSeed * 18.0) * 0.05;
          vAlpha = pow(1.0 - aSeed, 0.98) * meteor.w * 0.88;
          vHeat = 0.9;
        } else {
          transformed = vec3(0.0, -200.0, 0.0);
        }
      } else {
        float lane = floor(aSeed * 12.0) / 12.0;
        float travel = fract(
          position.z * 0.018
          + aSeed * 0.41
          + uTime * uTunnelSpeed * uTunnelDirection
            * (0.42 + uHighSensitivity * 1.35 + uHigh * 1.8)
        );
        float depth = mix(-27.0, 19.0, travel);
        float wave = sin(
          depth * 0.42
          - uTime * (0.72 + uHigh * 1.8)
          + lane * 6.28318
        );
        float bend = smoothstep(0.04, 0.82, uWaveTension);
        float waveAmount = bend * (0.02 + uHighSensitivity * 0.2 + uHigh * 1.24);
        float bow = wave + sin(
          depth * 0.16
          - uTime * (0.24 + uHigh * 0.5)
          + lane * 3.14159
        ) * bend * 0.34;
        transformed.z = depth;
        transformed.x = position.x * 0.9
          + bow * waveAmount;
        transformed.y = 7.0 + abs(position.y) * 0.62
          + sin(depth * 0.21 + lane * 12.566) * bend * (0.035 + uHigh * 0.62);
        vAlpha = (0.025 + uActivity * (0.035 + uHighSensitivity * 0.09 + uHigh * 0.24))
          * (0.35 + aSeed * 0.65);
      }

      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      gl_PointSize = clamp(
        (aKind > 0.5 ? 8.5 : 5.0) * uPointScale / max(3.0, -mvPosition.z) * 12.0,
        1.0,
        14.0
      );
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const atmosphereFragmentShader = `
    precision highp float;
    uniform float uIntensity;
    uniform float uHue;
    uniform float uSceneStyle;
    varying float vAlpha;
    varying float vHeat;

    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = length(p);
      float glow = 1.0 - smoothstep(0.04, 0.5, d);
      if (glow * vAlpha < 0.01) discard;
      vec3 pink = mix(vec3(0.55, 0.08, 0.72), vec3(1.0, 0.17, 0.67), uHue);
      float sceneBand = floor(uSceneStyle + 0.5);
      if (sceneBand > 3.5 && sceneBand < 4.5) pink = mix(vec3(0.05, 0.55, 0.46), vec3(0.52, 1.0, 0.82), uHue);
      if (sceneBand > 4.5 && sceneBand < 5.5) pink = mix(vec3(0.46, 0.36, 0.28), vec3(1.0, 0.78, 0.46), uHue);
      if (sceneBand > 5.5 && sceneBand < 6.5) pink = mix(vec3(0.8, 0.18, 0.04), vec3(1.0, 0.66, 0.16), uHue);
      if (sceneBand > 6.5) pink = mix(vec3(0.08, 0.14, 0.7), vec3(0.42, 0.18, 1.0), uHue);
      vec3 color = mix(pink, vec3(1.0, 0.96, 1.0), vHeat);
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
        float grain = (hash(vUv * uResolution + uTime) - 0.5) * 0.012;
        vec3 color = center + max(bloom - 0.1, 0.0) * 0.18 * uGlow;
        color *= 0.72 + vignette * 0.28;
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
    rawSubBass: 0,
    rawLowMid: 0,
    rawHigh: 0,
    mappedSubBass: 0,
    mappedLowMid: 0,
    mappedHigh: 0,
    subFlux: 0,
    lowFlux: 0,
    highFlux: 0,
    excursionTarget: 0,
    excursion: 0,
    rippleThreshold: 0,
    impactThreshold: 0,
    meteorThreshold: 0,
    audible: false,
  };
  const fastEnvelope = { subBass: 0, lowMid: 0, high: 0 };
  const slowEnvelope = { subBass: 0, lowMid: 0, high: 0 };
  const transientArmed = { subBass: true, lowMid: true, high: true };
  let motionExcursion = 0;

  let audioContext;
  let analyser;
  let frequencyData;
  let audioSource;
  let microphoneStream;
  let audioElement;
  let audioObjectUrl;
  let sampleDemoActive = false;
  let sampleDemoStartedAt = 0;
  let testBandValues = null;
  let pointerX = 0.5;
  let pointerY = 0.48;
  let time = 0;
  let visualTime = 0;
  let audioActivity = 0;
  let waveTension = 0;
  let inputNoiseFloor = 0.018;
  let inputPeak = 0;
  let inputGate = AUDIO_TUNING.noiseGateMinimum;
  let lastFrameAt = performance.now();
  let lastAudioAt = 0;
  let lastRippleAt = -10;
  let lastImpactAt = -10;
  let lastMeteorAt = -10;
  let lastSubBassAt = performance.now() / 1000;
  let lastAudioUpdateAt = 0;
  let rotation = 0;
  let rotationTarget = 0;
  let lastSampleTempoBeat = -10;
  const beatOnsets = [];
  const lowMidHistory = [];
  const subBassHistory = [];
  const highHistory = [];
  const frameTimes = [];
  let statsUpdatedAt = 0;
  let calibrationStartedAt = performance.now();
  let lowFpsDuration = 0;

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

  function setOnboardingOpen(open) {
    if (!dom.onboarding) return;
    dom.onboarding.hidden = !open;
    dom.onboarding.classList.toggle("open", open);
    if (open) {
      openPanel(false);
      dom.onboarding.classList.remove("mic-error");
      dom.onboardingStart?.focus({ preventScroll: true });
    }
  }

  function showOnboarding(force = false) {
    if (!dom.onboarding) return;
    if (!force && localStorage.getItem(ONBOARDING_KEY) === "1") return;
    setOnboardingOpen(true);
  }

  function finishOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setOnboardingOpen(false);
  }

  function setDefaultOnboardingHint() {
    if (!dom.onboardingHint) return;
    dom.onboardingHint.textContent =
      state.language === "zh"
        ? "如果麦克风被浏览器拦截，请用 HTTPS 页面或 localhost 打开。"
        : "If the browser blocks the mic, open this page through HTTPS or localhost.";
  }

  function updateBlackholeRoute(open) {
    if (!dom.onboarding) return;
    dom.onboarding.classList.toggle("route-open", open);
    dom.blackholeGuide?.setAttribute("aria-hidden", String(!open));
    if (dom.onboardingBlackhole) {
      dom.onboardingBlackhole.textContent =
        state.language === "zh"
          ? open
            ? "收起内录"
            : "BLACKHOLE 内录"
          : open
            ? "HIDE ROUTE"
            : "BLACKHOLE ROUTE";
    }
  }

  async function startOnboardingMic() {
    setStatus(dom.audioStatus, "MIC REQUEST", true);
    try {
      await startMicrophone();
      finishOnboarding();
    } catch (error) {
      const label = describeAudioError(error);
      handleAudioError(error);
      dom.onboarding?.classList.add("mic-error");
      if (dom.onboardingHint) {
        dom.onboardingHint.textContent =
          state.language === "zh"
            ? `${label}。请允许麦克风，或改用 HTTPS / localhost / BlackHole 输入。`
            : `${label}. Allow microphone access, or use HTTPS / localhost / BlackHole input.`;
      }
    }
  }

  function setParam(name, value, shouldSend = true) {
    state[name] = clamp(Number(value));
    const slider = sliders.find((item) => item.dataset.param === name);
    if (slider) slider.value = state[name];
    if (shouldSend) sendParam(name, state[name]);
  }

  function setScene(index, shouldSend = true) {
    state.scene = Number(index) || 0;
    sceneButtons.forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.scene) === state.scene),
    );
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
    const audioLabel = sampleDemoActive ? "SAMPLE" : analyser ? "LIVE AUDIO" : "IDLE";
    dom.modeLabel.textContent =
      state.mode === "form"
        ? `PARTICLE FORM / ${state.particleLabel || "ARE"}`
        : `${scenePreset().name || "RANGE FIELD"} / ${audioLabel}`;
  }

  function applyLanguage(language) {
    state.language = language === "zh" ? "zh" : "en";
    localStorage.setItem("rangeEchoLanguage", state.language);
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    const zh = state.language === "zh";
    const setText = (selector, en, cn) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = zh ? cn : en;
    };
    if (dom.languageToggle) {
      dom.languageToggle.textContent = zh ? "EN" : "中文";
      dom.languageToggle.title = zh ? "Switch to English" : "切换到中文";
    }
    setText(".menu-design-link", "DESIGN NOTE", "设计说明");
    setText("#guideToggle", "GUIDE", "教程");
    dom.panelToggle.querySelector("span").textContent = "CONTROL";
    setText("#audioToggle", "MIC", "麦克风");
    setText("label[for='audioInput']", "AUDIO", "音频");
    setText("#sampleToggle", "SAMPLE", "样本");
    setText("#auditionToggle", "LISTEN", "试听");
    setText("#echoToggle", "ECHO", "回响");
    setText("#blackoutToggle", "BLACK", "黑场");
    setText("#freezeToggle", "FREEZE", "冻结");
    setText("#randomize", "RND", "随机");
    setText("#textParticle", "TEXT", "文字");
    setText("label[for='imageInput']", "IMAGE / SVG", "图片 / SVG");
    setText("#clearParticle", "CLEAR", "清除");
    setText("#onboardingKicker", "FIRST PLAY", "首次进入");
    const onboardingTitle = document.querySelector("#onboardingTitle");
    if (onboardingTitle) onboardingTitle.innerHTML = zh ? "听见<br />房间" : "HEAR<br />THE ROOM";
    setText(
      "#onboardingCopy",
      "Open the microphone, then clap, speak, or play sound near the laptop.",
      "打开麦克风，然后拍手、说话，或让电脑旁边响起来。",
    );
    setText("#onboardingStepMic", "MIC", "麦克风");
    setText("#onboardingStepMicText", "Allow browser access", "允许浏览器访问");
    setText("#onboardingStepRoom", "ROOM", "现场");
    setText("#onboardingStepRoomText", "Make a sound", "发出声音");
    setText("#onboardingStepLoop", "LOOP", "内录");
    setText("#onboardingStepLoopText", "Use BlackHole for computer audio", "用 BlackHole 听电脑声音");
    setText("#onboardingStart", "START LIVE MIC", "打开实时麦克风");
    setText("#onboardingSample", "SAMPLE", "样本");
    setText("#onboardingSkip", "SKIP", "跳过");
    setText("#blackholeDownload", "GET BLACKHOLE ↗", "下载 BLACKHOLE ↗");
    setText("#blackholeRouteInstall", "Install 2ch", "安装 2ch");
    setText("#blackholeRouteOutput", "Mac output → BlackHole", "Mac 输出 → BlackHole");
    setText("#blackholeRouteMic", "Range Echo MIC → BlackHole 2ch", "Range Echo MIC → BlackHole 2ch");
    updateBlackholeRoute(dom.onboarding?.classList.contains("route-open"));
    if (!dom.onboarding?.classList.contains("mic-error")) setDefaultOnboardingHint();
    setText(".rack-head .eyebrow", "LIVE PARAMETERS", "现场参数");
    setText(".rack h2", "CONTROL", "CONTROL");
    setText(".control-section:nth-of-type(1) .section-label", "INPUT", "输入");
    setText(".help-section .section-label", "I/O NOTES", "输入输出说明");
    setText(".control-section:nth-of-type(3) .section-label", "SCENE MEMORY", "场景记忆");
    setText(".control-section:nth-of-type(4) .section-label", "PARTICLE FORM", "粒子形态");
    setText(".quality-section .section-label", "PERFORMANCE MODE", "性能档位");
    setText(".sliders .section-label", "FIELD", "场域参数");
    setText("label:has([data-param='lowSensitivity']) > span", "Sub / Quake", "重低音 / 震动");
    setText("label:has([data-param='midSensitivity']) > span", "Low-mid / Wave", "中低音 / 大涟漪");
    setText("label:has([data-param='highSensitivity']) > span", "High / Meteor", "高频 / 流星");
    setText("[data-param='lowSensitivity'] + small", "20–95 Hz: hidden impact density, local aftershock and white-hot quake edges.", "20–95 Hz：隐形落点、局部余震与白热震缘。");
    setText("[data-param='midSensitivity'] + small", "95–620 Hz: large centre-born ripples, radius and layered wave response.", "95–620 Hz：中央大涟漪、传播半径与分层回波。");
    setText("[data-param='highSensitivity'] + small", "1.2–9.5 kHz: meteor rate and speed, white heat and tunnel-line motion.", "1.2–9.5 kHz：流星频率与速度、白热和隧道线场。");
    dom.auditionHelp.textContent = zh
      ? "SoundCloud 是试听源，不是 iframe FFT。如需真实分析，请用 BlackHole 或其他系统音频路由作为 MIC 输入。"
      : "SoundCloud is a listening source, not iframe FFT. For real analysis, route it through BlackHole or another system-audio input and then use MIC.";
    document.querySelector("#sceneHelp").textContent = zh
      ? "A-H 恢复原先 scene memory。参数变化请用 RND 或滑杆。"
      : "A-H recall the original scene memories. Use RND or the sliders for parameter changes.";
    updateModeLabel();
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
    stopSampleDemo();
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
    localStorage.setItem(ONBOARDING_KEY, "1");
  }

  async function startAudioFile(file) {
    if (!file) return;
    stopSampleDemo();
    disconnectAudioSource();
    audioObjectUrl = URL.createObjectURL(file);
    audioElement = new Audio(audioObjectUrl);
    audioElement.loop = true;
    audioElement.crossOrigin = "anonymous";
    const context = ensureAnalyser().context;
    await connectAudioNode(context.createMediaElementSource(audioElement), true);
    await audioElement.play();
    setStatus(dom.audioStatus, "FILE LIVE", true);
    dom.audioToggle.classList.remove("active");
  }

  function sampleBands(nowSeconds) {
    const t = Math.max(0, nowSeconds - sampleDemoStartedAt);
    const beat = (t * 2) % 1;
    const bar = Math.floor(t * 2) % 8;
    const kick = Math.exp(-beat * 13) * (bar === 0 || bar === 4 ? 1 : 0.62);
    const offKick = Math.exp(-(((beat + 0.5) % 1)) * 9) * 0.22;
    const snare = Math.exp(-Math.pow(beat - 0.5, 2) * 42) * 0.34;
    const shimmer = Math.max(0, Math.sin(t * 17) * Math.sin(t * 2.75)) * 0.34;
    const phrase = 0.5 + Math.sin(t * 0.23) * 0.5;
    return [
      0.18 + kick * 0.78 + offKick,
      0.2 + kick * 0.62 + offKick * 0.8,
      0.16 + kick * 0.36 + snare * 0.22,
      0.18 + snare * 0.44 + phrase * 0.08,
      0.14 + Math.sin(t * 1.4) * 0.05 + snare * 0.22,
      0.1 + shimmer * 0.28,
      0.08 + shimmer * 0.44,
      0.06 + shimmer * 0.52 + Math.max(0, Math.sin(t * 6.1)) * 0.08,
    ].map((value) => clamp(value));
  }

  function startSampleDemo() {
    disconnectAudioSource();
    sampleDemoActive = true;
    sampleDemoStartedAt = performance.now() / 1000;
    dom.sampleToggle.classList.add("active");
    dom.sampleToggle.classList.remove("primary");
    dom.audioToggle.classList.remove("active");
    dom.samplePlayer.classList.add("active");
    dom.samplePlayer.setAttribute("aria-hidden", "false");
    setStatus(dom.audioStatus, "SAMPLE LIVE", true);
    updateModeLabel();
  }

  function stopSampleDemo() {
    if (!sampleDemoActive && !dom.samplePlayer?.classList.contains("active")) return;
    sampleDemoActive = false;
    dom.sampleToggle?.classList.remove("active");
    dom.samplePlayer?.classList.remove("active");
    dom.samplePlayer?.setAttribute("aria-hidden", "true");
    updateModeLabel();
  }

  function toggleAuditionPlayer() {
    const nextOpen = !dom.auditionPlayer.classList.contains("active");
    dom.auditionPlayer.classList.toggle("active", nextOpen);
    dom.auditionPlayer.setAttribute("aria-hidden", String(!nextOpen));
    dom.auditionToggle.classList.toggle("active", nextOpen);
  }

  function handleAudioError(error) {
    const label = describeAudioError(error);
    setStatus(dom.audioStatus, label, false);
  }

  function normalizeTempo(bpm) {
    let value = bpm;
    while (value < 72) value *= 2;
    while (value > 168) value /= 2;
    return value;
  }

  function registerTempoOnset(nowSeconds, strength = 1) {
    if (beatOnsets.length && nowSeconds - beatOnsets[beatOnsets.length - 1].time < 0.24) return;
    beatOnsets.push({ time: nowSeconds, strength: clamp(strength, 0.12, 1) });
    while (beatOnsets.length > 36 || nowSeconds - beatOnsets[0].time > 18) beatOnsets.shift();
    if (beatOnsets.length < 5) return;

    const bins = new Float32Array(193);
    for (let end = 1; end < beatOnsets.length; end += 1) {
      for (let gap = 1; gap <= 4 && end - gap >= 0; gap += 1) {
        const interval = beatOnsets[end].time - beatOnsets[end - gap].time;
        if (interval < 0.25 || interval > 3.4) continue;
        const candidate = normalizeTempo((60 * gap) / interval);
        const center = Math.round((candidate - 72) * 2);
        const recency = 0.55 + (end / beatOnsets.length) * 0.45;
        const weight =
          Math.sqrt(beatOnsets[end].strength * beatOnsets[end - gap].strength) *
          recency /
          Math.sqrt(gap);
        for (let offset = -3; offset <= 3; offset += 1) {
          const bin = center + offset;
          if (bin >= 0 && bin < bins.length) bins[bin] += weight * Math.exp((-offset * offset) / 3.2);
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
    if (state.bpmConfidence <= 0.2) return;
    if (!state.bpm) state.bpm = estimate;
    else {
      const delta = estimate - state.bpm;
      const safeDelta = Math.abs(delta) > 24 && state.bpmConfidence < 0.58 ? 0 : delta;
      state.bpm += safeDelta * (0.08 + state.bpmConfidence * 0.16);
    }
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

  function sensitivityForBand(index) {
    if (index <= 2) return 0.78 + state.lowSensitivity * 0.9;
    if (index <= 5) return 0.78 + state.midSensitivity * 0.9;
    return 0.78 + state.highSensitivity * 0.9;
  }

  function applyBandResponse(value, index) {
    const raw = clamp(Number(value) || 0);
    const gain = sensitivityForBand(index);
    return Math.tanh(raw * gain) / Math.tanh(gain);
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
    if (history.length > 180) history.shift();
  }

  function followEnvelope(current, target, delta, attack, release) {
    const timeConstant = target > current ? attack : release;
    return current + (target - current) * (1 - Math.exp(-delta / timeConstant));
  }

  function applyInputNoiseGate(values, delta) {
    inputPeak = values.reduce((peak, value) => Math.max(peak, value), 0);
    if (inputPeak < 0.12) {
      inputNoiseFloor = Math.min(
        AUDIO_TUNING.noiseFloorCeiling,
        followEnvelope(inputNoiseFloor, inputPeak, delta, 0.9, 0.45),
      );
    } else {
      inputNoiseFloor = Math.max(0.018, inputNoiseFloor - delta * 0.012);
    }
    inputGate = Math.max(
      AUDIO_TUNING.noiseGateMinimum,
      inputNoiseFloor * AUDIO_TUNING.noiseGateMultiplier,
    );
    if (inputPeak <= inputGate) {
      values.fill(0);
      return false;
    }
    values.forEach((value, index) => {
      values[index] = clamp((value - inputGate) / Math.max(0.001, 1 - inputGate) * 1.12);
    });
    return true;
  }

  function updateMacroEnvelopes(values, delta) {
    Object.entries(values).forEach(([key, value]) => {
      fastEnvelope[key] = followEnvelope(fastEnvelope[key], value, delta, 0.035, 0.14);
      slowEnvelope[key] = followEnvelope(slowEnvelope[key], value, delta, 0.38, 0.55);
    });
  }

  function spawnRipple(strength = 0.6, source = "audio", delay = 0) {
    const feedback = effectiveFeedback();
    const pulse = {
      age: -Math.max(0, delay),
      life: 1.75 + feedback * 1.05,
      strength: clamp(strength, 0.12, 1),
    };
    if (ripples.length < RIPPLE_SLOTS) ripples.push(pulse);
    else ripples[rippleCursor++ % RIPPLE_SLOTS] = pulse;
    eventCounters.ripples += 1;
    if (source === "density-floor") eventCounters.densityFloorRipples += 1;
  }

  function spawnImpact(strength = 0.75, x, z, source = "audio", delay = 0) {
    const feedback = effectiveFeedback();
    const radius = FIELD_HALF * 0.82 * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    const impact = {
      x: Number.isFinite(x) ? x : Math.cos(angle) * radius,
      z: Number.isFinite(z) ? z : Math.sin(angle) * radius,
      age: -Math.max(0, delay),
      life: 1.28 + feedback * 0.55,
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
    slot.life =
      (0.38 + (1 - strength) * 0.18) *
      (1.08 - state.highSensitivity * 0.38);
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
    const sampleValues = !testBandValues && sampleDemoActive ? sampleBands(nowSeconds) : null;
    const analyserLive = Boolean(!testBandValues && !sampleValues && analyser && frequencyData);
    const live = Boolean(testBandValues || sampleValues || analyserLive);
    const audioDelta = clamp(
      lastAudioUpdateAt ? nowSeconds - lastAudioUpdateAt : 1 / 60,
      1 / 240,
      0.1,
    );
    lastAudioUpdateAt = nowSeconds;

    if (testBandValues) {
      testBandValues.forEach((value, index) => {
        rawBandValues[index] = clamp(Number(value) || 0);
      });
    } else if (sampleValues) {
      sampleValues.forEach((value, index) => {
        rawBandValues[index] = clamp(value);
      });
      if (nowSeconds - lastSampleTempoBeat > 0.48) {
        registerTempoOnset(nowSeconds, 0.86);
        lastSampleTempoBeat = nowSeconds;
      }
    } else if (analyserLive) {
      analyser.getByteFrequencyData(frequencyData);
      ranges.forEach(([from, to], index) => {
        rawBandValues[index] = bandEnergy(from, to);
      });
      applyInputNoiseGate(rawBandValues, audioDelta);
    } else {
      rawBandValues.fill(0);
      inputPeak = 0;
      inputGate = AUDIO_TUNING.noiseGateMinimum;
    }

    rawBandValues.forEach((value, index) => {
      const target = applyBandResponse(value, index);
      bandUniforms[index] = followEnvelope(
        bandUniforms[index],
        target,
        audioDelta,
        0.045,
        0.16,
      );
    });

    const subBass = bandUniforms[0] * 0.7 + bandUniforms[1] * 0.3;
    const bass = bandUniforms[1] * 0.35 + bandUniforms[2] * 0.65;
    const lowMid = bandUniforms[3] * 0.66 + bandUniforms[4] * 0.34;
    const mid = bandUniforms[4] * 0.42 + bandUniforms[5] * 0.38 + bandUniforms[6] * 0.2;
    const extendedHighInput = analyserLive ? bandEnergy(3500, 9500) : 0;
    const rawExtendedHigh = analyserLive
      ? extendedHighInput <= inputGate
        ? 0
        : clamp((extendedHighInput - inputGate) / Math.max(0.001, 1 - inputGate) * 1.12)
      : Math.max(rawBandValues[7], rawBandValues[6] * 0.72);
    const liveHigh = live
      ? applyBandResponse(rawExtendedHigh, 7)
      : 0;

    state.subBass = followEnvelope(state.subBass, subBass, audioDelta, 0.055, 0.18);
    state.bass = followEnvelope(state.bass, bass, audioDelta, 0.055, 0.18);
    state.lowMid = followEnvelope(state.lowMid, lowMid, audioDelta, 0.065, 0.2);
    state.mid = followEnvelope(state.mid, mid, audioDelta, 0.075, 0.22);
    state.high = followEnvelope(state.high, liveHigh, audioDelta, 0.045, 0.16);

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

    const rawSubBass = rawBandValues[0] * 0.74 + rawBandValues[1] * 0.26;
    const rawLowMid =
      rawBandValues[2] * 0.18 + rawBandValues[3] * 0.54 + rawBandValues[4] * 0.28;
    const rawHigh = Math.max(
      rawExtendedHigh,
      rawBandValues[6] * 0.28 + rawBandValues[7] * 0.72,
    );
    updateMacroEnvelopes(
      { subBass: rawSubBass, lowMid: rawLowMid, high: rawHigh },
      audioDelta,
    );

    const subFlux = Math.max(0, fastEnvelope.subBass - slowEnvelope.subBass);
    const lowFlux = Math.max(0, fastEnvelope.lowMid - slowEnvelope.lowMid);
    const highFlux = Math.max(0, fastEnvelope.high - slowEnvelope.high);
    const excursionTarget = clamp(
      (lowFlux * 1.1 + subFlux * 0.85 + highFlux * 0.15) *
        (3.6 + state.lowSensitivity * 2.4),
    );
    motionExcursion = followEnvelope(
      motionExcursion,
      excursionTarget,
      audioDelta,
      0.018,
      0.09,
    );
    const lowStats = channelStats(lowMidHistory, rawLowMid || 0.03);
    const subStats = channelStats(subBassHistory, rawSubBass || 0.025);
    const highStats = channelStats(highHistory, rawHigh || 0.018);
    const impactThresholdFactor = 1.22 - state.lowSensitivity * 0.62;
    const rippleThresholdFactor = 1.22 - state.midSensitivity * 0.62;
    const highThresholdFactor = 1.18 - state.highSensitivity * 0.52;
    const rippleThreshold = Math.max(0.03, lowStats.mean + lowStats.deviation * 0.2);
    const impactThreshold = Math.max(0.028, subStats.mean + subStats.deviation * 0.28);
    const meteorThreshold = Math.max(
      0.055 + (1 - state.highSensitivity) * 0.03,
      highStats.mean + highStats.deviation * 0.24,
    );
    const rippleTransient =
      rawLowMid > Math.max(0.06, rippleThreshold) &&
      lowFlux > Math.max(0.004, lowStats.deviation * 0.1) * rippleThresholdFactor;
    const subBassTransient =
      rawSubBass > impactThreshold &&
      subFlux > Math.max(0.0045, subStats.deviation * 0.11) * impactThresholdFactor;
    const fallbackImpact =
      !subBassTransient &&
      rawLowMid > lowStats.mean + lowStats.deviation * 0.38 &&
      lowFlux > Math.max(0.006, lowStats.deviation * 0.14) * rippleThresholdFactor;
    const meteorTransient =
      rawHigh > meteorThreshold &&
      highFlux > Math.max(0.0025, highStats.deviation * 0.09) * highThresholdFactor;
    const rippleOnset = rippleTransient && transientArmed.lowMid;
    const subBassOnset = subBassTransient && transientArmed.subBass;
    const fallbackImpactOnset = fallbackImpact && transientArmed.lowMid;
    const meteorOnset = meteorTransient && transientArmed.high;
    if (subBassOnset) lastSubBassAt = nowSeconds;
    if (rippleOnset || fallbackImpactOnset) transientArmed.lowMid = false;
    else if (rawLowMid < 0.04 || rawLowMid < slowEnvelope.lowMid * 0.78) {
      transientArmed.lowMid = true;
    }
    if (subBassOnset) transientArmed.subBass = false;
    else if (rawSubBass < 0.035 || rawSubBass < slowEnvelope.subBass * 0.78) {
      transientArmed.subBass = true;
    }
    if (meteorOnset) transientArmed.high = false;
    else if (rawHigh < 0.045 || rawHigh < slowEnvelope.high * 0.72) {
      transientArmed.high = true;
    }
    const activitySignal = Math.max(rawSubBass, rawLowMid, rawHigh * 1.35);
    const activityTarget = state.syntheticStress
      ? 1
      : live
        ? clamp((activitySignal - 0.06) / 0.16)
        : 0;
    audioActivity = followEnvelope(
      audioActivity,
      activityTarget,
      audioDelta,
      0.04,
      0.62,
    );
    const waveDrive = state.syntheticStress
      ? 1
      : live
        ? clamp((rawHigh - 0.075) * 1.5 + highFlux * 3.2 + rawLowMid * 0.18)
        : 0;
    waveTension = followEnvelope(waveTension, waveDrive, audioDelta, 0.2, 0.42);
    const audible = activityTarget > 0.08;
    const rippleActive =
      rawLowMid > Math.max(0.07, lowStats.mean * 0.72) ||
      rawSubBass > Math.max(0.075, subStats.mean * 0.78);
    const impactActive =
      rawSubBass > Math.max(0.055, subStats.mean * 0.78) ||
      (
        nowSeconds - lastSubBassAt > 4.5 &&
        rawLowMid * 0.72 > Math.max(0.03, lowStats.mean * 0.72)
      );
    const meteorActive = rawHigh > Math.max(0.06, highStats.mean * 0.7);

    if (live && audible && nowSeconds - lastRippleAt > MOTION_TUNING.rippleCooldown) {
      const densityFloorHit =
        rippleActive &&
        nowSeconds - lastRippleAt >
          MOTION_TUNING.rippleDensityFloor + (1 - state.midSensitivity) * 0.42;
      const bassRippleOnset = subBassOnset && !rippleOnset;
      if (rippleOnset || bassRippleOnset || densityFloorHit) {
        const source = densityFloorHit && !rippleOnset && !bassRippleOnset ? "density-floor" : "audio";
        const waveLevel = rippleOnset ? state.lowMid : state.subBass;
        const waveFlux = rippleOnset ? lowFlux : subFlux;
        const strength =
          clamp(
            0.12
              + waveLevel * (0.58 + state.midSensitivity * 1.12)
              + waveFlux * (1.9 + state.midSensitivity * 4.8),
          ) *
          (source === "density-floor" ? 0.68 : 1);
        spawnRipple(strength, source);
        if (
          (rippleOnset || bassRippleOnset) &&
          waveFlux * (2.2 + state.midSensitivity * 6.2) > 0.32
        ) {
          spawnRipple(strength * 0.72, "echo-layer", 0.13);
          spawnRipple(strength * 0.5, "echo-layer", 0.25);
        }
        if (rippleOnset || bassRippleOnset) {
          registerTempoOnset(
            nowSeconds,
            clamp(0.2 + rawLowMid * 0.72 + rawSubBass * 0.42 + lowFlux * 3.8),
          );
          lastAudioAt = nowSeconds;
        }
        lastRippleAt = nowSeconds;
      }
    }

    if (live && lastAudioAt > 0 && nowSeconds - lastAudioAt > 3.5) {
      state.bpmConfidence *= 0.992;
      if (state.bpmConfidence < 0.08 && nowSeconds - lastAudioAt > 8) state.bpm = 0;
    }

    if (live && audible && nowSeconds - lastImpactAt > MOTION_TUNING.impactCooldown) {
      const densityFloorHit =
        impactActive &&
        nowSeconds - lastImpactAt >
          MOTION_TUNING.impactDensityFloor + (1 - state.lowSensitivity) * 0.72;
      const substituteImpact =
        fallbackImpactOnset && nowSeconds - lastSubBassAt > 4.5;
      if (subBassOnset || substituteImpact || densityFloorHit) {
        const source =
          densityFloorHit && !subBassOnset && !substituteImpact ? "density-floor" : "audio";
        const mappedSource = subBassOnset ? state.subBass : state.lowMid * 0.82;
        const sourceFlux = subBassOnset ? subFlux : lowFlux;
        const strength =
          clamp(
            0.12
              + mappedSource * (0.48 + state.lowSensitivity * 1.08)
              + sourceFlux * (1.5 + state.lowSensitivity * 3.8),
          ) *
          (source === "density-floor" ? 0.7 : 1);
        spawnImpact(strength, undefined, undefined, source);
        if (
          source === "audio" &&
          (subBassOnset
            ? subFlux * (2.4 + state.lowSensitivity * 6.4) > 0.44
            : lowFlux * (1.8 + state.lowSensitivity * 3.2) > 0.52)
        ) {
          spawnImpact(strength * 0.72, undefined, undefined, "echo-layer", 0.11);
          spawnImpact(strength * 0.5, undefined, undefined, "echo-layer", 0.23);
        }
        lastImpactAt = nowSeconds;
      }
    }

    if (live && audible && nowSeconds - lastMeteorAt > MOTION_TUNING.meteorCooldown) {
      const densityFloorHit =
        meteorActive && nowSeconds - lastMeteorAt > MOTION_TUNING.meteorDensityFloor;
      if (meteorOnset || densityFloorHit) {
        const source = densityFloorHit && !meteorOnset ? "density-floor" : "audio";
        const strength =
          clamp(0.24 + state.high * 1.2 + highFlux * 3.4) *
          (source === "density-floor" ? 0.72 : 1);
        spawnMeteor(strength, source);
        lastMeteorAt = nowSeconds;
      }
    }

    recordChannel(lowMidHistory, rawLowMid);
    recordChannel(subBassHistory, rawSubBass);
    recordChannel(highHistory, rawHigh);
    Object.assign(motionDebug, {
      rawSubBass,
      rawLowMid,
      rawHigh,
      mappedSubBass: state.subBass,
      mappedLowMid: state.lowMid,
      mappedHigh: state.high,
      subFlux,
      lowFlux,
      highFlux,
      excursionTarget,
      excursion: motionExcursion,
      rippleThreshold,
      impactThreshold,
      meteorThreshold,
      audible,
      activitySignal,
      activityTarget,
      audioActivity,
      waveDrive,
      waveTension,
      inputPeak,
      inputNoiseFloor,
      inputGate,
    });

    coreUniforms.uSubBass.value = state.subBass;
    coreUniforms.uBass.value = state.bass;
    coreUniforms.uLowMid.value = state.lowMid;
    coreUniforms.uMid.value = state.mid;
    coreUniforms.uHigh.value = state.high;
    coreUniforms.uActivity.value = audioActivity;
    coreUniforms.uExcursion.value = motionExcursion;
    atmosphereUniforms.uHigh.value = state.high;
    atmosphereUniforms.uWaveTension.value = waveTension;
    atmosphereUniforms.uActivity.value = audioActivity;
    dom.bassReadout.textContent = state.subBass.toFixed(2);
    dom.midReadout.textContent = state.lowMid.toFixed(2);
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
        pulse && pulse.age >= 0 ? pulse.strength * (state.echo ? 1 : 0) : 0,
      );
    }
    for (let index = 0; index < IMPACT_SLOTS; index += 1) {
      const impact = impacts[index];
      impactUniforms[index].set(
        impact?.x || 0,
        impact?.z || 0,
        impact ? clamp(impact.age / impact.life) : 2,
        impact && impact.age >= 0 ? impact.strength : 0,
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
      visualTime +=
        delta *
        (0.72 + state.speed * 0.9) *
        (audioActivity < 0.006 ? 0 : audioActivity);
      const bpm = state.bpm || 72;
      rotationTarget =
        (bpm / 60) *
        (0.012 + state.speed * 0.034) *
        (audioActivity < 0.006 ? 0 : audioActivity);
      rotation += delta * rotationTarget;
      state.morph += (state.morphTarget - state.morph) * Math.min(1, delta * 2.8);
    }

    const preset = scenePreset();
    const sceneHue = fract(state.hue + preset.hueOffset);
    const sceneWarp = clamp(state.warp * preset.warpScale, 0, 1);
    coreUniforms.uTime.value = visualTime;
    coreUniforms.uIntensity.value = state.intensity;
    coreUniforms.uSize.value = state.size;
    coreUniforms.uWarp.value = sceneWarp;
    coreUniforms.uDensity.value = state.density;
    coreUniforms.uHue.value = sceneHue;
    coreUniforms.uSceneStyle.value = state.scene;
    coreUniforms.uMode.value = state.mode === "form" ? 1 : 0;
    coreUniforms.uMorph.value = state.morph;
    coreUniforms.uEffect.value = state.effect;
    coreUniforms.uEffectAmount.value +=
      ((state.mode === "form" && state.effect > 0 ? 1 : 0) -
        coreUniforms.uEffectAmount.value) *
      Math.min(1, delta * 2.2);
    atmosphereUniforms.uTime.value = visualTime;
    atmosphereUniforms.uHighSensitivity.value = state.highSensitivity;
    atmosphereUniforms.uIntensity.value = state.intensity;
    atmosphereUniforms.uHue.value = sceneHue;
    atmosphereUniforms.uSceneStyle.value = state.scene;
    atmosphereUniforms.uTunnelDirection.value = preset.tunnelDirection;
    atmosphereUniforms.uTunnelSpeed.value = preset.tunnelSpeed;
    postUniforms.uTime.value = visualTime;

    coreField.visible = !state.blackout;
    atmosphere.visible = !state.blackout;
    const desiredCoreRotation =
      state.mode === "form" ? Math.sin(visualTime * 0.22) * 0.08 : rotation;
    coreField.rotation.y +=
      (desiredCoreRotation - coreField.rotation.y) * Math.min(1, delta * 3.6);
    atmosphere.rotation.y = rotation * 0.58;

    const cameraPhase = visualTime * preset.orbitRate + state.scene * 0.73;
    const pointerOrbit = (pointerX - 0.5) * 5.5;
    const targetX =
      preset.camera[0] + Math.sin(cameraPhase) * preset.orbitRadius + pointerOrbit;
    const targetY =
      preset.camera[1] +
      (0.5 - pointerY) * 2.2 +
      Math.sin(cameraPhase * 0.73) * preset.cameraBob;
    const targetZ =
      preset.camera[2] + Math.cos(cameraPhase) * preset.orbitDepth;
    const cameraFollow = 1 - Math.exp(-delta * preset.cameraFollow);
    const targetFov = preset.fov || 49;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, delta * 3.4);
      camera.updateProjectionMatrix();
    }
    camera.position.x += (targetX - camera.position.x) * cameraFollow;
    camera.position.y += (targetY - camera.position.y) * cameraFollow;
    camera.position.z += (targetZ - camera.position.z) * cameraFollow;
    camera.lookAt(
      preset.lookAt[0],
      preset.lookAt[1] + state.bass * 1.4,
      preset.lookAt[2],
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
    setParam("lowSensitivity", 0.64 + Math.random() * 0.34);
    setParam("midSensitivity", 0.58 + Math.random() * 0.34);
    setParam("highSensitivity", 0.52 + Math.random() * 0.38);
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
  dom.guideToggle?.addEventListener("click", () => showOnboarding(true));
  dom.onboardingStart?.addEventListener("click", startOnboardingMic);
  dom.onboardingBlackhole?.addEventListener("click", () =>
    updateBlackholeRoute(!dom.onboarding?.classList.contains("route-open")),
  );
  dom.onboardingSample?.addEventListener("click", () => {
    startSampleDemo();
    finishOnboarding();
  });
  dom.onboardingSkip?.addEventListener("click", finishOnboarding);
  dom.audioToggle.addEventListener("click", () => {
    startMicrophone().catch(handleAudioError);
  });
  dom.audioInput.addEventListener("change", () => {
    startAudioFile(dom.audioInput.files?.[0]).catch(handleAudioError);
  });
  dom.sampleToggle.addEventListener("click", () => {
    if (sampleDemoActive) {
      stopSampleDemo();
      setStatus(dom.audioStatus, "AUDIO OFF", false);
      return;
    }
    startSampleDemo();
  });
  dom.auditionToggle.addEventListener("click", toggleAuditionPlayer);
  dom.languageToggle?.addEventListener("click", () =>
    applyLanguage(state.language === "zh" ? "en" : "zh"),
  );
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
    if (event.key !== "Escape") return;
    if (dom.onboarding && !dom.onboarding.hidden) {
      finishOnboarding();
      return;
    }
    openPanel(false);
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
      activeEventStrengths: {
        ripples: ripples.map((ripple) => ripple.strength),
        impacts: impacts.map((impact) => impact.strength),
        meteors: meteors
          .filter((meteor) => meteor.active)
          .map((meteor) => ({ strength: meteor.strength, life: meteor.life })),
      },
      eventCounters: { ...eventCounters },
      motion: {
        ...motionDebug,
        rawBands: [...rawBandValues],
        mappedBands: [...bandUniforms],
        fastEnvelope: { ...fastEnvelope },
        slowEnvelope: { ...slowEnvelope },
      },
      bpm: state.bpm,
      bpmConfidence: state.bpmConfidence,
      visualClock: {
        time: visualTime,
        activity: audioActivity,
        rotation,
      },
      scene: state.scene,
      sceneName: scenePreset().name,
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        fov: camera.fov,
        orbitRate: scenePreset().orbitRate,
        follow: scenePreset().cameraFollow,
        tunnelDirection: scenePreset().tunnelDirection,
        tunnelSpeed: scenePreset().tunnelSpeed,
      },
      effectiveHue: coreUniforms.uHue.value,
      effectiveWarp: coreUniforms.uWarp.value,
      sliderValues: Object.fromEntries(
        sliders.map((slider) => [slider.dataset.param, slider.value]),
      ),
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
  };

  configureQuality("laptop");
  setScene(0, false);
  setEffect(0);
  setMode("range");
  applyLanguage(state.language);
  connectMidi();
  resize();
  calibrationStartedAt = performance.now();
  window.setTimeout(() => showOnboarding(false), 700);
  requestAnimationFrame(draw);
})();
