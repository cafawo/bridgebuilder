import {
  BLUEPRINT_VERSION,
  betterRecord,
  decodeBlueprint,
  designFromLocationHash,
  draftStorageKey,
  encodeBlueprint,
  hashForDesign,
  loadStoredJson,
  recordStorageKey,
  storeJson,
} from "./blueprint.js?v=challenge3";
import { CapacitySearch } from "./capacity.js?v=challenge3";
import { BridgeEditor } from "./editor.js?v=challenge3";
import {
  challengeSeedUrl,
  fetchLeaderboard,
  qualifyingCapacityRecord,
  qualifyingCostRecord,
  submitCapacityScore,
  submitCostScore,
} from "./leaderboard.js?v=challenge4";
import { loadLevel, normalizeSeed } from "./levels.js?v=challenge3";
import {
  BridgeSimulation,
  PHYSICS_VERSION,
  SIMULATION_DT,
} from "./physics.js?v=challenge3";
import { Renderer } from "./renderer.js?v=challenge3";
import { pointerToCanvas } from "./ui.js?v=challenge3";

const canvas = document.getElementById("game-canvas");
const seedForm = document.getElementById("seed-form");
const seedInput = document.getElementById("seed-input");
const randomSeedButton = document.getElementById("random-seed-button");
const controls = {
  mode: document.getElementById("mode-select"),
  test: document.getElementById("test-button"),
  edit: document.getElementById("edit-button"),
  pause: document.getElementById("pause-button"),
  undo: document.getElementById("undo-button"),
  redo: document.getElementById("redo-button"),
  reset: document.getElementById("reset-button"),
  delete: document.getElementById("delete-button"),
  capacity: document.getElementById("capacity-button"),
  resultPanel: document.getElementById("result-panel"),
  resultTitle: document.getElementById("result-title"),
  resultSummary: document.getElementById("result-summary"),
  retry: document.getElementById("retry-button"),
  improve: document.getElementById("improve-button"),
  newSeed: document.getElementById("new-seed-button"),
  share: document.getElementById("share-button"),
  leaderboard: document.getElementById("leaderboard-button"),
  leaderboardPanel: document.getElementById("leaderboard-panel"),
  leaderboardClose: document.getElementById("leaderboard-close-button"),
  leaderboardStatus: document.getElementById("leaderboard-status"),
  leaderboardTable: document.getElementById("leaderboard-table"),
  leaderboardBody: document.getElementById("leaderboard-body"),
  leaderboardUpdated: document.getElementById("leaderboard-updated"),
  capacityProgress: document.getElementById("capacity-progress"),
  capacityProgressBar: document.getElementById("capacity-progress-bar"),
  capacityProgressLabel: document.getElementById("capacity-progress-label"),
  liveStatus: document.getElementById("live-status"),
  speeds: [...document.querySelectorAll("[data-speed]")],
};

let level = null;
let currentSeed = "";
let editor = null;
let renderer = null;
let simulation = null;
let mode = "build";
let gameMode = modeFromLocation();
let paused = false;
let simulationSpeed = 1;
let testLoad = 0;
let lastTestLoad = 0;
let lastTestCost = 0;
let lastTestGraph = null;
let lastTestCode = "";
let handledSimulation = null;
let capacitySearch = null;
let capacitySnapshot = null;
let capacityTestCost = 0;
let basePassedCode = "";
let bestRecord = null;
let systemMessage = "";
let systemMessageUntil = 0;
let lastFrame = performance.now();
let accumulator = 0;
let inputBound = false;
let loadToken = 0;
let draftTimer = null;
let lastResultKind = "test";
let leaderboardData = null;
let leaderboardLoading = false;
let leaderboardReturnFocus = null;

bootstrap();

window.bridgebuilderDebug = {
  state: () => ({
    mode,
    gameMode,
    paused,
    simulationSpeed,
    selectedNode: editor?.selectedNode ?? null,
    help: editor?.helpText() ?? null,
    seed: currentSeed,
    nodeCount: editor?.nodes.length ?? 0,
    beamCount: editor?.beams.length ?? 0,
    cost: editor?.totalCost() ?? 0,
    costTarget: level?.budget ?? null,
    overTarget: editor?.overTargetAmount() ?? 0,
    canUndo: editorCanUndo(),
    canRedo: editorCanRedo(),
    generator: level?.generator?.name ?? null,
    generatorVersion: level?.generator?.version ?? null,
    physicsVersion: PHYSICS_VERSION,
    archetype: level?.challenge?.archetype ?? null,
    ratedLoad: level?.challenge?.ratedLoad ?? null,
    simulation: simulationTelemetry(),
    capacity: capacityState(),
    bestRecord,
  }),
  snapshot: () => editor?.snapshot() ?? null,
  startTest: (load) => startTest(load),
  edit: () => returnToEdit(),
};

