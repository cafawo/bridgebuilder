import {
  BridgeSimulation,
  PHYSICS_VERSION,
  SIMULATION_DT,
} from "./physics.js?v=challenge2";

export const GENERATOR_VERSION = "2.0.0";

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 700;
const CHALLENGE_TIERS = Object.freeze([1, 1.5, 2]);
const COSTS = Object.freeze({ node: 90, beamPerPixel: 1 });
const MECHANICS_CACHE_LIMIT = 128;
const mechanicsCache = new Map();

const MATERIAL_PHYSICS = Object.freeze({
  version: PHYSICS_VERSION,
  gravity: 900,
  damping: 0.991,
  constraintIterations: 24,
  beamStiffness: 0.82,
  beamBreakStress: 0.114,
  beamAxialCapacity: 18500,
  beamCompressionCapacity: 15200,
  beamBendingCapacity: 3100000,
  beamSelfWeightCapacity: 18500000,
  deckStrengthFactor: 0.92,
  supportStrengthFactor: 1.08,
  longBeamWeakening: 0.00036,
  nodeBaseMass: 0.7,
  nodeMassPerBeamPixel: 0.004,
});

const BASE_PALETTE = Object.freeze({
  sky: "#20262b",
  grid: "rgba(205, 215, 220, 0.075)",
  gridMajor: "rgba(205, 215, 220, 0.13)",
  rock: "#303335",
  rockEdge: "#4a4e50",
  water: "#11106d",
  waterHighlight: "rgba(114, 145, 207, 0.34)",
  road: "#77736b",
  vegetation: "#8a8e4d",
  backdropNear: "rgba(66, 73, 74, 0.40)",
  backdropFar: "rgba(66, 73, 74, 0.23)",
  stressSafe: "#7fc58a",
  stressWarning: "#efc75e",
  stressHigh: "#e18a35",
  stressCritical: "#e56d67",
});

function palette(overrides) {
  return Object.freeze({ ...BASE_PALETTE, ...overrides });
}

const REGIMES = [
  {
    id: "riverlands",
    names: ["Riverland Crossing", "Lowland River", "Wide River Bend"],
    weight: 17,
    backdrop: "hills",
    backdropLayers: 2,
    reeds: [5, 13],
    waterMotion: [0.34, 0.48],
    palette: palette({
      sky: "#202a2c",
      rock: "#343838",
      rockEdge: "#555b57",
      water: "#18266c",
      waterHighlight: "rgba(128, 162, 207, 0.34)",
      vegetation: "#92965a",
      backdropNear: "rgba(69, 88, 82, 0.40)",
      backdropFar: "rgba(62, 81, 78, 0.23)",
    }),
  },
  {
    id: "marshland",
    names: ["Marsh Causeway", "Reed Flats", "Fenland Cut"],
    weight: 13,
    backdrop: "flats",
    backdropLayers: 1,
    reeds: [18, 34],
    waterMotion: [0.2, 0.34],
    palette: palette({
      sky: "#272b29",
      rock: "#393b35",
      rockEdge: "#575a4d",
      water: "#253b55",
      waterHighlight: "rgba(151, 174, 164, 0.27)",
      road: "#827d6d",
      vegetation: "#999762",
      backdropNear: "rgba(80, 91, 77, 0.36)",
      backdropFar: "rgba(78, 88, 76, 0.20)",
    }),
  },
  {
    id: "swampland",
    names: ["Swamp Crossing", "Blackwater Swamp", "Sinking Flats"],
    weight: 10,
    backdrop: "flats",
    backdropLayers: 2,
    reeds: [25, 46],
    waterMotion: [0.16, 0.28],
    palette: palette({
      sky: "#202523",
      grid: "rgba(205, 215, 205, 0.065)",
      rock: "#30352f",
      rockEdge: "#4b5548",
      water: "#172f35",
      waterHighlight: "rgba(115, 159, 146, 0.25)",
      vegetation: "#777f49",
      backdropNear: "rgba(54, 73, 61, 0.43)",
      backdropFar: "rgba(48, 65, 56, 0.24)",
    }),
  },
  {
    id: "highlands",
    names: ["Highland Cut", "Mountain Valley", "Broken Uplands"],
    weight: 19,
    backdrop: "mountains",
    backdropLayers: 2,
    reeds: [0, 5],
    waterMotion: [0.45, 0.62],
    palette: palette({
      sky: "#22282d",
      rock: "#34373a",
      rockEdge: "#555c61",
      water: "#162461",
      waterHighlight: "rgba(139, 166, 215, 0.35)",
      vegetation: "#7f8655",
      backdropNear: "rgba(72, 80, 88, 0.43)",
      backdropFar: "rgba(66, 74, 81, 0.24)",
    }),
  },
  {
    id: "alpine_gorge",
    names: ["Alpine Gorge", "Deep Mountain Pass", "Blackwater Gorge"],
    weight: 16,
    backdrop: "peaks",
    backdropLayers: 3,
    reeds: [0, 2],
    waterMotion: [0.54, 0.76],
    palette: palette({
      sky: "#1e252b",
      rock: "#30363b",
      rockEdge: "#56616a",
      water: "#152667",
      waterHighlight: "rgba(157, 187, 228, 0.38)",
      road: "#747778",
      vegetation: "#77805d",
      backdropNear: "rgba(71, 84, 96, 0.46)",
      backdropFar: "rgba(62, 74, 85, 0.25)",
    }),
  },
  {
    id: "split_valley",
    names: ["Twin Valley", "Double Basin", "Forked River Gorge"],
    weight: 15,
    backdrop: "mountains",
    backdropLayers: 2,
    reeds: [2, 8],
    waterMotion: [0.4, 0.58],
    palette: palette({
      sky: "#23272d",
      rock: "#34353c",
      rockEdge: "#545866",
      water: "#242064",
      waterHighlight: "rgba(148, 151, 211, 0.34)",
      vegetation: "#88825a",
      backdropNear: "rgba(77, 75, 91, 0.42)",
      backdropFar: "rgba(67, 67, 82, 0.24)",
    }),
  },
  {
    id: "canyon",
    names: ["Knife Edge Canyon", "Dry Canyon River", "Sawtooth Ravine"],
    weight: 12,
    backdrop: "ridges",
    backdropLayers: 3,
    reeds: [0, 1],
    waterMotion: [0.48, 0.66],
    palette: palette({
      sky: "#292421",
      grid: "rgba(226, 207, 190, 0.07)",
      gridMajor: "rgba(226, 207, 190, 0.12)",
      rock: "#403732",
      rockEdge: "#6a584e",
      water: "#26366d",
      waterHighlight: "rgba(178, 172, 202, 0.32)",
      road: "#89796b",
      vegetation: "#8c8051",
      backdropNear: "rgba(100, 76, 66, 0.43)",
      backdropFar: "rgba(84, 66, 60, 0.24)",
    }),
  },
];

