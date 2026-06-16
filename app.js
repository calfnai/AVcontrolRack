const canvas = document.querySelector("#visualizer");
const ctx = canvas.getContext("2d", { alpha: false });

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
const blackoutToggle = document.querySelector("#blackoutToggle");
const freezeToggle = document.querySelector("#freezeToggle");
const randomize = document.querySelector("#randomize");

let width = 0;
let height = 0;
let audioContext;
let analyser;
let frequencyData;
let time = 0;
let last = performance.now();
let pointerX = 0.5;
let pointerY = 0.5;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.floor(canvas.clientWidth * dpr);
  height = Math.floor(canvas.clientHeight * dpr);
  canvas.width = width;
  canvas.height = height;
}

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
  modeLabel.textContent = `SCENE ${label}`;
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
    setStatus(oscStatus, "OSC LOCAL", false);
  }
}

function updateAudio() {
  if (!analyser || !frequencyData) return;
  analyser.getByteFrequencyData(frequencyData);
  const band = (from, to) => {
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += frequencyData[i] || 0;
    return clamp((sum / Math.max(1, to - from) / 255) * state.audioGain * 1.35);
  };
  state.bass = state.bass * 0.78 + band(2, 12) * 0.22;
  state.mid = state.mid * 0.82 + band(12, 44) * 0.18;
  state.high = state.high * 0.86 + band(44, 116) * 0.14;
  bassReadout.textContent = state.bass.toFixed(2);
  midReadout.textContent = state.mid.toFixed(2);
  highReadout.textContent = state.high.toFixed(2);
}

async function startAudio() {
  if (audioContext) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
  audioContext.createMediaStreamSource(stream).connect(analyser);
  setStatus(audioStatus, "AUDIO ON", true);
  audioToggle.classList.add("active");
}

function color(offset, alpha = 1) {
  const hue = Math.round((state.hue * 360 + offset + state.scene * 28) % 360);
  return `hsla(${hue}, ${62 + state.high * 30}%, ${38 + state.intensity * 42}%, ${alpha})`;
}

function drawGrid(cx, cy, radius, count) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.13 + state.scene * 0.26);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const wobble = Math.sin(time * (0.7 + state.speed) + i * 0.29) * state.warp;
    const r = radius * (0.28 + ((i % 9) / 9) * 0.72 + state.bass * 0.18);
    const x = Math.cos(angle + wobble) * r;
    const y = Math.sin(angle * (1 + state.mid * 0.5) - wobble) * r;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + state.size * 7 + state.bass * 18, 0, Math.PI * 2);
    ctx.fillStyle = color(i * 5, 0.18 + state.intensity * 0.32);
    ctx.fill();
  }
  ctx.restore();
}

function drawRays(cx, cy, radius, count) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "screen";
  ctx.lineWidth = 1 + state.size * 4 + state.high * 12;
  for (let i = 0; i < count; i += 1) {
    const p = i / count;
    const angle = p * Math.PI * 2 + time * (0.1 + state.speed * 0.5);
    const wave = Math.sin(time * 2 + i * 0.4) * radius * state.warp * 0.12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * radius * 0.1, Math.sin(angle) * radius * 0.1);
    ctx.lineTo(Math.cos(angle) * (radius + wave), Math.sin(angle) * (radius + wave));
    ctx.strokeStyle = color(i * 12, 0.06 + state.intensity * 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWave(cx, cy, radius) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 2 + state.size * 8;
  for (let ring = 0; ring < 5; ring += 1) {
    ctx.beginPath();
    const points = 220;
    for (let i = 0; i <= points; i += 1) {
      const p = i / points;
      const angle = p * Math.PI * 2;
      const amp = Math.sin(angle * (3 + state.scene) + time * (1 + state.speed * 3));
      const amp2 = Math.cos(angle * 7 - time * 0.7 + ring);
      const r =
        radius *
        (0.24 + ring * 0.11 + amp * state.warp * 0.07 + amp2 * state.mid * 0.1);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = color(ring * 45, 0.13 + state.intensity * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

function draw(now) {
  const delta = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.freeze) time += delta * (0.25 + state.speed * 2.8);
  updateAudio();

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = state.blackout
    ? "rgba(0,0,0,0.92)"
    : `rgba(5, 6, 7, ${0.08 + (1 - state.feedback) * 0.48})`;
  ctx.fillRect(0, 0, width, height);

  if (!state.blackout) {
    const cx = width * (0.42 + (pointerX - 0.5) * 0.16);
    const cy = height * (0.5 + (pointerY - 0.5) * 0.2);
    const radius = Math.min(width, height) * (0.38 + state.size * 0.18 + state.bass * 0.1);
    const density = Math.floor(90 + state.density * 330);

    if (state.scene % 3 === 0) {
      drawRays(cx, cy, radius * 1.4, Math.floor(density * 0.36));
      drawGrid(cx, cy, radius, density);
    } else if (state.scene % 3 === 1) {
      drawWave(cx, cy, radius * 1.25);
      drawGrid(cx, cy, radius * 0.84, Math.floor(density * 0.72));
    } else {
      drawGrid(cx, cy, radius * 1.1, density);
      drawRays(cx, cy, radius * 0.9, Math.floor(density * 0.22));
    }
  }

  requestAnimationFrame(draw);
}

function randomizeParams() {
  ["speed", "density", "feedback", "warp", "size", "audioGain", "hue", "intensity"].forEach(
    (name) => setParam(name, Math.random()),
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