async function bootstrap() {
  try {
    bindInput();
    await loadSeed(seedFromLocation() || randomSeed(), { allowSharedDesign: true });
    document.body.dataset.appReady = "true";
    canvas.focus();
    requestAnimationFrame(loop);
  } catch (error) {
    document.body.dataset.appReady = "false";
    document.body.dataset.appError = error.message;
    drawLoadError(error);
  }
}

async function loadSeed(seed, options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const token = (loadToken += 1);
  cancelCapacity();
  flushDraft();
  setSystemMessage("SURVEYING SITE");
  seedInput.value = normalizedSeed;
  const loadedLevel = loadLevel(normalizedSeed);

  if (token !== loadToken) {
    return;
  }

  currentSeed = loadedLevel.seed || normalizedSeed;
  seedInput.value = currentSeed;
  updateSeedInLocation({
    seed: currentSeed,
    clearDesign: !options.allowSharedDesign,
  });
  level = loadedLevel;
  editor = new BridgeEditor(level);
  simulation = null;
  mode = "build";
  paused = false;
  accumulator = 0;
  handledSimulation = null;
  basePassedCode = "";
  const storedRecord = loadStoredJson(recordStorageKey(level));
  bestRecord = validStoredRecord(storedRecord) ? storedRecord : null;

  if (renderer) {
    renderer.setLevel(level);
  } else {
    renderer = new Renderer(canvas, level);
  }

  const sharedDesign = options.allowSharedDesign ? designFromLocationHash() : "";
  if (sharedDesign) {
    restoreEncodedDesign(sharedDesign, "Shared bridge loaded");
  } else {
    const draft = loadStoredJson(draftStorageKey(level, gameMode));
    if (draft?.design) {
      restoreEncodedDesign(draft.design, "Draft restored", false);
    }
  }

  const currentCode = safeDesignCode();
  if (
    bestRecord?.design === currentCode &&
    bestRecord.maxLoad >= level.challenge.ratedLoad
  ) {
    basePassedCode = currentCode;
  }

  hideResult();
  systemMessage = "";
  systemMessageUntil = 0;
  announce(
    `${level.name}. ${level.challenge.archetypeLabel}. Rated load ${formatNumber(
      level.challenge.ratedLoad,
    )}. Cost target ${formatNumber(level.budget)}.`,
  );
  updateControls();
}

