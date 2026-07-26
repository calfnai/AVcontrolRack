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
    fps: 0,
    p95: 0,
    syntheticStress: false,
  };

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
      float audioLift = pow(max(0.0, bandEnergy), 1.22) * (1.0 + uIntensity * 4.8);
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
      ) * uWarp * uMid * 0.1;

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

    vec3 palette(float hueShift, float energy) {
      vec3 violet = vec3(0.31, 0.055, 0.52);
      vec3 magenta = vec3(1.0, 0.055, 0.58);
      vec3 pearl = vec3(1.0, 0.91, 0.99);
      float drift = clamp(hueShift + vSeed * 0.1, 0.0, 1.0);
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
    uniform float uHigh;
    uniform float uIntensity;
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
        float trail = aSeed * 0.3;
        float p = head - trail;
        if (meteor.w > 0.0 && p > 0.0 && p < 1.0) {
          vec3 start = vec3(meteor.x - 5.2, 17.0 + aLane * 1.3, meteor.y - 8.0);
          vec3 end = vec3(meteor.x, 0.35, meteor.y);
          transformed = mix(start, end, p);
          transformed.x += sin(aSeed * 31.0) * 0.16;
          transformed.y += cos(aSeed * 27.0) * 0.11;
          vAlpha = pow(1.0 - aSeed, 0.7) * meteor.w;
          vHeat = 1.0;
        } else {
          transformed = vec3(0.0, -200.0, 0.0);
        }
      } else {
        float drift = uTime * (0.12 + aSeed * 0.14);
        transformed.y = mod(position.y + drift * (1.0 + uHigh * 2.0), 17.0) - 1.0;
        transformed.x += sin(drift + aSeed * 23.0) * 0.8;
        transformed.z += cos(drift * 0.7 + aSeed * 19.0) * 0.7;
        vAlpha = (0.08 + uHigh * 0.22) * (0.35 + aSeed * 0.65);
      }

      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      gl_PointSize = clamp(
        (aKind > 0.5 ? 10.0 : 5.0) * uPointScale / max(3.0, -mvPosition.z) * 12.0,
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
    varying float vAlpha;
    varying float vHeat;

    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = length(p);
      float glow = 1.0 - smoothstep(0.04, 0.5, d);
      if (glow * vAlpha < 0.01) discard;
      vec3 pink = mix(vec3(0.55, 0.08, 0.72), vec3(1.0, 0.17, 0.67), uHue);
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

  let audioContext;
  let analyser;
  let frequencyData;
  let audioSource;
  let microphoneStream;
  let audioElement;
  let audioObjectUrl;
  let sampleDemoActive = false;
  let sampleDemoStartedAt = 0;
  let pointerX = 0.5;
  let pointerY = 0.48;
  let time = 0;
  let lastFrameAt = performance.now();
  let lastAudioAt = 0;
  let lastRippleAt = -10;
  let lastImpactAt = -10;
  let lastMeteorAt = -10;
  let previousLowMid = 0;
  let previousSubBass = 0;
  let previousHigh = 0;
  let rotation = 0;
  let rotationTarget = 0;
  const beatIntervals = [];
  const energyHistory = [];
  const frameTimes = [];
  let statsUpdatedAt = 0;
  let calibrationStartedAt = performance.now();
  let lowFpsDuration = 0;
  let idlePulseAt = -10;

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
    state.scene = Number(index) || 0;
    sceneButtons.forEach((button) =>
      button.classList.toggle("active", Number(button.dataset.scene) === state.scene),
    );
    const presets = [
      { hue: 0.9, warp: 0.42, feedback: 0.58 },
      { hue: 0.74, warp: 0.56, feedback: 0.72 },
      { hue: 0.98, warp: 0.24, feedback: 0.46 },
      { hue: 0.62, warp: 0.72, feedback: 0.64 },
      { hue: 0.84, warp: 0.34, feedback: 0.82 },
      { hue: 0.7, warp: 0.68, feedback: 0.5 },
      { hue: 1, warp: 0.18, feedback: 0.68 },
      { hue: 0.8, warp: 0.48, feedback: 0.9 },
    ];
    const preset = presets[state.scene];
    setParam("hue", preset.hue, false);
    setParam("warp", preset.warp, false);
    setParam("feedback", preset.feedback, false);
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
    const audioLabel = sampleDemoActive ? "SAMPLE AUDIO" : analyser ? "LIVE AUDIO" : "IDLE";
    dom.modeLabel.textContent =
      state.mode === "form"
        ? `PARTICLE FORM / ${state.particleLabel || "ARE"}`
        : `RANGE FIELD / ${audioLabel}`;
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

  function handleAudioError(error) {
    const label = describeAudioError(error);
    setStatus(dom.audioStatus, `${label} / TRY SAMPLE`, false);
    dom.sampleToggle.classList.add("primary");
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

  function spawnRipple(strength = 0.6) {
    const pulse = {
      age: 0,
      life: 1.75 + state.feedback * 1.05,
      strength: clamp(strength, 0.12, 1),
    };
    if (ripples.length < RIPPLE_SLOTS) ripples.push(pulse);
    else ripples[rippleCursor++ % RIPPLE_SLOTS] = pulse;
  }

  function spawnImpact(strength = 0.75, x, z) {
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
  }

  function spawnMeteor(strength = 0.72) {
    const slot = meteors[meteorCursor++ % METEOR_SLOTS];
    const radius = FIELD_HALF * 0.72 * Math.sqrt(Math.random());
    const angle = Math.random() * Math.PI * 2;
    slot.active = true;
    slot.age = 0;
    slot.life = 0.72 + (1 - strength) * 0.34;
    slot.x = Math.cos(angle) * radius;
    slot.z = Math.sin(angle) * radius;
    slot.strength = clamp(strength, 0.25, 1);
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
    const sampleValues = sampleDemoActive ? sampleBands(nowSeconds) : null;
    const live = Boolean(sampleValues || (analyser && frequencyData));

    if (sampleValues) {
      sampleValues.forEach((value, index) => {
        bandUniforms[index] = bandUniforms[index] * 0.58 + value * 0.42;
      });
    } else if (live) {
      analyser.getByteFrequencyData(frequencyData);
      ranges.forEach(([from, to], index) => {
        bandUniforms[index] = bandUniforms[index] * 0.7 + bandEnergy(from, to) * 0.3;
      });
    } else {
      ranges.forEach((_, index) => {
        const wave =
          0.045 +
          Math.max(0, Math.sin(time * (0.42 + index * 0.055) - index * 0.74)) *
            (0.025 + (7 - index) * 0.004);
        bandUniforms[index] = bandUniforms[index] * 0.9 + wave * 0.1;
      });
    }

    const subBass = bandUniforms[0] * 0.7 + bandUniforms[1] * 0.3;
    const bass = bandUniforms[1] * 0.35 + bandUniforms[2] * 0.65;
    const lowMid = bandUniforms[3] * 0.66 + bandUniforms[4] * 0.34;
    const mid = bandUniforms[4] * 0.42 + bandUniforms[5] * 0.38 + bandUniforms[6] * 0.2;
    const liveHigh = sampleValues
      ? sampleValues[7]
      : live
        ? bandEnergy(3500, 9500)
        : 0.035 + Math.max(0, Math.sin(time * 0.71)) * 0.03;

    state.subBass = state.subBass * 0.76 + subBass * 0.24;
    state.bass = state.bass * 0.78 + bass * 0.22;
    state.lowMid = state.lowMid * 0.8 + lowMid * 0.2;
    state.mid = state.mid * 0.84 + mid * 0.16;
    state.high = state.high * 0.86 + liveHigh * 0.14;

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
    const lowJump = lowMidEnergy - previousLowMid;
    const subJump = state.subBass - previousSubBass;
    const highJump = state.high - previousHigh;
    energyHistory.push(lowMidEnergy);
    if (energyHistory.length > 180) energyHistory.shift();
    const mean = energyHistory.reduce((sum, value) => sum + value, 0) / energyHistory.length;
    const variance =
      energyHistory.reduce((sum, value) => sum + (value - mean) ** 2, 0) / energyHistory.length;
    const deviation = Math.sqrt(variance);
    const rippleThreshold = Math.max(0.13, mean + deviation * 0.72);

    if (
      live &&
      nowSeconds - lastRippleAt > 0.22 &&
      lowMidEnergy > rippleThreshold &&
      lowJump > 0.018
    ) {
      spawnRipple(clamp(lowMidEnergy * 1.38));
      if (lastAudioAt > 0) {
        const interval = nowSeconds - lastAudioAt;
        if (interval > 0.28 && interval < 1.25) {
          beatIntervals.push(interval);
          if (beatIntervals.length > 14) beatIntervals.shift();
          const sorted = [...beatIntervals].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const bpm = 60 / median;
          state.bpm = bpm < 70 ? bpm * 2 : bpm > 170 ? bpm / 2 : bpm;
        }
      }
      lastAudioAt = nowSeconds;
      lastRippleAt = nowSeconds;
    }

    const subBassHit = state.subBass > Math.max(0.2, mean * 0.92) && subJump > 0.026;
    const fallbackHit =
      !subBassHit && lowMidEnergy > mean + deviation * 1.35 && lowJump > 0.038;
    if (live && nowSeconds - lastImpactAt > 0.52 && (subBassHit || fallbackHit)) {
      spawnImpact(clamp((subBassHit ? state.subBass : lowMidEnergy) * 1.45));
      lastImpactAt = nowSeconds;
    }

    if (live && nowSeconds - lastMeteorAt > 0.66 && state.high > 0.16 && highJump > 0.018) {
      spawnMeteor(clamp(state.high * 1.65));
      lastMeteorAt = nowSeconds;
    }

    if (!live && nowSeconds - idlePulseAt > 3.2) {
      spawnRipple(0.3);
      if (Math.floor(nowSeconds / 7) !== Math.floor(idlePulseAt / 7)) spawnImpact(0.28);
      idlePulseAt = nowSeconds;
    }

    previousLowMid = lowMidEnergy;
    previousSubBass = state.subBass;
    previousHigh = state.high;

    coreUniforms.uBass.value = state.bass;
    coreUniforms.uMid.value = state.mid;
    coreUniforms.uHigh.value = state.high;
    atmosphereUniforms.uHigh.value = state.high;
    dom.bassReadout.textContent = state.bass.toFixed(2);
    dom.midReadout.textContent = state.mid.toFixed(2);
    dom.highReadout.textContent = state.high.toFixed(2);
    dom.bpmReadout.textContent = state.bpm ? String(Math.round(state.bpm)) : "--";
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
    coreUniforms.uEffectAmount.value +=
      ((state.mode === "form" && state.effect > 0 ? 1 : 0) -
        coreUniforms.uEffectAmount.value) *
      Math.min(1, delta * 2.2);
    atmosphereUniforms.uTime.value = time;
    atmosphereUniforms.uIntensity.value = state.intensity;
    atmosphereUniforms.uHue.value = state.hue;
    postUniforms.uTime.value = time;

    coreField.visible = !state.blackout;
    atmosphere.visible = !state.blackout;
    const desiredCoreRotation =
      state.mode === "form" ? Math.sin(time * 0.22) * 0.08 : rotation;
    coreField.rotation.y +=
      (desiredCoreRotation - coreField.rotation.y) * Math.min(1, delta * 3.6);
    atmosphere.rotation.y = rotation * 0.58;

    const orbit = (pointerX - 0.5) * 0.28;
    const height = 9.6 + (0.5 - pointerY) * 2.2;
    camera.position.x += (Math.sin(orbit) * 11 - camera.position.x) * 0.035;
    camera.position.y += (height - camera.position.y) * 0.035;
    camera.position.z += (27.5 + Math.cos(orbit) * 1.4 - camera.position.z) * 0.035;
    camera.lookAt(0, 1.3 + state.bass * 1.4, 0);

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
    quality: (name) => configureQuality(name),
    mode: setMode,
    effect: setEffect,
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