const ARCHETYPES = [
  {
    id: "open_bank_span",
    label: "Open Bank Span",
    span: [680, 900],
    roadY: [310, 380],
    waterDrop: [58, 94],
    floorDepth: [120, 205],
    ratedLoad: [9000, 12500],
  },
  {
    id: "asymmetric_shelf_gorge",
    label: "Asymmetric Shelf Gorge",
    span: [700, 920],
    roadY: [292, 362],
    waterDrop: [80, 120],
    floorDepth: [155, 238],
    ratedLoad: [9000, 12000],
  },
  {
    id: "fixed_central_pier",
    label: "Fixed Central Pier",
    span: [780, 1000],
    roadY: [305, 378],
    waterDrop: [62, 105],
    floorDepth: [135, 220],
    ratedLoad: [10500, 14000],
  },
  {
    id: "twin_channel_island",
    label: "Twin-Channel Island",
    span: [820, 1040],
    roadY: [320, 388],
    waterDrop: [46, 84],
    floorDepth: [105, 185],
    ratedLoad: [10500, 14000],
  },
];

export function generateRandomLevel(seed, options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const regimeRng = new SeededRandom(`${normalizedSeed}|cosmetics|regime|1`);
  const backdropRng = new SeededRandom(`${normalizedSeed}|cosmetics|backdrop|1`);
  const detailRng = new SeededRandom(`${normalizedSeed}|cosmetics|details|1`);
  const animationRng = new SeededRandom(`${normalizedSeed}|cosmetics|animation|1`);

  const mechanics = mechanicsForSeed(
    normalizedSeed,
    options.certify !== false,
  );
  const regime = chooseRegime(regimeRng);
  const style = regimeRng.choice(regime.names);
  const geometry = buildGeometry(mechanics, regime.palette);
  const reference = buildReferenceTruss(mechanics, geometry.structuralSpans);
  const referenceCost = Math.round(reference.cost);
  const budget = roundUp(referenceCost * 1.25, 50);
  const fingerprint = mechanicalFingerprint(mechanics);
  const waterBodies = addWaterAnimation(
    geometry.waterBodies,
    regime,
    animationRng,
  );
  const challenge = {
    version: GENERATOR_VERSION,
    archetype: mechanics.archetype.id,
    archetypeLabel: mechanics.archetype.label,
    ratedLoad: mechanics.ratedLoad,
    tiers: [...CHALLENGE_TIERS],
    fingerprint,
    referenceCost,
  };

  return {
    name: style,
    seed: normalizedSeed,
    generator: {
      name: "superformula",
      version: GENERATOR_VERSION,
      regime: regime.id,
      calibration: {
        candidateAttempts: mechanics.candidateAttempts,
        solverCertified: mechanics.solverCertified,
      },
    },
    challenge,
    palette: { ...regime.palette },
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    grid: 20,
    snap: 10,
    roadY: mechanics.roadY,
    deckTolerance: 22,
    maxDeckSlope: 0.28,
    budget,
    costs: { ...COSTS },
    waterBodies,
    terrain: geometry.terrain,
    hazards: buildHazards(geometry.terrain, waterBodies),
    buildExclusions: buildExclusions(geometry.terrain, waterBodies),
    navigationClearances: buildNavigationClearances(mechanics),
    groundSegments: geometry.groundSegments,
    anchors: buildAnchors(geometry.anchorPlatforms),
    start: {
      x: Math.max(44, mechanics.leftEdge - 136),
      y: mechanics.roadY - 25,
    },
    goal: {
      x: Math.min(CANVAS_WIDTH - 44, mechanics.rightEdge + 136),
      y: mechanics.roadY,
    },
    vehicle: {
      width: 50,
      height: 18,
      wheelRadius: 7,
      speed: 42,
    },
    physics: { ...MATERIAL_PHYSICS },
    backdrop: buildBackdrop(regime, mechanics.roadY, backdropRng),
    details: buildDetails(
      regime,
      mechanics,
      waterBodies,
      detailRng,
      animationRng,
    ),
  };
}

export function generateReferenceBridge(seed, options = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const mechanics = mechanicsForSeed(
    normalizedSeed,
    options.certify !== false,
  );
  const geometry = buildGeometry(mechanics, BASE_PALETTE);
  return buildReferenceGraph(mechanics, geometry);
}

