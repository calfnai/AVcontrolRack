const canvas = document.querySelector("#visualizer");
const THREE = window.THREE;

if (!THREE) {
  throw new Error("Three.js failed to load. Check vendor/three.min.js.");
}

const state = {
  scene: 0,
  speed: 0.38,
  density: 0.62,
  feedback: 0.44,
  warp: 0.52,
  size: 0.46,
  audioGain: 0.7,
  hue: 0.58,
  intensity: 0.76,
  blackout: false,
  freeze: false,
  echo: true,
  particleMap: null,
  particleLabel: "",
  bass: 0,
  mid: 0,
  high: 0,
  subBass: 0,
  lowMid: 0,
  beat: 0,
  bpm: 0,
};

const sceneNames = "ABCDEFGH".split("");
const sliders = [...document.querySelectorAll("[data-param]")];
const sceneButtons = [...document.querySelectorAll(".scene")];
const audioStatus = document.querySelector("#audioStatus");
const midiStatus = document.querySelector("#midiStatus");
const oscStatus = document.querySelector("#oscStatus");
const sceneReadout = document.querySelector("#sceneReadout");
const bassReadout = document.querySelector("#bassReadout");
const midReadout = document.querySelector("#midReadout");
const highReadout = document.querySelector("#highReadout");
const bpmReadout = document.querySelector("#bpmReadout");
const modeLabel = document.querySelector("#modeLabel");
const audioToggle = document.querySelector("#audioToggle");
const audioInput = document.querySelector("#audioInput");
const echoToggle = document.querySelector("#echoToggle");
const blackoutToggle = document.querySelector("#blackoutToggle");
const freezeToggle = document.querySelector("#freezeToggle");
const randomize = document.querySelector("#randomize");
const particleText = document.querySelector("#particleText");
const textParticle = document.querySelector("#textParticle");
const imageInput = document.querySelector("#imageInput");
const clearParticle = document.querySelector("#clearParticle");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x050607, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050607, 0.035);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
camera.position.set(0, 17, 24);
camera.lookAt(0, 0, 0);

const gridSize = 112;
const gridCount = gridSize * gridSize;
const spacing = 0.22;
const halfGrid = (gridSize - 1) * spacing * 0.5;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const meterColor = new THREE.Color();
const columnGeometry = new THREE.BoxGeometry(0.105, 1, 0.105);
const columnMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  metalness: 0.12,
  roughness: 0.34,
  emissive: 0x111111,
  emissiveIntensity: 0.45,
});
const columns = new THREE.InstancedMesh(columnGeometry, columnMaterial, gridCount);
columns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
columns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gridCount * 3), 3);
scene.add(columns);

const floorGeometry = new THREE.PlaneGeometry(34, 34, 64, 64);
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x080a0d,
  metalness: 0.05,
  roughness: 0.74,
  transparent: true,
  opacity: 0.84,
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);

const ringMaterial = new THREE.MeshBasicMaterial({
  color: 0x7cf7ff,
  transparent: true,
  opacity: 0,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const rings = Array.from({ length: 7 }, (_, index) => {
  const baseRadius = 0.95 + index * 1.2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(baseRadius, baseRadius + 0.07, 128), ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025 + index * 0.01;
  ring.userData.baseRadius = baseRadius;
  scene.add(ring);
  return ring;
});

const bombMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const bombs = Array.from({ length: 10 }, () => {
  const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), bombMaterial.clone());
  bomb.visible = false;
  scene.add(bomb);
  return bomb;
});