function restoreEncodedDesign(encoded, message, announceErrors = true) {
  try {
    const snapshot = decodeBlueprint(level, encoded);
    if (!editor.restore(snapshot)) {
      throw new Error("Shared bridge is not valid for this site");
    }
    setSystemMessage(message.toUpperCase());
  } catch (error) {
    editor = new BridgeEditor(level);
    if (announceErrors) {
      setSystemMessage("SHARED BRIDGE REJECTED");
      announce(error.message);
    }
  }
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
  randomSeedButton.addEventListener("click", () => loadRandomSeed());
  controls.newSeed?.addEventListener("click", () => loadRandomSeed());

  controls.mode?.addEventListener("change", () => {
    const nextMode = controls.mode.value === "sandbox" ? "sandbox" : "challenge";
    if (nextMode === gameMode) {
      return;
    }
    flushDraft();
    gameMode = nextMode;
    basePassedCode = "";
    updateSeedInLocation({ seed: currentSeed, clearDesign: true });
    const draft = loadStoredJson(draftStorageKey(level, gameMode));
    if (draft?.design) {
      restoreEncodedDesign(draft.design, `${gameMode} draft restored`, false);
    }
    const currentCode = safeDesignCode();
    if (
      gameMode === "challenge" &&
      bestRecord?.design === currentCode &&
      bestRecord.maxLoad >= level.challenge.ratedLoad
    ) {
      basePassedCode = currentCode;
    }
    hideResult();
    scheduleDraftSave();
    updateControls();
    setSystemMessage(gameMode === "challenge" ? "CHALLENGE MODE" : "SANDBOX MODE");
    announce(
      gameMode === "challenge"
        ? "Challenge mode. Soft cost target and certified records enabled."
        : "Sandbox mode. Cost target is informational and records are disabled.",
    );
  });
  controls.test?.addEventListener("click", () => startTest());
  controls.edit?.addEventListener("click", () => returnToEdit());
  controls.pause?.addEventListener("click", () => togglePause());
  controls.undo?.addEventListener("click", () => mutateEditor(() => editor.undo()));
  controls.redo?.addEventListener("click", () => mutateEditor(() => editor.redo()));
  controls.reset?.addEventListener("click", () => {
    mutateEditor(() => editor.reset());
  });
  controls.delete?.addEventListener("click", () => {
    mutateEditor(() => editor.deleteSelectionOrHovered());
  });
  controls.capacity?.addEventListener("click", () => {
    if (capacitySearch) {
      cancelCapacity();
    } else {
      startCapacityTest();
    }
  });
  controls.retry?.addEventListener("click", () => {
    hideResult();
    if (lastResultKind === "capacity") {
      startCapacityTest();
    } else {
      startTest(lastTestLoad || testLoad);
    }
  });
  controls.improve?.addEventListener("click", () => returnToEdit());
  controls.share?.addEventListener("click", () => void shareCurrentDesign());
  controls.leaderboard?.addEventListener("click", () => openLeaderboard());
  controls.leaderboardClose?.addEventListener("click", () => closeLeaderboard());
  controls.leaderboardPanel?.addEventListener("click", (event) => {
    if (event.target === controls.leaderboardPanel) {
      closeLeaderboard();
    }
  });
  controls.leaderboardPanel?.addEventListener("keydown", trapLeaderboardFocus);
  controls.leaderboardBody?.addEventListener("click", (event) => {
    const row = event.target.closest(".leaderboard-row");
    if (row && !event.target.closest("a")) {
      window.location.assign(row.dataset.href);
    }
  });
  controls.leaderboardBody?.addEventListener("keydown", (event) => {
    const row = event.target.closest(".leaderboard-row");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      window.location.assign(row.dataset.href);
    }
  });
  for (const button of controls.speeds) {
    button.addEventListener("click", () => {
      const requested = Number(button.dataset.speed);
      if ([1, 2, 4].includes(requested)) {
        simulationSpeed = requested;
        updateControls();
        announce(`Simulation speed ${requested} times`);
      }
    });
  }

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointermove", (event) => {
    if (!editor || mode !== "build" || capacitySearch) {
      return;
    }
    editor.setPointer(pointerToCanvas(canvas, event));
  });
  canvas.addEventListener("pointerleave", (event) => {
    if (editor && event.pointerType === "mouse") {
      editor.setPointer(null);
    }
  });
  canvas.addEventListener("pointerdown", (event) => {
    canvas.focus();
    if (!editor || mode !== "build" || capacitySearch) {
      return;
    }

    event.preventDefault();
    const point = pointerToCanvas(canvas, event);
    editor.setPointer(point);
    mutateEditor(() => {
      if (event.button === 2) {
        editor.handleRightClick(point);
      } else if (event.button === 0) {
        editor.handleLeftClick(point);
      }
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isLeaderboardOpen()) {
      event.preventDefault();
      closeLeaderboard();
      return;
    }
    if (isFormControl(event.target)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (mode === "build") {
        startTest();
      } else if (simulation?.status === "running") {
        togglePause();
      } else {
        returnToEdit();
      }
    } else if (event.key.toLowerCase() === "r" && mode === "build") {
      mutateEditor(() => editor.reset());
    } else if (event.key.toLowerCase() === "g") {
      loadRandomSeed();
    } else if (event.key === "Escape") {
      if (capacitySearch) {
        cancelCapacity();
      } else if (mode === "build" && editor?.selectedNode !== null) {
        editor.cancelSelection();
      } else if (mode === "simulation" && simulation?.status === "running") {
        togglePause();
      } else if (mode === "simulation") {
        returnToEdit();
      }
    } else if ((event.key === "Delete" || event.key === "Backspace") && mode === "build") {
      event.preventDefault();
      mutateEditor(() => editor.deleteHovered());
    } else if (
      (event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)) &&
      mode === "build"
    ) {
      event.preventDefault();
      mutateEditor(() => editor.redo());
    } else if (event.key.toLowerCase() === "z" && mode === "build") {
      event.preventDefault();
      mutateEditor(() => editor.undo());
    }
  });

  window.addEventListener("beforeunload", () => flushDraft());
}

async function loadSafely(promise) {
  try {
    await promise;
  } catch (error) {
    console.error(error);
    setSystemMessage("LOAD FAILED");
    announce(error.message);
  }
}