function mechanicsForSeed(seed, certify) {
  const cacheKey = `${seed}|${certify ? "certified" : "geometry"}`;
  const cached = mechanicsCache.get(cacheKey);
  if (cached) {
    mechanicsCache.delete(cacheKey);
    mechanicsCache.set(cacheKey, cached);
    return cloneData(cached);
  }

  const mechanicsRng = new SeededRandom(
    `${seed}|mechanics|${GENERATOR_VERSION}`,
  );
  const mechanics = generateMechanics(mechanicsRng, { certify });
  if (mechanicsCache.size >= MECHANICS_CACHE_LIMIT) {
    mechanicsCache.delete(mechanicsCache.keys().next().value);
  }
  mechanicsCache.set(cacheKey, cloneData(mechanics));
  return mechanics;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildReferenceGraph(mechanics, geometry) {
  const reference = buildReferenceTruss(mechanics, geometry.structuralSpans);
  const nodes = buildAnchors(geometry.anchorPlatforms).map((node) => ({
    ...node,
    fixed: true,
  }));
  const nodeByKey = new Map(
    nodes.map((node, index) => [
      `${roundTo(node.x, 4)}:${roundTo(node.y, 4)}`,
      index,
    ]),
  );
  const remap = reference.nodes.map((node) => {
    const key = `${roundTo(node.x, 4)}:${roundTo(node.y, 4)}`;
    if (nodeByKey.has(key)) {
      return nodeByKey.get(key);
    }
    const index = nodes.length;
    nodes.push({ x: node.x, y: node.y, fixed: false });
    nodeByKey.set(key, index);
    return index;
  });
  const beams = reference.beams.map((beam) => ({
    a: remap[beam.a],
    b: remap[beam.b],
    deck:
      Math.abs(reference.nodes[beam.a].y - mechanics.roadY) <= 0.01 &&
      Math.abs(reference.nodes[beam.b].y - mechanics.roadY) <= 0.01,
  }));
  const movableNodeCost =
    nodes.filter((node) => !node.fixed).length * COSTS.node;
  const beamCost = beams.reduce((total, beam) => {
    const first = nodes[beam.a];
    const second = nodes[beam.b];
    return (
      total +
      Math.hypot(second.x - first.x, second.y - first.y) *
        COSTS.beamPerPixel
    );
  }, 0);
  return {
    cost: movableNodeCost + beamCost,
    nodes,
    beams,
  };
}

export function normalizeSeed(seed) {
  return String(seed ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48) || "bridge";
}

function generateMechanics(rng, options = {}) {
  const archetype = rng.choice(ARCHETYPES);
  const certify = options.certify !== false;

  for (let attempt = 1; attempt <= 16; attempt += 1) {
    const mechanics = createMechanicalCandidate(archetype, rng);
    const spans = structuralSpansFor(mechanics);
    const reference = buildReferenceTruss(mechanics, spans);
    const maxSpan = Math.max(...spans.map((span) => span.x2 - span.x1));
    const referenceCapacity = roundDown(
      23500 *
        Math.sqrt(760 / maxSpan) *
        (1 + Math.min(0.24, (spans.length - 1) * 0.12)),
      50,
    );
    const unsupportedDeckCapacity = roundDown(
      4300 * Math.sqrt(720 / maxSpan),
      50,
    );
    const desiredLoad = roundToNearest(
      rng.int(...archetype.ratedLoad),
      50,
    );

    if (
      reference.cost > 0 &&
      desiredLoad >= unsupportedDeckCapacity * 1.35 &&
      desiredLoad <= referenceCapacity * 0.72 &&
      spans.every((span) => span.x2 - span.x1 >= 170)
    ) {
      const candidate = {
        ...mechanics,
        ratedLoad: desiredLoad,
        candidateAttempts: attempt,
      };
      if (!certify) {
        return { ...candidate, solverCertified: false };
      }
      if (certifyMechanicalCandidate(candidate)) {
        return { ...candidate, solverCertified: true };
      }
    }
  }

  throw new Error(`Unable to generate a calibrated ${archetype.id} challenge`);
}

function certifyMechanicalCandidate(mechanics) {
  const geometry = buildGeometry(mechanics, BASE_PALETTE);
  const reference = buildReferenceGraph(mechanics, geometry);
  const level = calibrationLevel(mechanics, geometry);
  const referenceResult = runCalibrationTrial(
    level,
    reference,
    mechanics.ratedLoad,
  );
  if (referenceResult.status !== "won") {
    return false;
  }

  const unsupported = {
    nodes: reference.nodes,
    beams: reference.beams.filter((beam) => beam.deck),
  };
  const unsupportedResult = runCalibrationTrial(
    level,
    unsupported,
    mechanics.ratedLoad,
  );
  return unsupportedResult.status === "lost";
}

function calibrationLevel(mechanics, geometry) {
  const waterBodies = geometry.waterBodies;
  return {
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    roadY: mechanics.roadY,
    maxDeckSlope: 0.28,
    groundSegments: geometry.groundSegments,
    start: {
      x: Math.max(44, mechanics.leftEdge - 136),
      y: mechanics.roadY - 25,
    },
    goal: {
      x: Math.min(CANVAS_WIDTH - 44, mechanics.rightEdge + 136),
      y: mechanics.roadY,
    },
    vehicle: {
      width: 50,
      height: 18,
      wheelRadius: 7,
      speed: 42,
    },
    physics: MATERIAL_PHYSICS,
    terrain: geometry.terrain,
    hazards: buildHazards(geometry.terrain, waterBodies),
    waterBodies,
    challenge: { ratedLoad: mechanics.ratedLoad },
  };
}

function runCalibrationTrial(level, graph, load) {
  const simulation = new BridgeSimulation(level, graph, { load });
  const maxTicks = Math.ceil(45 / SIMULATION_DT);
  while (
    simulation.status === "running" &&
    simulation.tickCount < maxTicks
  ) {
    simulation.tick();
  }
  return simulation.result();
}

function createMechanicalCandidate(archetype, rng) {
  const span = snap(rng.int(...archetype.span), 20);
  const halfSpan = span / 2;
  const center = snap(
    rng.int(halfSpan + 72, CANVAS_WIDTH - halfSpan - 72),
    10,
  );
  const leftEdge = center - halfSpan;
  const rightEdge = center + halfSpan;
  const roadY = snap(rng.int(...archetype.roadY), 10);
  const waterY = roadY + snap(rng.int(...archetype.waterDrop), 2);
  const floorY = Math.min(
    CANVAS_HEIGHT - 48,
    waterY + snap(rng.int(...archetype.floorDepth), 2),
  );
  let leftRun = snap(rng.int(72, 118), 2);
  let rightRun = snap(rng.int(72, 118), 2);
  let shelf = null;
  let pier = null;
  let island = null;

  if (archetype.id === "asymmetric_shelf_gorge") {
    const side = rng.choice(["left", "right"]);
    const shelfLength = snap(rng.int(54, 84), 2);
    if (side === "left") {
      leftRun = snap(rng.int(148, 194), 2);
      rightRun = snap(rng.int(60, 88), 2);
    } else {
      leftRun = snap(rng.int(60, 88), 2);
      rightRun = snap(rng.int(148, 194), 2);
    }
    const t = roundTo(rng.uniform(0.42, 0.58), 3);
    shelf = {
      side,
      t,
      length: shelfLength,
      y: snap(
        roadY + (waterY - roadY) * rng.uniform(0.82, 0.92),
        10,
      ),
    };
  } else if (archetype.id === "fixed_central_pier") {
    leftRun = snap(rng.int(58, 92), 2);
    rightRun = snap(rng.int(58, 92), 2);
    const width = snap(rng.int(42, 62), 10);
    const x = snap(center + rng.int(-46, 46), 10);
    pier = {
      x,
      x1: x - width / 2,
      x2: x + width / 2,
      width,
      sideRun: snap(rng.int(18, 30), 2),
    };
  } else if (archetype.id === "twin_channel_island") {
    leftRun = snap(rng.int(54, 88), 2);
    rightRun = snap(rng.int(54, 88), 2);
    const width = snap(rng.int(140, 200), 20);
    const x = snap(center + rng.int(-54, 54), 10);
    island = {
      x,
      x1: x - width / 2,
      x2: x + width / 2,
      width,
      leftRun: snap(rng.int(36, 58), 2),
      rightRun: snap(rng.int(36, 58), 2),
      shore: {
        left: superformulaParams(rng, [3, 4, 5, 6]),
        right: superformulaParams(rng, [3, 4, 5, 6]),
      },
    };
  }

  return {
    archetype,
    roadY,
    span,
    center,
    leftEdge,
    rightEdge,
    waterY,
    floorY,
    shore: {
      left: {
        run: leftRun,
        roughness: roundTo(rng.uniform(0.35, 0.9), 3),
        shape: superformulaParams(rng, [3, 4, 5, 6, 7, 8]),
      },
      right: {
        run: rightRun,
        roughness: roundTo(rng.uniform(0.35, 0.9), 3),
        shape: superformulaParams(rng, [3, 4, 5, 6, 7, 8]),
      },
    },
    floorShape: superformulaParams(rng, [2, 3, 4, 5, 6, 7]),
    waterWave: snap(rng.int(2, 5), 1),
    waterPhases: Array.from({ length: 3 }, () => roundTo(rng.random() * Math.PI * 2, 4)),
    shelf,
    pier,
    island,
  };
}

function buildGeometry(mechanics, paletteSpec) {
  const leftShelf = mechanics.shelf?.side === "left" ? mechanics.shelf : null;
  const rightShelf = mechanics.shelf?.side === "right" ? mechanics.shelf : null;
  const leftProfile = buildShoreProfile(
    mechanics.leftEdge,
    mechanics.roadY,
    mechanics.waterY,
    1,
    mechanics.shore.left,
    leftShelf,
  );
  const rightProfile = buildShoreProfile(
    mechanics.rightEdge,
    mechanics.roadY,
    mechanics.waterY,
    -1,
    mechanics.shore.right,
    rightShelf,
  );
  const leftWaterX = leftProfile.points.at(-1)[0];
  const rightWaterX = rightProfile.points.at(-1)[0];
  const riverbed = buildRiverbed(
    leftWaterX,
    rightWaterX,
    mechanics.waterY,
    mechanics.floorY,
    mechanics.floorShape,
  );
  const baseTerrain = {
    id: "valley-terrain",
    kind: "terrain",
    collidable: true,
    color: paletteSpec.rock,
    edgeColor: paletteSpec.rockEdge,
    points: [
      [0, mechanics.roadY],
      [mechanics.leftEdge, mechanics.roadY],
      ...leftProfile.points,
      ...riverbed,
      ...[...rightProfile.points].reverse(),
      [mechanics.rightEdge, mechanics.roadY],
      [CANVAS_WIDTH, mechanics.roadY],
      [CANVAS_WIDTH, CANVAS_HEIGHT],
      [0, CANVAS_HEIGHT],
    ],
  };
  const terrain = [baseTerrain];
  const anchorPlatforms = [
    {
      id: "left-road",
      x1: 0,
      x2: mechanics.leftEdge,
      y: mechanics.roadY,
      kind: "road",
    },
    {
      id: "right-road",
      x1: mechanics.rightEdge,
      x2: CANVAS_WIDTH,
      y: mechanics.roadY,
      kind: "road",
    },
    ...leftProfile.platforms,
    ...rightProfile.platforms,
  ];
  const groundSegments = [
    {
      id: "left-road",
      x1: 0,
      x2: mechanics.leftEdge,
      y: mechanics.roadY,
      kind: "road",
    },
    {
      id: "right-road",
      x1: mechanics.rightEdge,
      x2: CANVAS_WIDTH,
      y: mechanics.roadY,
      kind: "road",
    },
  ];

  if (mechanics.pier) {
    const pier = mechanics.pier;
    terrain.push({
      id: "central-pier-terrain",
      kind: "terrain",
      collidable: true,
      color: paletteSpec.rock,
      edgeColor: paletteSpec.rockEdge,
      points: [
        [pier.x1, mechanics.roadY],
        [pier.x2, mechanics.roadY],
        [pier.x2 + pier.sideRun, mechanics.floorY],
        [pier.x1 - pier.sideRun, mechanics.floorY],
      ],
    });
    anchorPlatforms.push({
      id: "central-pier",
      x1: pier.x1,
      x2: pier.x2,
      y: mechanics.roadY,
      kind: "pier",
    });
    groundSegments.splice(1, 0, {
      id: "central-pier",
      x1: pier.x1,
      x2: pier.x2,
      y: mechanics.roadY,
      kind: "pier",
    });
  }

  if (mechanics.island) {
    const island = mechanics.island;
    const leftSlope = buildIslandSlope(
      island.x1,
      mechanics.roadY,
      mechanics.waterY,
      mechanics.floorY,
      -1,
      island.leftRun,
      island.shore.left,
    );
    const rightSlope = buildIslandSlope(
      island.x2,
      mechanics.roadY,
      mechanics.waterY,
      mechanics.floorY,
      1,
      island.rightRun,
      island.shore.right,
    );
    terrain.push({
      id: "central-island-terrain",
      kind: "terrain",
      collidable: true,
      color: paletteSpec.rock,
      edgeColor: paletteSpec.rockEdge,
      points: [
        [island.x1, mechanics.roadY],
        ...rightSlope,
        ...[...leftSlope].reverse().slice(0, -1),
      ],
    });
    anchorPlatforms.push({
      id: "central-island",
      x1: island.x1,
      x2: island.x2,
      y: mechanics.roadY,
      kind: "island",
    });
    groundSegments.splice(1, 0, {
      id: "central-island",
      x1: island.x1,
      x2: island.x2,
      y: mechanics.roadY,
      kind: "island",
    });
  }

  const structuralSpans = structuralSpansFor(mechanics);
  const waterRanges = waterRangesFor(mechanics, leftWaterX, rightWaterX);
  const waterBodies = waterRanges.map((range, index) => {
    return buildWaterBody(
      `water-${index + 1}`,
      range.x1,
      range.x2,
      mechanics.waterY,
      mechanics.floorY,
      mechanics.waterWave,
      mechanics.waterPhases[index],
      paletteSpec.water,
    );
  });

  return {
    terrain,
    anchorPlatforms,
    groundSegments,
    structuralSpans,
    waterBodies,
  };
}

function buildIslandSlope(
  edgeX,
  roadY,
  waterY,
  floorY,
  side,
  shoreRun,
  shape,
) {
  const upperSegments = 4;
  const lowerSegments = 2;
  const upperDistances = shapedCumulativeDistances(
    shoreRun,
    upperSegments,
    shape,
    0,
  );
  const lowerDistances = shapedCumulativeDistances(
    20,
    lowerSegments,
    shape,
    Math.PI / 3,
  );
  const points = [[edgeX, roadY]];

  for (let index = 1; index <= upperSegments; index += 1) {
    points.push([
      snap(edgeX + side * upperDistances[index - 1], 2),
      snap(roadY + ((waterY - roadY) * index) / upperSegments, 2),
    ]);
  }
  for (let index = 1; index <= lowerSegments; index += 1) {
    points.push([
      snap(
        edgeX + side * (shoreRun + lowerDistances[index - 1]),
        2,
      ),
      snap(waterY + ((floorY - waterY) * index) / lowerSegments, 2),
    ]);
  }
  return points;
}

function shapedCumulativeDistances(total, count, shape, phase) {
  const weights = Array.from({ length: count }, (_, index) => {
    const angle = phase + ((index + 0.5) / count) * Math.PI;
    return 0.7 + 0.6 * superformulaRadius(angle, shape);
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let distanceValue = 0;
  return weights.map((weight, index) => {
    distanceValue += (total * weight) / weightTotal;
    return index === count - 1 ? total : distanceValue;
  });
}

function structuralSpansFor(mechanics) {
  if (mechanics.pier) {
    return [
      { x1: mechanics.leftEdge, x2: mechanics.pier.x1 },
      { x1: mechanics.pier.x2, x2: mechanics.rightEdge },
    ];
  }
  if (mechanics.island) {
    return [
      { x1: mechanics.leftEdge, x2: mechanics.island.x1 },
      { x1: mechanics.island.x2, x2: mechanics.rightEdge },
    ];
  }
  return [{ x1: mechanics.leftEdge, x2: mechanics.rightEdge }];
}

function waterRangesFor(mechanics, leftWaterX, rightWaterX) {
  if (mechanics.pier) {
    return [
      {
        x1: leftWaterX,
        x2: mechanics.pier.x1 - mechanics.pier.sideRun,
      },
      {
        x1: mechanics.pier.x2 + mechanics.pier.sideRun,
        x2: rightWaterX,
      },
    ];
  }
  if (mechanics.island) {
    return [
      {
        x1: leftWaterX,
        x2: mechanics.island.x1 - mechanics.island.leftRun,
      },
      {
        x1: mechanics.island.x2 + mechanics.island.rightRun,
        x2: rightWaterX,
      },
    ];
  }
  return [{ x1: leftWaterX, x2: rightWaterX }];
}

function buildShoreProfile(edgeX, roadY, waterY, side, shore, shelf) {
  const points = [];
  const platforms = [];
  const shelfLength = shelf?.length ?? 0;
  const baseRun = shore.run - shelfLength;
  let lastDistance = 0;
  let lastY = roadY;
  let shelfAdded = false;

  function append(distanceFromEdge, y, allowFlat = false) {
    const distanceValue = Math.max(lastDistance + 4, distanceFromEdge);
    const limitedY = Math.min(
      waterY,
      Math.max(roadY + 2, allowFlat ? y : Math.max(lastY + 1, y)),
    );
    points.push([
      snap(edgeX + side * distanceValue, 2),
      snap(limitedY, 2),
    ]);
    lastDistance = distanceValue;
    lastY = limitedY;
  }

  const samples = 18;
  for (let index = 1; index < samples; index += 1) {
    const t = index / samples;

    if (shelf && !shelfAdded && t >= shelf.t) {
      const startDistance = shelf.t * baseRun;
      append(startDistance, shelf.y, true);
      const startX = edgeX + side * lastDistance;
      append(startDistance + shelf.length, shelf.y, true);
      const endX = edgeX + side * lastDistance;
      platforms.push({
        id: `${shelf.side}-shelf`,
        x1: snap(Math.min(startX, endX), 2),
        x2: snap(Math.max(startX, endX), 2),
        y: snap(shelf.y, 2),
        kind: "cliff",
        side: shelf.side,
      });
      shelfAdded = true;
    }

    const phi = -Math.PI / 2 + t * Math.PI;
    const radius = superformulaRadius(phi, shore.shape);
    const shapeOffset = (Math.min(1.8, radius) / 1.8 - 0.35) * 14;
    const roughOffset =
      Math.sin(t * Math.PI * 4 + shore.shape.a * 3) *
      5 *
      shore.roughness;
    const distanceValue =
      t * baseRun + (shelfAdded ? shelfLength : 0) + shapeOffset + roughOffset;
    const smooth = smoothstep(Math.min(1, t * 1.18));
    const yWave =
      Math.sin(t * Math.PI * 5 + shore.shape.b * 4) *
      3 *
      shore.roughness;
    append(distanceValue, roadY + (waterY - roadY) * smooth + yWave);
  }

  if (shelf && !shelfAdded) {
    append(baseRun * shelf.t, shelf.y, true);
    const startX = edgeX + side * lastDistance;
    append(baseRun * shelf.t + shelf.length, shelf.y, true);
    const endX = edgeX + side * lastDistance;
    platforms.push({
      id: `${shelf.side}-shelf`,
      x1: snap(Math.min(startX, endX), 2),
      x2: snap(Math.max(startX, endX), 2),
      y: snap(shelf.y, 2),
      kind: "cliff",
      side: shelf.side,
    });
  }

  append(Math.max(shore.run, lastDistance + 8), waterY, true);
  return { points, platforms };
}

function buildRiverbed(leftX, rightX, waterY, floorY, shape) {
  const points = [];
  const samples = 30;
  const width = Math.max(1, rightX - leftX);

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const phi = -Math.PI + t * Math.PI * 2;
    const radius = superformulaRadius(phi, shape);
    const normalized = Math.min(1.8, radius) / 1.8 - 0.5;
    const depthEnvelope = Math.sin(t * Math.PI) ** 0.56;
    const baseDepth = (floorY - waterY) * depthEnvelope;
    const texture =
      normalized * 24 * depthEnvelope +
      Math.sin(t * Math.PI * 8 + shape.m) * 8 * depthEnvelope;
    points.push([
      Math.round(leftX + width * t),
      snap(waterY + Math.max(0, baseDepth + texture), 2),
    ]);
  }

  return points;
}

function buildWaterBody(id, rawX1, rawX2, surfaceY, floorY, wave, phase, color) {
  const x1 = snap(Math.min(rawX1, rawX2), 2);
  const x2 = snap(Math.max(rawX1, rawX2), 2);
  const width = Math.max(1, x2 - x1);
  const top = [];
  const samples = Math.max(6, Math.min(18, Math.round(width / 42)));

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    top.push([
      Math.round(x1 + width * t),
      snap(surfaceY + Math.sin(t * Math.PI * 2 + phase) * wave, 2),
    ]);
  }

  const bottomY = Math.min(CANVAS_HEIGHT - 16, floorY + 34);
  const points = [
    ...top,
    [x2, bottomY],
    [x1, bottomY],
  ];

  return {
    id,
    kind: "water",
    color,
    surfaceY,
    bounds: boundsForPoints(points),
    points,
  };
}

function addWaterAnimation(waterBodies, regime, rng) {
  return waterBodies.map((body) => ({
    ...body,
    highlight: regime.palette.waterHighlight,
    animation: {
      phase: roundTo(rng.random() * Math.PI * 2, 4),
      speed: roundTo(rng.uniform(...regime.waterMotion), 3),
      amplitude: roundTo(rng.uniform(1.4, 3.2), 2),
    },
  }));
}

function buildAnchors(platforms) {
  const anchors = [];

  for (const platform of platforms) {
    let count = 1;
    if (platform.kind === "road") {
      count = 4;
    } else if (platform.kind === "island") {
      count = 5;
    } else if (platform.kind === "pier") {
      count = 3;
    } else if (platform.x2 - platform.x1 >= 56) {
      count = 2;
    }

    let startX = platform.x1;
    let endX = platform.x2;
    if (platform.kind === "road" && platform.id === "left-road") {
      startX = Math.max(20, platform.x2 - 150);
    } else if (platform.kind === "road" && platform.id === "right-road") {
      endX = Math.min(CANVAS_WIDTH - 20, platform.x1 + 150);
    }

    anchors.push(...anchorLine(startX, endX, platform.y, count));
  }

  return uniqueAnchors(anchors);
}

function buildReferenceTruss(mechanics, spans) {
  const nodes = [];
  const beams = [];
  const nodeByKey = new Map();
  const terrainClearDepth = mechanics.shelf
    ? Math.min(96, mechanics.shelf.y - mechanics.roadY - 18)
    : 90;
  const depth = Math.max(
    24,
    Math.min(terrainClearDepth, mechanics.waterY - mechanics.roadY - 12),
  );

  function addNode(x, y, fixed = false) {
    const key = `${roundTo(x, 4)}:${roundTo(y, 4)}`;
    if (nodeByKey.has(key)) {
      const existing = nodeByKey.get(key);
      nodes[existing].fixed ||= fixed;
      return existing;
    }
    const index = nodes.length;
    nodes.push({ x, y, fixed });
    nodeByKey.set(key, index);
    return index;
  }

  function addBeam(a, b) {
    if (a !== b) {
      beams.push({ a, b });
    }
  }

  for (const span of spans) {
    const width = span.x2 - span.x1;
    const panelCount = Math.max(3, Math.ceil(width / 82));
    const panelWidth = width / panelCount;
    const deckNodes = [];
    const trussNodes = [];

    for (let index = 0; index <= panelCount; index += 1) {
      deckNodes.push(
        addNode(
          span.x1 + panelWidth * index,
          mechanics.roadY,
          index === 0 || index === panelCount,
        ),
      );
    }
    for (let index = 0; index < panelCount; index += 1) {
      const spanProgress = (index + 0.5) / panelCount;
      const localDepth = Math.max(
        2,
        depth * Math.sin(Math.PI * spanProgress) ** 2.4,
      );
      trussNodes.push(
        addNode(
          span.x1 + panelWidth * (index + 0.5),
          mechanics.roadY + localDepth,
          false,
        ),
      );
    }

    for (let index = 0; index < panelCount; index += 1) {
      addBeam(deckNodes[index], deckNodes[index + 1]);
      addBeam(deckNodes[index], trussNodes[index]);
      addBeam(trussNodes[index], deckNodes[index + 1]);
      if (index > 0) {
        addBeam(trussNodes[index - 1], trussNodes[index]);
      }
    }
  }

  const movableNodeCost =
    nodes.filter((node) => !node.fixed).length * COSTS.node;
  const beamCost = beams.reduce((total, beam) => {
    const first = nodes[beam.a];
    const second = nodes[beam.b];
    return total + Math.hypot(second.x - first.x, second.y - first.y) * COSTS.beamPerPixel;
  }, 0);

  return {
    cost: movableNodeCost + beamCost,
    nodes,
    beams,
  };
}

function buildHazards(terrain, waterBodies) {
  return [
    ...waterBodies.map((body) => ({
      id: `${body.id}-hazard`,
      type: "water",
      points: clonePoints(body.points),
      bounds: { ...body.bounds },
      surfaceY: body.surfaceY,
    })),
    ...terrain.map((land) => ({
      id: `${land.id}-impact`,
      type: "terrain-impact",
      points: clonePoints(land.points),
      bounds: boundsForPoints(land.points),
    })),
  ];
}

function buildExclusions(terrain, waterBodies) {
  return [
    ...terrain.map((land) => ({
      id: `${land.id}-build-exclusion`,
      kind: "terrain",
      reason: "solid terrain",
      points: clonePoints(land.points),
    })),
    ...waterBodies.map((body) => ({
      id: `${body.id}-build-exclusion`,
      kind: "water",
      reason: "submerged construction",
      points: clonePoints(body.points),
    })),
  ];
}

function buildNavigationClearances(mechanics) {
  return [
    {
      id: "train-envelope",
      kind: "vehicle",
      points: [
        [mechanics.leftEdge - 18, mechanics.roadY - 52],
        [mechanics.rightEdge + 18, mechanics.roadY - 52],
        [mechanics.rightEdge + 18, mechanics.roadY - 9],
        [mechanics.leftEdge - 18, mechanics.roadY - 9],
      ],
    },
  ];
}

function buildBackdrop(regime, roadY, rng) {
  const layers = [];
  for (let layer = 0; layer < regime.backdropLayers; layer += 1) {
    let base;
    let amplitude;
    if (regime.backdrop === "flats") {
      base = roadY - 54 - layer * 24;
      amplitude = 14 + layer * 8;
    } else if (regime.backdrop === "hills") {
      base = roadY - 84 - layer * 36;
      amplitude = 32 + layer * 16;
    } else if (regime.backdrop === "peaks") {
      base = roadY - 112 - layer * 46;
      amplitude = 86 + layer * 28;
    } else {
      base = roadY - 100 - layer * 42;
      amplitude = 58 + layer * 22;
    }

    const points = [];
    const step = 72;
    const phase = rng.random() * Math.PI * 2;
    for (let x = -step; x <= CANVAS_WIDTH + step; x += step) {
      const t = x / CANVAS_WIDTH;
      const ridge =
        Math.sin(t * Math.PI * (3 + layer) + phase) * amplitude * 0.45;
      const jag =
        Math.sin(t * Math.PI * (11 + layer * 2) + phase * 0.7) *
        amplitude *
        0.22;
      const peak =
        Math.abs(Math.sin(t * Math.PI * (5 + layer) + phase * 1.3)) *
        amplitude;
      const y =
        regime.backdrop === "peaks" || regime.backdrop === "ridges"
          ? base - peak + jag
          : base + ridge + jag;
      points.push([x, Math.max(34, Math.round(y))]);
    }

    layers.push({
      points,
      color:
        layer === regime.backdropLayers - 1
          ? regime.palette.backdropNear
          : regime.palette.backdropFar,
    });
  }

  return { layers };
}

function buildDetails(regime, mechanics, waterBodies, rng, animationRng) {
  const strata = [];
  const count =
    regime.id === "alpine_gorge" || regime.id === "canyon" ? 7 : 5;
  for (let index = 0; index < count; index += 1) {
    const y = mechanics.roadY + 64 + index * rng.int(24, 36);
    const points = [];
    const phase = rng.random() * Math.PI * 2;
    for (let x = 0; x <= CANVAS_WIDTH; x += 72) {
      const offset =
        Math.sin(x / 95 + phase) * 5 + Math.sin(x / 37 + phase) * 2;
      points.push([x, snap(y + offset, 2)]);
    }
    strata.push({
      points,
      color: "rgba(20, 22, 23, 0.28)",
      width: 1,
    });
  }

  const reeds = [];
  for (let index = 0; index < rng.int(...regime.reeds); index += 1) {
    const body = rng.choice(waterBodies);
    const side = rng.choice(["left", "right"]);
    const x =
      side === "left"
        ? body.bounds.x + rng.int(2, Math.min(34, Math.max(2, body.bounds.width / 3)))
        : body.bounds.x +
          body.bounds.width -
          rng.int(2, Math.min(34, Math.max(2, body.bounds.width / 3)));
    reeds.push({
      x: Math.round(x),
      y: Math.round(body.surfaceY + rng.int(0, 7)),
      height: rng.int(10, 24),
      color: regime.palette.vegetation,
      phase: roundTo(animationRng.random() * Math.PI * 2, 3),
    });
  }

  return {
    strata,
    reeds,
    animation: {
      reedSway: roundTo(animationRng.uniform(0.012, 0.026), 3),
    },
    effects: {
      breakParticles: 9,
      splashParticles: 14,
      impactShake: 3,
    },
  };
}

function chooseRegime(rng) {
  return rng.weightedChoice(
    REGIMES,
    REGIMES.map((regime) => regime.weight),
  );
}

function superformulaParams(rng, mChoices) {
  return {
    a: roundTo(rng.uniform(0.7, 1.3), 4),
    b: roundTo(rng.uniform(0.7, 1.3), 4),
    m: rng.choice(mChoices),
    n1: roundTo(rng.uniform(0.46, 2.25), 4),
    n2: roundTo(rng.uniform(0.48, 3.1), 4),
    n3: roundTo(rng.uniform(0.48, 3.1), 4),
  };
}

function superformulaRadius(phi, params) {
  const n1 = Math.max(params.n1, 0.001);
  const term1 =
    Math.abs(Math.cos((params.m * phi) / 4) / params.a) ** params.n2;
  const term2 =
    Math.abs(Math.sin((params.m * phi) / 4) / params.b) ** params.n3;
  const value = term1 + term2;
  return value <= 0 ? 1 : value ** (-1 / n1);
}

function mechanicalFingerprint(mechanics) {
  const canonical = JSON.stringify({
    version: GENERATOR_VERSION,
    archetype: mechanics.archetype.id,
    roadY: mechanics.roadY,
    span: mechanics.span,
    center: mechanics.center,
    waterY: mechanics.waterY,
    floorY: mechanics.floorY,
    shore: mechanics.shore,
    floorShape: mechanics.floorShape,
    shelf: mechanics.shelf,
    pier: mechanics.pier,
    island: mechanics.island,
    waterWave: mechanics.waterWave,
    waterPhases: mechanics.waterPhases,
    ratedLoad: mechanics.ratedLoad,
  });
  return `g2-${hashString(canonical).toString(36).padStart(7, "0")}`;
}

function boundsForPoints(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function clonePoints(points) {
  return points.map((point) => [...point]);
}

function anchorLine(startX, endX, y, count) {
  if (count <= 1) {
    return [{ x: Math.round((startX + endX) / 2), y }];
  }
  const step = (endX - startX) / (count - 1);
  return Array.from({ length: count }, (_value, index) => ({
    x: Math.round(startX + step * index),
    y,
  }));
}

function uniqueAnchors(anchors) {
  const seen = new Set();
  const unique = [];
  for (const anchor of anchors) {
    const key = `${anchor.x}:${anchor.y}`;
    if (!seen.has(key)) {
      unique.push(anchor);
      seen.add(key);
    }
  }
  return unique;
}

function snap(value, size) {
  return Math.round(value / size) * size;
}

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function roundUp(value, increment) {
  return Math.ceil(value / increment) * increment;
}

function roundDown(value, increment) {
  return Math.floor(value / increment) * increment;
}

function roundToNearest(value, increment) {
  return Math.round(value / increment) * increment;
}

function smoothstep(value) {
  const limited = Math.max(0, Math.min(1, value));
  return limited * limited * (3 - 2 * limited);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class SeededRandom {
  constructor(seed) {
    [this.a, this.b, this.c, this.d] = hashSeed(seed);
  }

  random() {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  int(min, max) {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  uniform(min, max) {
    return min + (max - min) * this.random();
  }

  choice(items) {
    return items[this.int(0, items.length - 1)];
  }

  weightedChoice(items, weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = this.random() * total;
    for (let index = 0; index < items.length; index += 1) {
      roll -= weights[index];
      if (roll < 0) {
        return items[index];
      }
    }
    return items.at(-1);
  }
}

function hashSeed(seed) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let index = 0; index < seed.length; index += 1) {
    const k = seed.charCodeAt(index);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