const particleCount = 420;
const particlePositions = new Float32Array(particleCount * 3);
const particleVelocities = [];
for (let i = 0; i < particleCount; i += 1) {
  particlePositions[i * 3] = (Math.random() - 0.5) * 22;
  particlePositions[i * 3 + 1] = Math.random() * 7 + 2;
  particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 22;
  particleVelocities.push({
    x: (Math.random() - 0.5) * 0.02,
    y: -0.02 - Math.random() * 0.05,
    z: 0.04 + Math.random() * 0.12,
  });
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particleMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.055,
  transparent: true,
  opacity: 0.56,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

const ambient = new THREE.AmbientLight(0x718090, 0.8);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(-8, 18, 12);
scene.add(keyLight);
const accentLight = new THREE.PointLight(0x56f0ff, 22, 34);
accentLight.position.set(0, 8, 0);
scene.add(accentLight);

let audioContext;
let analyser;
let frequencyData;
let audioSource;
let audioElement;
let microphoneStream;
let time = 0;
let last = performance.now();
let pointerX = 0.5;
let pointerY = 0.5;
let rotationPhase = 0;
let beatHold = 0;
let lastBeatAt = 0;
let lastBombAt = 0;
let previousBeatEnergy = 0;
const beatIntervals = [];
const impacts = [];
const particleCanvas = document.createElement("canvas");
const particleCtx = particleCanvas.getContext("2d", { willReadFrequently: true });
const particleSize = 128;
particleCanvas.width = particleSize;
particleCanvas.height = particleSize;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(element, text, hot = false) {
  element.textContent = text;
  element.classList.toggle("hot", hot);
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
  const label = sceneNames[state.scene];
  sceneReadout.textContent = label;
  modeLabel.textContent = state.particleMap ? `PARTICLE ${state.particleLabel || label}` : `RANGE ECHO ${label}`;
  if (shouldSend) sendParam("scene", state.scene);
}

async function sendParam(name, value) {
  try {
    await fetch("/api/param", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
    setStatus(oscStatus, "OSC SENT", true);
  } catch {
    setStatus(oscStatus, "WEB ONLY", false);
  }
}

function describeAudioError(error) {
  if (!window.isSecureContext) return "MIC NEEDS HTTPS";
  if (!navigator.mediaDevices?.getUserMedia) return "NO MIC API";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "MIC DENIED";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "NO MIC";
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "MIC BUSY";
  if (error?.name === "OverconstrainedError") return "MIC CONFIG";
  return "AUDIO BLOCK";
}

function ensureAnalyser() {
  audioContext ||= new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
  return analyser;
}

async function connectAudioNode(source, shouldMonitor = false) {
  if (audioSource) audioSource.disconnect();
  if (analyser) analyser.disconnect();
  const nextAnalyser = ensureAnalyser();
  audioSource = source;
  audioSource.connect(nextAnalyser);
  if (shouldMonitor) nextAnalyser.connect(audioContext.destination);
  if (audioContext.state === "suspended") await audioContext.resume();
}

function band(from, to) {
  if (!frequencyData) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += frequencyData[i] || 0;
  return clamp((sum / Math.max(1, to - from) / 255) * state.audioGain * 1.45);
}

function hzBand(fromHz, toHz) {
  if (!frequencyData || !audioContext) return 0;
  const nyquist = audioContext.sampleRate / 2;
  const from = Math.max(1, Math.floor((fromHz / nyquist) * frequencyData.length));
  const to = Math.max(from + 1, Math.ceil((toHz / nyquist) * frequencyData.length));
  return band(from, Math.min(frequencyData.length, to));
}

function idleSignal(rate, offset, amount = 0.08) {
  return amount + Math.sin(time * rate + offset) * amount * 0.42;
}

function updateAudio() {
  const nowSeconds = performance.now() / 1000;
  let bass = 0;
  let mid = 0;
  let high = 0;
  let subBass = 0;
  let lowMid = 0;
  if (analyser && frequencyData) {
    analyser.getByteFrequencyData(frequencyData);
    subBass = hzBand(20, 58);
    bass = hzBand(58, 140);
    lowMid = hzBand(140, 420);
    mid = hzBand(420, 3500);
    high = hzBand(3500, 9500);
  } else {
    subBass = idleSignal(0.43, 1, 0.035);
    bass = idleSignal(1.35, 0, 0.22);
    lowMid = idleSignal(0.86, 2.2, 0.18);
    mid = idleSignal(0.93, 2, 0.15);
    high = idleSignal(1.9, 4, 0.1);
  }

  state.subBass = state.subBass * 0.76 + subBass * 0.24;
  state.bass = state.bass * 0.8 + bass * 0.2;
  state.lowMid = state.lowMid * 0.82 + lowMid * 0.18;
  state.mid = state.mid * 0.86 + mid * 0.14;
  state.high = state.high * 0.88 + high * 0.12;

  const beatEnergy = state.subBass * 0.35 + state.bass * 0.42 + state.lowMid * 0.23;
  const jump = beatEnergy - previousBeatEnergy;
  const beatThreshold = 0.09 + (1 - state.audioGain) * 0.08;
  if (jump > beatThreshold && beatEnergy > 0.22 && nowSeconds - lastBeatAt > 0.24) {
    if (lastBeatAt) {
      const interval = nowSeconds - lastBeatAt;
      if (interval > 0.28 && interval < 1.5) {
        beatIntervals.push(interval);
        if (beatIntervals.length > 10) beatIntervals.shift();
        const average = beatIntervals.reduce((sum, item) => sum + item, 0) / beatIntervals.length;
        state.bpm = Math.round(60 / average);
      }
    }
    lastBeatAt = nowSeconds;
    beatHold = 1;
  }
  beatHold *= 0.9;
  state.beat = state.beat * 0.72 + beatHold * 0.28;
  previousBeatEnergy = previousBeatEnergy * 0.72 + beatEnergy * 0.28;

  const bombEnergy = Math.max(state.subBass * 1.15, state.subBass < 0.08 ? beatEnergy * 0.72 : 0);
  const bombThreshold = state.subBass > 0.08 ? 0.38 : 0.46;
  if (bombEnergy > bombThreshold && nowSeconds - lastBombAt > 0.38) {
    spawnImpact(bombEnergy, state.subBass > 0.08);
    lastBombAt = nowSeconds;
  }

  bassReadout.textContent = state.bass.toFixed(2);
  midReadout.textContent = state.mid.toFixed(2);
  highReadout.textContent = state.high.toFixed(2);
  bpmReadout.textContent = state.bpm ? String(state.bpm) : "--";
}

async function startAudio() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia is unavailable");
  }
  if (microphoneStream) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  microphoneStream = stream;
  audioContext ||= new AudioContext();
  await connectAudioNode(audioContext.createMediaStreamSource(stream), false);
  setStatus(audioStatus, "AUDIO ON", true);
  audioToggle.classList.add("active");
}