function loop(now) {
  const elapsed = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  if (mode === "simulation" && simulation && !paused && simulation.status === "running") {
    accumulator += elapsed * simulationSpeed;
    let steps = 0;
    while (accumulator >= SIMULATION_DT && simulation.status === "running" && steps < 480) {
      simulation.tick();
      accumulator -= SIMULATION_DT;
      steps += 1;
    }
  }

  if (simulation && simulation.status !== "running" && handledSimulation !== simulation) {
    handledSimulation = simulation;
    completeSimulation();
  }

  if (capacitySearch) {
    advanceCapacity();
  }

  if (performance.now() > systemMessageUntil) {
    systemMessage = "";
  }

  renderer.render({
    mode,
    gameMode,
    editor,
    simulation,
    paused,
    simulationSpeed,
    systemMessage,
    seed: currentSeed,
    testLoad,
    bestRecord,
    capacity: capacityState(),
    now,
  });
  requestAnimationFrame(loop);
}

function startTest(requestedLoad = level?.challenge?.ratedLoad) {
  if (!level || !editor || capacitySearch) {
    return false;
  }
  if (editor.beams.length === 0) {
    setSystemMessage("BUILD A BRIDGE");
    announce("Build at least one beam before testing.");
    return false;
  }

  hideResult();
  lastTestGraph = editor.snapshot();
  lastTestCode = safeDesignCode();
  lastTestCost = Math.round(editor.totalCost());
  testLoad = Math.max(50, Number(requestedLoad) || level.challenge.ratedLoad);
  lastTestLoad = testLoad;
  simulation = new BridgeSimulation(level, lastTestGraph, { load: testLoad });
  mode = "simulation";
  paused = false;
  accumulator = 0;
  handledSimulation = null;
  setSystemMessage("LOAD TEST");
  announce(`Testing load ${formatNumber(testLoad)}.`);
  updateControls();
  return true;
}

function completeSimulation() {
  const telemetry = simulationTelemetry();
  if (!telemetry) {
    return;
  }

  const won = telemetry.status === "won";
  const title = won ? "Bridge certified" : "Test failed";
  const tier = won ? loadTier(testLoad) : null;
  const firstFailure = telemetry.firstFailure;
  const failureDetail =
    !won && firstFailure
      ? ` First failure: ${firstFailure.cause} near (${Math.round(
          firstFailure.x,
        )}, ${Math.round(firstFailure.y)}).`
      : "";
  const costSummary = costTargetSummary(lastTestCost);
  const summary = won
    ? `${formatNumber(testLoad)} crossed safely. Peak utilization ${formatPercent(
        telemetry.peakUtilization,
      )}; ${telemetry.brokenCount ?? 0} broken beams.${
        tier ? ` ${tier.label} earned.` : ""
      } ${costSummary}`
    : `${telemetry.reason || "Bridge failed"} at ${formatNumber(
        testLoad,
      )}. Peak utilization ${formatPercent(
        telemetry.peakUtilization,
      )}.${failureDetail} ${costSummary}`;

  lastResultKind = "test";
  showResult(title, summary, won);
  announce(`${title}. ${summary}`);

  if (won && testLoad >= level.challenge.ratedLoad) {
    basePassedCode = lastTestCode;
    if (gameMode === "challenge") {
      saveBestRecord(testLoad, lastTestCode, telemetry);
    }
  }
  const costRecord = qualifyingCostRecord({
    gameMode,
    won,
    testLoad,
    requiredLoad: level.challenge.ratedLoad,
    cost: lastTestCost,
    maximumCost: level.budget,
    seed: currentSeed,
    generatorVersion: level.generator.version,
    physicsVersion: PHYSICS_VERSION,
  });
  if (costRecord) {
    submitCostScore(costRecord);
  }
  updateControls();
}

function returnToEdit() {
  cancelCapacity();
  mode = "build";
  simulation = null;
  paused = false;
  accumulator = 0;
  handledSimulation = null;
  hideResult();
  setSystemMessage("EDIT");
  canvas.focus();
  updateControls();
}

function togglePause() {
  if (mode !== "simulation" || !simulation || simulation.status !== "running") {
    return;
  }
  paused = !paused;
  announce(paused ? "Simulation paused" : "Simulation resumed");
  updateControls();
}

