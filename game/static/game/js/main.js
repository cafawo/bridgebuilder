import { BridgeEditor } from "./editor.js";
import { loadLevel } from "./levels.js";
import { BridgeSimulation } from "./physics.js";
import { Renderer } from "./renderer.js";
import { pointerToCanvas } from "./ui.js";

const canvas = document.getElementById("game-canvas");
const seedForm = document.getElementById("seed-form");
const seedInput = document.getElementById("seed-input");
const randomSeedButton = document.getElementById("random-seed-button");

let level = null;
let currentSeed = "";
let editor = null;
let renderer = null;
let simulation = null;
let mode = "build";
let paused = false;
let systemMessage = "";
let systemMessageUntil = 0;
let lastFrame = performance.now();
let inputBound = false;
let loadToken = 0;

bootstrap();
window.bridgebuilderDebug = {
  state: () => ({
    mode,
    selectedNode: editor?.selectedNode ?? null,
    help: editor?.helpText() ?? null,
    seed: currentSeed,
    nodeCount: editor?.nodes.length ?? 0,
    beamCount: editor?.beams.length ?? 0,
    canUndo: (editor?.history.length ?? 0) > 0,
    generator: level?.generator?.name ?? null,
  }),
};

async function bootstrap() {
  try {
    bindInput();
    await loadSeed(randomSeed());
    canvas.focus();
    requestAnimationFrame(loop);
  } catch (error) {
    drawLoadError(error);
  }
}

async function loadSeed(seed) {
  const normalizedSeed = normalizeSeed(seed);
  const token = (loadToken += 1);
  setSystemMessage("LOADING");
  seedInput.value = normalizedSeed;
  const loadedLevel = await loadLevel(levelUrl(normalizedSeed));

  if (token !== loadToken) {
    return;
  }

  currentSeed = loadedLevel.seed || normalizedSeed;
  seedInput.value = currentSeed;
  level = loadedLevel;
  editor = new BridgeEditor(level);
  simulation = null;
  mode = "build";
  paused = false;

  if (renderer) {
    renderer.setLevel(level);
  } else {
    renderer = new Renderer(canvas, level);
  }

  systemMessage = "";
  systemMessageUntil = 0;
}

function bindInput() {
  if (inputBound) {
    return;
  }
  inputBound = true;

  seedForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadSafely(loadSeed(seedInput.value || randomSeed()));
    canvas.focus();
  });
  randomSeedButton.addEventListener("click", () => {
    void loadSafely(loadSeed(randomSeed()));
    canvas.focus();
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("mousemove", (event) => {
    if (!editor || mode !== "build") {
      return;
    }
    editor.setPointer(pointerToCanvas(canvas, event));
  });
  canvas.addEventListener("mouseleave", () => {
    if (editor) {
      editor.setPointer(null);
    }
  });
  canvas.addEventListener("mousedown", (event) => {
    canvas.focus();
    const point = pointerToCanvas(canvas, event);

    if (mode !== "build") {
      return;
    }

    editor.setPointer(point);
    if (event.button === 2) {
      editor.handleRightClick(point);
    } else if (event.button === 0) {
      editor.handleLeftClick(point);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.target === seedInput) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      toggleSimulation();
    } else if (event.key.toLowerCase() === "r") {
      resetLevel();
    } else if (event.key.toLowerCase() === "g") {
      void loadSafely(loadSeed(randomSeed()));
    } else if (event.key === "Escape") {
      if (mode === "build" && editor?.selectedNode !== null) {
        editor.cancelSelection();
      } else if (mode === "simulation") {
        paused = !paused;
      }
    } else if ((event.key === "Delete" || event.key === "Backspace") && mode === "build") {
      event.preventDefault();
      editor.deleteHovered();
    } else if (event.key.toLowerCase() === "z" && mode === "build") {
      event.preventDefault();
      editor.undo();
    }
  });
}

async function loadSafely(promise) {
  try {
    await promise;
  } catch (error) {
    console.error(error);
    setSystemMessage("LOAD FAILED");
  }
}

function loop(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  if (mode === "simulation" && simulation && !paused) {
    simulation.step(dt);
  }

  if (performance.now() > systemMessageUntil) {
    systemMessage = "";
  }

  renderer.render({
    mode,
    editor,
    simulation,
    paused,
    systemMessage,
    seed: currentSeed,
  });
  requestAnimationFrame(loop);
}

function toggleSimulation() {
  if (mode === "build") {
    simulation = new BridgeSimulation(level, editor.snapshot());
    mode = "simulation";
    paused = false;
    setSystemMessage("TEST");
    return;
  }

  mode = "build";
  simulation = null;
  paused = false;
  setSystemMessage("EDIT");
}

function resetLevel() {
  editor.reset();
  simulation = null;
  mode = "build";
  paused = false;
  setSystemMessage("RESET");
}

function levelUrl(seed) {
  const url = new URL(canvas.dataset.randomLevelUrl, window.location.href);
  url.searchParams.set("seed", seed);
  return url.toString();
}

function normalizeSeed(seed) {
  return seed.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 48) || randomSeed();
}

function randomSeed() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(10);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function setSystemMessage(message) {
  systemMessage = message;
  systemMessageUntil = performance.now() + 900;
}

function drawLoadError(error) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#24282d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e6e6e6";
  ctx.font = "18px Georgia, serif";
  ctx.fillText(error.message, 20, 32);
}