async function startAudioFile(file) {
  if (!file) return;
  audioElement?.pause();
  audioElement = new Audio(URL.createObjectURL(file));
  audioElement.loop = true;
  audioContext ||= new AudioContext();
  await connectAudioNode(audioContext.createMediaElementSource(audioElement), true);
  await audioElement.play();
  setStatus(audioStatus, "FILE ON", true);
  audioToggle.classList.remove("active");
}

function setParticleMap(map, label) {
  state.particleMap = map;
  state.particleLabel = label;
  modeLabel.textContent = map ? `PARTICLE ${label}` : `RANGE ECHO ${sceneNames[state.scene]}`;
}

function particleMapFromCanvas(label) {
  const pixels = particleCtx.getImageData(0, 0, particleSize, particleSize).data;
  const map = new Float32Array(particleSize * particleSize);
  for (let i = 0; i < map.length; i += 1) {
    const offset = i * 4;
    const luma = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    map[i] = luma * (pixels[offset + 3] / 255);
  }
  setParticleMap(map, label);
}

function applyTextParticle() {
  const value = (particleText.value || "AV").trim().slice(0, 12).toUpperCase();
  particleCtx.clearRect(0, 0, particleSize, particleSize);
  particleCtx.fillStyle = "#000";
  particleCtx.fillRect(0, 0, particleSize, particleSize);
  particleCtx.fillStyle = "#fff";
  particleCtx.textAlign = "center";
  particleCtx.textBaseline = "middle";
  const size = value.length > 6 ? 40 : value.length > 3 ? 52 : 70;
  particleCtx.font = `900 ${size}px Inter, Arial, sans-serif`;
  particleCtx.fillText(value, particleSize / 2, particleSize / 2 + 4);
  particleMapFromCanvas(value);
}

function applyImageParticle(file) {
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    particleCtx.clearRect(0, 0, particleSize, particleSize);
    particleCtx.fillStyle = "#000";
    particleCtx.fillRect(0, 0, particleSize, particleSize);
    const scale = Math.min(particleSize / image.width, particleSize / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    particleCtx.drawImage(image, (particleSize - width) / 2, (particleSize - height) / 2, width, height);
    particleMapFromCanvas("IMAGE");
    URL.revokeObjectURL(image.src);
  };
  image.src = URL.createObjectURL(file);
}

function sampleParticleMap(x, z, start, activeSize) {
  if (!state.particleMap) return 1;
  const u = clamp((x - start) / Math.max(1, activeSize - 1));
  const v = clamp((z - start) / Math.max(1, activeSize - 1));
  const px = Math.floor(u * (particleSize - 1));
  const py = Math.floor(v * (particleSize - 1));
  return state.particleMap[py * particleSize + px] || 0;
}

