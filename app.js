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
  bass: 0,
  mid: 0,
  high: 0,
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
const modeLabel = document.querySelector("#modeLabel");
const audioToggle = document.querySelector("#audioToggle");
const echoToggle = document.querySelector("#echoToggle");
const blackoutToggle = document.querySelector("#blackoutToggle");
const freezeToggle = document.querySelector("#freezeToggle");
const randomize = document.querySelector("#randomize");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x050607, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050607, 0.035);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 120);
camera.position.set(0, 17, 24);
camera.lookAt(0, 0, 0);

const gridSize = 88;
const gridCount = gridSize * gridSize;
const spacing = 0.28;
const halfGrid = (gridSize - 1) * spacing * 0.5;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const meterColor = new THREE.Color();
const columnGeometry = new THREE.BoxGeometry(0.13, 1, 0.13);
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.95 + index * 1.2, 1.02 + index * 1.2, 128), ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025 + index * 0.01;
  scene.add(ring);
  return ring;
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
let time = 0;
let last = performance.now();
let pointerX = 0.5;
let pointerY = 0.5;

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
  modeLabel.textContent = `RANGE ECHO ${label}`;
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

function band(from, to) {
  if (!frequencyData) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += frequencyData[i] || 0;
  return clamp((sum / Math.max(1, to - from) / 255) * state.audioGain * 1.45);
}

function updateAudio() {
  let bass = 0;
  let mid = 0;
  let high = 0;
  if (analyser && frequencyData) {
    analyser.getByteFrequencyData(frequencyData);
    bass = band(2, 12);
    mid = band(12, 54);
    high = band(54, 150);
  } else {
    bass = 0.24 + Math.sin(time * 1.35) * 0.08;
    mid = 0.2 + Math.sin(time * 0.93 + 2) * 0.07;
    high = 0.12 + Math.sin(time * 1.9 + 4) * 0.04;
  }
  state.bass = state.bass * 0.82 + bass * 0.18;
  state.mid = state.mid * 0.85 + mid * 0.15;
  state.high = state.high * 0.88 + high * 0.12;
  bassReadout.textContent = state.bass.toFixed(2);
  midReadout.textContent = state.mid.toFixed(2);
  highReadout.textContent = state.high.toFixed(2);
}

async function startAudio() {
  if (audioContext) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
  audioContext.createMediaStreamSource(stream).connect(analyser);
  setStatus(audioStatus, "AUDIO ON", true);
  audioToggle.classList.add("active");
}

function frequencyAt(column, distance) {
  if (!frequencyData) return 0.2 + Math.sin(distance * 0.42 - time * 1.4) * 0.14;
  const normalized = column / (gridSize - 1);
  const curve = Math.pow(normalized, 1.7);
  const index = Math.min(frequencyData.length - 1, Math.floor(curve * frequencyData.length * 0.82) + 2);
  return frequencyData[index] / 255;
}

function updateColumns() {
  const activeSize = Math.floor(44 + state.density * 44);
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
      const freq = frequencyAt(x, distance);
      const ripple = Math.sin(distance * (0.38 + state.warp * 0.5) - time * (2.5 + state.speed * 4) + state.scene);
      const cross = Math.sin((gx * Math.cos(time * 0.12) + gz * Math.sin(time * 0.12)) * 1.1 + time);
      const energy = clamp(
        freq * 0.9 +
          state.bass * (0.55 + ripple * 0.35) * echo +
          state.mid * Math.abs(cross) * 0.5 +
          state.high * Math.max(0, Math.sin(angle * 9 + time * 5)) * 0.35,
      );
      const height = 0.08 + Math.pow(energy, 1.35) * (0.85 + state.size * 6.4);
      const y = height * 0.5;
      const lean = state.warp * state.mid * 0.12;

      dummy.position.set(gx, y, gz);
      dummy.rotation.set(lean * Math.sin(angle + time), 0, lean * Math.cos(angle - time));
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      columns.setMatrixAt(index, dummy.matrix);

      color.setHSL(
        (baseHue + energy * 0.18 + distance * 0.004 + angle / (Math.PI * 8) + z * 0.0018) % 1,
        0.7 + state.high * 0.22,
        0.27 + state.intensity * 0.34 + energy * 0.3,
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
    const phase = (time * (0.22 + state.speed * 0.52) + index / rings.length) % 1;
    const scale = 0.8 + phase * (6.8 + state.bass * 4.8);
    ring.scale.setScalar(scale);
    ring.material.opacity = state.echo && !state.blackout ? Math.max(0, (1 - phase) * state.bass * (0.18 + state.feedback * 0.42)) : 0;
    ring.material.color.setHSL((state.hue + 0.48 + index * 0.02) % 1, 0.88, 0.58);
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

function draw(now) {
  const delta = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.freeze) time += delta * (0.2 + state.speed * 2.2);
  updateAudio();

  renderer.setClearColor(state.blackout ? 0x000000 : 0x050607, 1);
  columns.visible = !state.blackout;
  floor.visible = !state.blackout;
  particles.visible = !state.blackout;

  if (!state.blackout) {
    updateColumns();
    updateRings();
    updateParticles(delta);
    const orbit = (pointerX - 0.5) * 0.34;
    camera.position.x = Math.sin(orbit) * 16;
    camera.position.y = 15 + (pointerY - 0.5) * 4 + state.bass * 1.5;
    camera.position.z = 22 + Math.cos(orbit) * 2;
    camera.lookAt(0, 1.1 + state.mid * 1.8, 0);
    floorMaterial.opacity = 0.62 + state.feedback * 0.26;
  } else {
    rings.forEach((ring) => {
      ring.material.opacity = 0;
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
  startAudio().catch(() => setStatus(audioStatus, "AUDIO BLOCK", false));
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

window.addEventListener("resize", resize);
window.addEventListener("pointermove", (event) => {
  pointerX = event.clientX / window.innerWidth;
  pointerY = event.clientY / window.innerHeight;
});

resize();
setScene(0, false);
connectMidi();
requestAnimationFrame(draw);
