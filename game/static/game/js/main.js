import { BridgeEditor } from "./editor.js";
import { loadLevel, loadLevelCatalog } from "./levels.js";
import { BridgeSimulation } from "./physics.js";
import { Renderer } from "./renderer.js";
import { pointerToCanvas } from "./ui.js";

const canvas = document.getElementById("game-canvas");

let level = null;
let levelCatalog = [];
let currentLevelIndex = 0;
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

async function bootstrap() {
  try {
    levelCatalog = await loadLevelCatalog(canvas.dataset.levelListUrl);
    await loadLevelFromCatalog(0);
    bindInput();
    canvas.focus();
    requestAnimationFrame(loop);
  } catch (error) {
    drawLoadError(error);
  }
}

async function loadLevelFromCatalog(index) {
  const nextIndex = (index + levelCatalog.length) % levelCatalog.length;
  const entry = levelCatalog[nextIndex];
  await loadLevelUrl(entry.url, nextIndex);
}

async function loadRandomLevel() {
  const seed = Date.now().toString(36).slice(-7);
  const url = canvas.dataset.randomLevelUrl.replace("seed", encodeURIComponent(seed));
  await loadLevelUrl(url, currentLevelIndex);
}

async function loadLevelUrl(url, catalogIndex) {
  const token = (loadToken += 1);
  setSystemMessage("LOADING");
  const loadedLevel = await loadLevel(url);

  if (token !== loadToken) {
    return;
  }

  level = loadedLevel;
  currentLevelIndex = catalogIndex;
  editor = new BridgeEditor(level);
  simulation = null;
  mode = "build";
  paused = false;

  if (renderer) {
    renderer.setLevel(level);
  } else {
    renderer = new Renderer(canvas, level);
  }

  setSystemMessage(level.procedural ? "RANDOM MAP" : level.name.toUpperCase());
}

function bindInput() {
  if (inputBound) {
    return;
  }
  inputBound = true;

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
    if (event.code === "Space") {
      event.preventDefault();
      toggleSimulation();
    } else if (event.key.toLowerCase() === "r") {
      resetLevel();
    } else if (event.key.toLowerCase() === "n") {
      void loadLevelFromCatalog(currentLevelIndex + 1);
    } else if (event.key.toLowerCase() === "p") {
      void loadLevelFromCatalog(currentLevelIndex - 1);
    } else if (event.key.toLowerCase() === "g") {
      void loadRandomLevel();
    } else if (event.key >= "1" && event.key <= "9") {
      const index = Number.parseInt(event.key, 10) - 1;
      if (index < levelCatalog.length) {
        void loadLevelFromCatalog(index);
      }
    } else if (event.key === "Escape" && mode === "simulation") {
      paused = !paused;
    }
  });
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
    levelIndex: currentLevelIndex,
    levelCount: levelCatalog.length,
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