function spawnImpact(strength, hasSubBass) {
  const radius = halfGrid * 0.78 * Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;
  impacts.push({
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    age: 0,
    life: hasSubBass ? 1.8 : 1.25,
    strength: clamp(strength, 0, 1),
    hue: (state.hue + Math.random() * 0.24 + (hasSubBass ? 0.06 : 0.52)) % 1,
    reverse: Math.random() > 0.45,
  });
  if (impacts.length > bombs.length) impacts.shift();
}

function updateImpacts(delta) {
  for (let i = impacts.length - 1; i >= 0; i -= 1) {
    impacts[i].age += delta;
    if (impacts[i].age > impacts[i].life) impacts.splice(i, 1);
  }
}

function impactContribution(gx, gz) {
  let lift = 0;
  let flash = 0;
  for (const impact of impacts) {
    const p = clamp(impact.age / impact.life);
    const dx = gx - impact.x;
    const dz = gz - impact.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const radius = impact.reverse ? (1 - p) * 10.5 + 0.6 : p * 12 + 0.4;
    const shell = Math.exp(-Math.pow(d - radius, 2) * 1.45);
    const core = Math.exp(-d * 0.55) * Math.max(0, 1 - p * 2.4);
    const amp = impact.strength * Math.pow(1 - p, 0.72);
    lift += (shell * 2.6 + core * 4.2) * amp;
    flash += shell * amp;
  }
  return { lift, flash };
}

function frequencyAt(column, distance) {
  if (!frequencyData) return 0.2 + Math.sin(distance * 0.42 - time * 1.4) * 0.14;
  const normalized = column / (gridSize - 1);
  const curve = Math.pow(normalized, 1.7);
  const maxIndex = audioContext
    ? Math.min(frequencyData.length - 1, Math.ceil((3500 / (audioContext.sampleRate / 2)) * frequencyData.length))
    : Math.floor(frequencyData.length * 0.18);
  const index = Math.min(maxIndex, Math.floor(curve * maxIndex) + 2);
  return frequencyData[index] / 255;
}

function updateColumns() {
  const activeSize = Math.floor(56 + state.density * 56);
  const start = Math.floor((gridSize - activeSize) / 2);
  const end = start + activeSize;
  const baseHue = (state.hue + state.scene * 0.065) % 1;
  const echo = state.echo ? 1 : 0;
  let visible = 0;

  for (let z = 0; z < gridSize; z += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const index = z * gridSize + x;
      if (x < start || x >= end || z < start || z >= end) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        columns.setMatrixAt(index, dummy.matrix);
        continue;
      }

      const gx = x * spacing - halfGrid;
      const gz = z * spacing - halfGrid;
      const dx = x - gridSize * 0.5;
      const dz = z - gridSize * 0.5;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dz, dx);
      const mask = sampleParticleMap(x, z, start, activeSize);
      if (state.particleMap && mask < 0.08) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        columns.setMatrixAt(index, dummy.matrix);
        continue;
      }
      const freq = frequencyAt(x, distance);
      const centerFalloff = Math.exp(-distance * (0.045 + state.warp * 0.02));
      const lowMidForce = state.bass * 0.64 + state.lowMid * 0.92 + state.beat * 0.34;
      const centerRipple = Math.max(0, Math.sin(distance * (0.46 + state.warp * 0.18) - lowMidForce * 4.8 + state.scene * 0.3));
      const cross = Math.sin((gx * Math.cos(time * 0.12) + gz * Math.sin(time * 0.12)) * 1.1 + time);
      const impact = impactContribution(gx, gz);
      const energy =
        freq * 0.55 +
        lowMidForce * centerFalloff * 1.25 * echo +
        centerRipple * lowMidForce * 0.75 * echo +
        state.mid * Math.abs(cross) * 0.3 +
        state.high * Math.max(0, Math.sin(angle * 9 + time * 5)) * 0.24 +
        impact.lift * 0.26;
      const formLift = state.particleMap ? mask * (0.7 + state.intensity * 2.6) : 0;
      const height =
        0.07 +
        formLift +
        Math.pow(Math.max(0, energy) * (0.35 + mask * 0.65), 1.12) * (0.95 + state.size * 7.8);
      const y = height * 0.5;
      const lean = state.warp * state.mid * 0.12;

      dummy.position.set(gx, y, gz);
      dummy.rotation.set(lean * Math.sin(angle + time), 0, lean * Math.cos(angle - time));
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      columns.setMatrixAt(index, dummy.matrix);

      color.setHSL(
        (baseHue + energy * 0.18 + mask * 0.16 + distance * 0.004 + angle / (Math.PI * 8) + z * 0.0018) % 1,
        0.7 + state.high * 0.22,
        0.22 + state.intensity * 0.28 + Math.max(0, energy) * 0.18 + impact.flash * 0.3 + mask * 0.18,
      );
      columns.setColorAt(index, color);
      visible += 1;
    }
  }

  columns.count = gridCount;
  columns.instanceMatrix.needsUpdate = true;
  columns.instanceColor.needsUpdate = true;
  columnMaterial.emissiveIntensity = 0.12 + state.intensity * 0.62 + state.high * 0.7;
  accentLight.intensity = state.blackout ? 0 : 16 + state.bass * 46 + state.high * 28;
  meterColor.setHSL(baseHue, 0.9, 0.55);
  accentLight.color.copy(meterColor);
  return visible;
}