function startCapacityTest() {
  if (!level || !editor || mode !== "build") {
    return;
  }

  const design = safeDesignCode();
  if (!design || design !== basePassedCode) {
    setSystemMessage("PASS RATED LOAD FIRST");
    announce("Pass the rated load with this unchanged bridge before certifying capacity.");
    return;
  }

  capacitySnapshot = editor.snapshot();
  capacityTestCost = Math.round(editor.totalCost());
  capacitySearch = new CapacitySearch(level, capacitySnapshot, {
    startLoad: level.challenge.ratedLoad,
    resolution: 50,
    maxLoad: level.challenge.ratedLoad * 64,
  });
  hideResult();
  setSystemMessage("CAPACITY TEST");
  announce("Capacity certification started.");
  updateControls();
}

function advanceCapacity() {
  let state;
  try {
    state = capacitySearch.advance(7);
  } catch (error) {
    console.error(error);
    cancelCapacity();
    lastResultKind = "capacity";
    showResult("Capacity test failed", error.message, false);
    announce(error.message);
    return;
  }

  updateCapacityProgress(state);
  if (!state.done) {
    return;
  }

  const result = state.result;
  const design = safeDesignCode();
  const certifiedCost = capacityTestCost;
  capacitySearch = null;
  capacitySnapshot = null;
  capacityTestCost = 0;
  updateCapacityProgress(null);

  if (!result || result.cancelled) {
    setSystemMessage("CAPACITY CANCELLED");
    updateControls();
    return;
  }

  const maxLoad = result.maxLoad;
  const failingLoad = result.failingLoad;
  const passTelemetry = result.passResult;
  if (
    result.certified !== true ||
    result.error ||
    !result.passResult ||
    maxLoad < level.challenge.ratedLoad
  ) {
    const message =
      result.error ||
      `The rated load could not be reverified; ${formatNumber(
        failingLoad ?? level.challenge.ratedLoad,
      )} failed.`;
    lastResultKind = "capacity";
    showResult("Capacity not certified", message, false);
    announce(message);
    updateControls();
    return;
  }
  const tier = loadTier(maxLoad);
  if (gameMode === "challenge") {
    saveBestRecord(maxLoad, design, passTelemetry);
  }
  const capacityRecord = qualifyingCapacityRecord({
    gameMode,
    certified: true,
    maxLoad,
    requiredLoad: level.challenge.ratedLoad,
    cost: certifiedCost,
    maximumCost: level.budget,
    seed: currentSeed,
    generatorVersion: level.generator.version,
    physicsVersion: PHYSICS_VERSION,
  });
  if (capacityRecord) {
    submitCapacityScore(capacityRecord);
  }
  const boundary = result.capReached || failingLoad == null
    ? `${formatNumber(maxLoad)} passed; the 64× search cap was reached.`
    : `${formatNumber(maxLoad)} passed; ${formatNumber(failingLoad)} failed.`;
  lastResultKind = "capacity";
  showResult(
    "Capacity certified",
    `${boundary}${tier ? ` ${tier.label} earned.` : ""} ` +
      `${costTargetSummary()} Lower cost breaks equal-load ties. ` +
      `Damage: ${passTelemetry.brokenCount ?? 0} broken beams.`,
    true,
  );
  announce(`Maximum certified load ${formatNumber(maxLoad)}.`);
  updateControls();
}

function cancelCapacity() {
  if (capacitySearch) {
    capacitySearch.cancel();
  }
  capacitySearch = null;
  capacitySnapshot = null;
  capacityTestCost = 0;
  updateCapacityProgress(null);
  updateControls();
}

function saveBestRecord(maxLoad, design, telemetry) {
  const candidate = {
    version: BLUEPRINT_VERSION,
    seed: currentSeed,
    fingerprint: level.challenge.fingerprint,
    generatorVersion: level.generator.version,
    physicsVersion: PHYSICS_VERSION,
    maxLoad: Math.round(maxLoad),
    cost: Math.round(editor.totalCost()),
    tier: loadTier(maxLoad)?.multiplier ?? 0,
    brokenCount: telemetry?.brokenCount ?? 0,
    design,
    savedAt: new Date().toISOString(),
  };
  if (betterRecord(candidate, bestRecord)) {
    bestRecord = candidate;
    const stored = storeJson(recordStorageKey(level), candidate);
    setSystemMessage(stored ? "NEW PERSONAL BEST" : "BEST NOT SAVED");
    if (!stored) {
      announce("Personal best achieved, but browser storage is unavailable.");
    }
  }
}

async function shareCurrentDesign() {
  if (!level || !editor) {
    return;
  }
  try {
    const encoded = encodeBlueprint(level, editor.snapshot());
    const url = new URL(window.location.href);
    url.searchParams.set("seed", currentSeed);
    if (gameMode === "sandbox") {
      url.searchParams.set("mode", "sandbox");
    } else {
      url.searchParams.delete("mode");
    }
    url.hash = hashForDesign(encoded);
    const shareUrl = url.toString();
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setSystemMessage("LINK COPIED");
        announce("Replayable bridge link copied.");
        return;
      } catch (clipboardError) {
        console.warn("Clipboard unavailable; showing the replay link.", clipboardError);
      }
    }
    window.prompt("Copy this replayable bridge link", shareUrl);
    setSystemMessage("COPY LINK");
    announce("Replayable bridge link ready to copy.");
  } catch (error) {
    setSystemMessage("SHARE FAILED");
    announce(error.message);
  }
}

function mutateEditor(action) {
  if (!editor || mode !== "build" || capacitySearch) {
    return;
  }
  const before = safeDesignCode();
  action();
  const after = safeDesignCode();
  const feedback = editor.currentMessage?.();
  if (feedback) {
    announce(feedback);
  }
  if (before !== after) {
    onDesignChanged();
  } else {
    updateControls();
  }
}

function onDesignChanged() {
  basePassedCode = "";
  cancelCapacity();
  hideResult();
  if (window.location.hash) {
    updateSeedInLocation({ seed: currentSeed, clearDesign: true });
  }
  scheduleDraftSave();
  updateControls();
}

function scheduleDraftSave() {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
  }
  draftTimer = window.setTimeout(() => {
    draftTimer = null;
    saveDraft();
  }, 180);
}

function flushDraft() {
  if (draftTimer !== null) {
    clearTimeout(draftTimer);
    draftTimer = null;
  }
  saveDraft();
}

function saveDraft() {
  if (!level || !editor) {
    return;
  }
  const design = safeDesignCode();
  if (design) {
    storeJson(draftStorageKey(level, gameMode), {
      version: BLUEPRINT_VERSION,
      design,
      savedAt: new Date().toISOString(),
    });
  }
}

function safeDesignCode() {
  try {
    return level && editor ? encodeBlueprint(level, editor.snapshot()) : "";
  } catch {
    return "";
  }
}

function validStoredRecord(record) {
  if (
    !record ||
    record.version !== BLUEPRINT_VERSION ||
    record.seed !== currentSeed ||
    record.fingerprint !== level.challenge.fingerprint ||
    record.generatorVersion !== level.generator.version ||
    record.physicsVersion !== PHYSICS_VERSION ||
    !Number.isFinite(record.maxLoad) ||
    record.maxLoad < level.challenge.ratedLoad ||
    !Number.isFinite(record.cost) ||
    record.cost < 0 ||
    typeof record.design !== "string"
  ) {
    return false;
  }
  try {
    const snapshot = decodeBlueprint(level, record.design);
    const validation = editor.validateSnapshot(snapshot);
    return validation.valid && Math.round(validation.cost) === Math.round(record.cost);
  } catch {
    return false;
  }
}

function updateControls() {
  const building = mode === "build";
  const running = mode === "simulation" && simulation?.status === "running";
  const searching = Boolean(capacitySearch);
  const design = safeDesignCode();

  if (controls.mode) {
    controls.mode.value = gameMode;
    controls.mode.disabled = !building || searching;
  }
  setDisabled(controls.test, !building || searching);
  setDisabled(controls.edit, building);
  setDisabled(controls.pause, !running);
  setDisabled(controls.undo, !building || searching || !editorCanUndo());
  setDisabled(controls.redo, !building || searching || !editorCanRedo());
  const hasStructure = editor?.hasUserStructure() ?? false;
  setDisabled(controls.reset, !building || searching || !hasStructure);
  setDisabled(controls.delete, !building || searching);
  setDisabled(
    controls.capacity,
    !building || (!searching && (!design || design !== basePassedCode)),
  );
  if (controls.capacity) {
    controls.capacity.textContent = searching ? "Cancel Capacity" : "Capacity Test";
  }
  for (const button of controls.speeds) {
    button.disabled = !running;
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === simulationSpeed));
  }
  if (controls.pause) {
    controls.pause.textContent = paused ? "Resume" : "Pause";
    controls.pause.setAttribute("aria-pressed", String(paused));
  }
  if (controls.test) {
    controls.test.setAttribute("aria-pressed", String(!building));
  }
  if (controls.edit) {
    controls.edit.setAttribute("aria-pressed", String(building));
  }
}