function updateRings() {
  rings.forEach((ring, index) => {
    const baseRadius = ring.userData.baseRadius || 1;
    if (index < 3) {
      const lowMidForce = state.bass * 0.52 + state.lowMid * 0.92 + state.beat * 0.42;
      const radius = 1.8 + index * 2.1 + lowMidForce * (3.2 + index * 1.3);
      ring.position.set(0, 0.028 + index * 0.01, 0);
      ring.scale.setScalar(radius / baseRadius);
      ring.rotation.z = rotationPhase;
      ring.material.opacity = state.echo && !state.blackout ? lowMidForce * (0.08 + state.feedback * 0.16) * (1 - index * 0.18) : 0;
      ring.material.color.setHSL((state.hue + 0.48 + index * 0.035) % 1, 0.88, 0.58);
      return;
    }

    const impact = impacts[index - 3];
    if (!impact || state.blackout) {
      ring.material.opacity = 0;
      return;
    }

    const p = clamp(impact.age / impact.life);
    const radius = impact.reverse ? (1 - p) * 10.5 + 0.8 : p * 12 + 0.8;
    ring.position.set(impact.x, 0.06 + index * 0.005, impact.z);
    ring.scale.setScalar(radius / baseRadius);
    ring.rotation.z = rotationPhase;
    ring.material.opacity = Math.pow(1 - p, 0.7) * impact.strength * (0.18 + state.feedback * 0.34);
    ring.material.color.setHSL(impact.hue, 0.92, 0.62);
  });
}

function updateBombs() {
  bombs.forEach((bomb, index) => {
    const impact = impacts[index];
    if (!impact || state.blackout) {
      bomb.visible = false;
      bomb.material.opacity = 0;
      return;
    }

    const fall = clamp(impact.age / Math.min(0.32, impact.life * 0.35));
    const afterGlow = clamp(1 - (impact.age - 0.32) / Math.max(0.1, impact.life - 0.32));
    bomb.visible = true;
    bomb.position.set(impact.x, 6.5 * (1 - fall) + 0.28, impact.z);
    bomb.scale.setScalar(0.9 + impact.strength * 2.8 + Math.max(0, 1 - fall) * 1.6);
    bomb.material.opacity = fall < 1 ? 0.72 : afterGlow * 0.28;
    bomb.material.color.setHSL(impact.hue, 0.95, 0.68);
  });
}

function updateParticles(delta) {
  const positions = particleGeometry.attributes.position.array;
  const boost = state.echo ? state.high * 0.26 : 0;
  for (let i = 0; i < particleCount; i += 1) {
    const offset = i * 3;
    const velocity = particleVelocities[i];
    positions[offset] += velocity.x * (1 + boost * 18);
    positions[offset + 1] += velocity.y * (1 + state.speed * 4) - boost * delta * 14;
    positions[offset + 2] += velocity.z * (1 + boost * 22);

    if (
      positions[offset + 1] < 0.4 ||
      positions[offset] < -15 ||
      positions[offset] > 15 ||
      positions[offset + 2] > 15
    ) {
      positions[offset] = (Math.random() - 0.5) * 23;
      positions[offset + 1] = 5 + Math.random() * 8 + state.high * 6;
      positions[offset + 2] = -13 - Math.random() * 5;
    }
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particleMaterial.opacity = state.blackout ? 0 : 0.22 + state.high * 0.72;
  particleMaterial.size = 0.035 + state.size * 0.035 + state.high * 0.09;
  particleMaterial.color.setHSL((state.hue + 0.18 + state.scene * 0.04) % 1, 0.8, 0.72);
}

function resize() {
  const { clientWidth, clientHeight } = canvas;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / Math.max(1, clientHeight);
  camera.updateProjectionMatrix();
}

function updateRotation(delta) {
  const bpm = state.bpm || 72;
  const beatTurnsPerSecond = bpm / 60;
  const manualScale = 0.08 + state.speed * 0.34;
  rotationPhase += delta * beatTurnsPerSecond * manualScale;
  columns.rotation.y = rotationPhase;
  particles.rotation.y = rotationPhase * 0.72;
  floor.rotation.z = rotationPhase;
}

function draw(now) {
  const delta = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.freeze) {
    time += delta * (0.12 + state.speed * 1.35);
    updateRotation(delta);
    updateImpacts(delta);
  }
  updateAudio();

  renderer.setClearColor(state.blackout ? 0x000000 : 0x050607, 1);
  columns.visible = !state.blackout;
  floor.visible = !state.blackout;
  particles.visible = !state.blackout;

  if (!state.blackout) {
    updateColumns();
    updateRings();
    updateBombs();
    updateParticles(delta);
    const orbit = (pointerX - 0.5) * 0.34;
    camera.position.x = Math.sin(orbit) * 18;
    camera.position.y = 21 + (pointerY - 0.5) * 4 + state.bass * 2;
    camera.position.z = 31 + Math.cos(orbit) * 2.5;
    camera.lookAt(0, 2.4 + state.mid * 2.2, 0);
    floorMaterial.opacity = 0.62 + state.feedback * 0.26;
  } else {
    rings.forEach((ring) => {
      ring.material.opacity = 0;
    });
    bombs.forEach((bomb) => {
      bomb.visible = false;
      bomb.material.opacity = 0;
    });
  }

  renderer.render(scene, camera);
  requestAnimationFrame(draw);
}

function randomizeParams() {
  ["speed", "density", "feedback", "warp", "size", "audioGain", "hue", "intensity"].forEach((name) =>
    setParam(name, Math.random()),
  );
}

function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    setStatus(midiStatus, "NO MIDI", false);
    return;
  }

  navigator
    .requestMIDIAccess()
    .then((access) => {
      const inputs = [...access.inputs.values()];
      setStatus(midiStatus, inputs.length ? "MIDI ON" : "MIDI WAIT", Boolean(inputs.length));
      access.onstatechange = () => {
        const liveInputs = [...access.inputs.values()];
        setStatus(midiStatus, liveInputs.length ? "MIDI ON" : "MIDI WAIT", Boolean(liveInputs.length));
        liveInputs.forEach((input) => {
          input.onmidimessage = onMidi;
        });
      };
      inputs.forEach((input) => {
        input.onmidimessage = onMidi;
      });
    })
    .catch(() => setStatus(midiStatus, "MIDI BLOCK", false));
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

audioToggle.addEventListener("click", () => {
  startAudio().catch((error) => setStatus(audioStatus, describeAudioError(error), false));
});

audioInput.addEventListener("change", () => {
  startAudioFile(audioInput.files?.[0]).catch((error) => setStatus(audioStatus, describeAudioError(error), false));
});

echoToggle.addEventListener("click", () => {
  state.echo = !state.echo;
  echoToggle.classList.toggle("active", state.echo);
  sendParam("echo", state.echo ? 1 : 0);
});

blackoutToggle.addEventListener("click", () => {
  state.blackout = !state.blackout;
  blackoutToggle.classList.toggle("active", state.blackout);
  sendParam("blackout", state.blackout ? 1 : 0);
});

freezeToggle.addEventListener("click", () => {
  state.freeze = !state.freeze;
  freezeToggle.classList.toggle("active", state.freeze);
  sendParam("freeze", state.freeze ? 1 : 0);
});

randomize.addEventListener("click", randomizeParams);

textParticle.addEventListener("click", applyTextParticle);

particleText.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applyTextParticle();
});

imageInput.addEventListener("change", () => applyImageParticle(imageInput.files?.[0]));

clearParticle.addEventListener("click", () => setParticleMap(null, ""));

window.addEventListener("resize", resize);
window.addEventListener("pointermove", (event) => {
  pointerX = event.clientX / window.innerWidth;
  pointerY = event.clientY / window.innerHeight;
});

resize();
setScene(0, false);
connectMidi();
requestAnimationFrame(draw);