function updateCapacityProgress(state) {
  if (!controls.capacityProgress) {
    return;
  }
  if (!capacitySearch && !state) {
    controls.capacityProgress.hidden = true;
    if (controls.capacityProgressBar) {
      controls.capacityProgressBar.value = 0;
    }
    if (controls.capacityProgressLabel) {
      controls.capacityProgressLabel.textContent = "";
    }
    return;
  }

  const progress = state?.progress ?? capacitySearch?.progress;
  const progressValue =
    typeof progress === "number"
      ? progress
      : Number(progress?.trialProgress ?? 0);
  let text = "Certifying capacity…";
  if (typeof progress === "number") {
    text = `Certifying capacity… ${Math.round(progress * 100)}%`;
  } else if (progress?.candidateLoad) {
    text = `Testing ${formatNumber(progress.candidateLoad)}…`;
  } else if (typeof progress === "string") {
    text = progress;
  }
  controls.capacityProgress.hidden = false;
  if (controls.capacityProgressBar) {
    controls.capacityProgressBar.value =
      Math.max(0, Math.min(1, progressValue));
  }
  if (controls.capacityProgressLabel) {
    controls.capacityProgressLabel.textContent = text;
  }
}

function costTargetSummary(cost = editor?.totalCost() ?? 0) {
  const roundedCost = Math.round(Number(cost) || 0);
  const target = Math.round(Number(level?.budget) || 0);
  const delta = roundedCost - target;
  if (delta > 0) {
    return `Cost ${formatNumber(roundedCost)}; ${formatNumber(delta)} over target ${formatNumber(
      target,
    )}.`;
  }
  if (delta < 0) {
    return `Cost ${formatNumber(roundedCost)}; ${formatNumber(-delta)} under target ${formatNumber(
      target,
    )}.`;
  }
  return `Cost ${formatNumber(roundedCost)}; exactly on target ${formatNumber(target)}.`;
}

function showResult(title, summary, success = null) {
  if (controls.resultTitle) {
    controls.resultTitle.textContent = title;
  }
  if (controls.resultSummary) {
    controls.resultSummary.textContent = summary;
  }
  if (controls.resultPanel) {
    controls.resultPanel.dataset.outcome =
      success === true ? "success" : success === false ? "failure" : "";
    controls.resultPanel.hidden = false;
    controls.resultPanel.focus({ preventScroll: true });
  }
}

function hideResult() {
  if (controls.resultPanel) {
    controls.resultPanel.hidden = true;
    delete controls.resultPanel.dataset.outcome;
  }
}

function openLeaderboard() {
  if (!controls.leaderboardPanel) {
    return;
  }
  leaderboardReturnFocus = document.activeElement;
  controls.leaderboardPanel.hidden = false;
  controls.leaderboardClose?.focus({ preventScroll: true });
  if (leaderboardData) {
    renderLeaderboard(leaderboardData);
  } else if (!leaderboardLoading) {
    void loadLeaderboard();
  }
}

function closeLeaderboard() {
  if (!controls.leaderboardPanel || controls.leaderboardPanel.hidden) {
    return;
  }
  controls.leaderboardPanel.hidden = true;
  if (leaderboardReturnFocus instanceof HTMLElement) {
    leaderboardReturnFocus.focus({ preventScroll: true });
  }
  leaderboardReturnFocus = null;
}

async function loadLeaderboard() {
  leaderboardLoading = true;
  setLeaderboardState("Loading leaderboard…");
  try {
    const data = await fetchLeaderboard({
      generatorVersion: level.generator.version,
      physicsVersion: PHYSICS_VERSION,
    });
    leaderboardData = data;
    renderLeaderboard(data);
  } catch (error) {
    console.warn("Leaderboard unavailable.", error);
    setLeaderboardState("Leaderboard unavailable");
  } finally {
    leaderboardLoading = false;
  }
}

function renderLeaderboard(data) {
  if (
    !controls.leaderboardBody ||
    !controls.leaderboardTable ||
    !controls.leaderboardStatus
  ) {
    return;
  }
  controls.leaderboardBody.replaceChildren();
  if (data.entries.length === 0) {
    setLeaderboardState("No scores yet");
  } else {
    for (const entry of data.entries) {
      const destination = challengeSeedUrl(entry.seed);
      const row = document.createElement("tr");
      row.className = "leaderboard-row";
      row.tabIndex = 0;
      row.dataset.href = destination;
      row.setAttribute(
        "aria-label",
        `Open seed ${entry.seed}, best cost ${formatNumber(entry.cost)}, ` +
          `highest load ${formatOptionalNumber(entry.highestLoad)}, ` +
          `load per dollar ${formatLoadPerCost(entry.loadPerCost)}`,
      );

      const seedCell = document.createElement("td");
      const seedLink = document.createElement("a");
      seedLink.href = destination;
      seedLink.textContent = entry.seed;
      seedCell.append(seedLink);

      const costCell = document.createElement("td");
      costCell.textContent = formatNumber(entry.cost);

      const loadCell = document.createElement("td");
      loadCell.textContent = formatOptionalNumber(entry.highestLoad);

      const efficiencyCell = document.createElement("td");
      efficiencyCell.textContent = formatLoadPerCost(entry.loadPerCost);

      row.append(seedCell, costCell, loadCell, efficiencyCell);
      controls.leaderboardBody.append(row);
    }
    controls.leaderboardStatus.textContent = "";
    controls.leaderboardTable.hidden = false;
  }
  if (controls.leaderboardUpdated) {
    controls.leaderboardUpdated.textContent = data.generatedAt
      ? `Updated ${formatLeaderboardDate(data.generatedAt)}`
      : "Waiting for the first daily update";
  }
}

function setLeaderboardState(message) {
  if (controls.leaderboardStatus) {
    controls.leaderboardStatus.textContent = message;
  }
  if (controls.leaderboardTable) {
    controls.leaderboardTable.hidden = true;
  }
  if (controls.leaderboardUpdated) {
    controls.leaderboardUpdated.textContent = "";
  }
}

function isLeaderboardOpen() {
  return Boolean(controls.leaderboardPanel && !controls.leaderboardPanel.hidden);
}

function trapLeaderboardFocus(event) {
  if (event.key !== "Tab" || !isLeaderboardOpen()) {
    return;
  }
  const focusable = [
    ...controls.leaderboardPanel.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.hidden);
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (focusable.length === 1 || (event.shiftKey && document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function formatLeaderboardDate(value) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function simulationTelemetry() {
  return simulation?.result() ?? null;
}

function capacityState() {
  if (!capacitySearch) {
    return null;
  }
  return {
    active: true,
    progress: capacitySearch.progress,
    candidateLoad: capacitySearch.candidateLoad,
  };
}

function editorCanUndo() {
  return editor?.canUndo() ?? false;
}

function editorCanRedo() {
  return editor?.canRedo() ?? false;
}

function setDisabled(control, disabled) {
  if (control) {
    control.disabled = Boolean(disabled);
  }
}

function isFormControl(target) {
  return target instanceof Element && Boolean(target.closest("input, button, select, textarea"));
}

function loadRandomSeed() {
  void loadSafely(loadSeed(randomSeed()));
  canvas.focus();
}

function seedFromLocation() {
  return new URLSearchParams(window.location.search).get("seed") || "";
}

function modeFromLocation() {
  return new URLSearchParams(window.location.search).get("mode") === "sandbox"
    ? "sandbox"
    : "challenge";
}

function updateSeedInLocation({ seed, clearDesign = false }) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  if (gameMode === "sandbox") {
    url.searchParams.set("mode", "sandbox");
  } else {
    url.searchParams.delete("mode");
  }
  if (clearDesign) {
    url.hash = "";
  }
  window.history.replaceState(null, "", url);
}

function randomSeed() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(10);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function setSystemMessage(message) {
  systemMessage = message;
  systemMessageUntil = performance.now() + 1400;
}

function announce(message) {
  if (!controls.liveStatus) {
    return;
  }
  controls.liveStatus.textContent = "";
  window.setTimeout(() => {
    controls.liveStatus.textContent = message;
  }, 20);
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function formatOptionalNumber(value) {
  return value === null ? "—" : formatNumber(value);
}

function formatLoadPerCost(value) {
  return value === null
    ? "—"
    : Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function loadTier(load) {
  const ratedLoad = level.challenge.ratedLoad;
  const multipliers = level.challenge.tiers.filter(
    (multiplier) => load + 0.001 >= ratedLoad * multiplier,
  );
  const multiplier = multipliers.at(-1);
  return multiplier
    ? { multiplier, label: `${Number(multiplier.toFixed(2))}× load tier` }
    : null;
}

function drawLoadError(error) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#24282d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#e6e6e6";
  ctx.font = "18px Georgia, serif";
  ctx.fillText(error.message, 20, 32);
  announce(error.message);
}
