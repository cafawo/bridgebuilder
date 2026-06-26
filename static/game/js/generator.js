const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 700;
const ROCK_COLOR = "#303335";
const WATER_COLOR = "#11106d";

const LOWLAND_REGIMES = new Set(["riverlands", "marshland", "swampland"]);

const REGIMES = [
  {
    id: "riverlands",
    label: "Riverlands",
    names: ["Riverland Crossing", "Lowland River", "Wide River Bend"],
    weight: 17,
    span: [760, 960],
    roadY: [340, 390],
    waterDrop: [34, 58],
    floorDepth: [92, 150],
    shoreRun: [130, 190],
    shoreBulge: 20,
    shoreRough: 0.45,
    floorRough: 30,
    shelves: [0, 1],
    shelfWeights: [3, 4],
    shelfLengths: [30, 58],
    basins: 1,
    backdrop: "hills",
    backdropLayers: 2,
    reeds: [4, 12],
    budgetFactor: [9.8, 11.2],
  },
  {
    id: "marshland",
    label: "Marshland",
    names: ["Marsh Causeway", "Reed Flats", "Fenland Cut"],
    weight: 13,
    span: [820, 1060],
    roadY: [350, 398],
    waterDrop: [22, 44],
    floorDepth: [68, 122],
    shoreRun: [160, 230],
    shoreBulge: 12,
    shoreRough: 0.22,
    floorRough: 18,
    shelves: [0, 1],
    shelfWeights: [5, 2],
    shelfLengths: [34, 64],
    basins: 1,
    backdrop: "flats",
    backdropLayers: 1,
    reeds: [16, 34],
    budgetFactor: [9.2, 10.5],
  },
  {
    id: "swampland",
    label: "Swampland",
    names: ["Swamp Crossing", "Blackwater Swamp", "Sinking Flats"],
    weight: 10,
    span: [780, 1040],
    roadY: [348, 402],
    waterDrop: [28, 54],
    floorDepth: [82, 148],
    shoreRun: [150, 240],
    shoreBulge: 16,
    shoreRough: 0.35,
    floorRough: 26,
    shelves: [0, 1, 2],
    shelfWeights: [4, 3, 1],
    shelfLengths: [30, 58],
    basins: 1,
    backdrop: "flats",
    backdropLayers: 2,
    reeds: [26, 48],
    budgetFactor: [9.4, 10.8],
  },
  {
    id: "highlands",
    label: "Highlands",
    names: ["Highland Cut", "Mountain Valley", "Broken Uplands"],
    weight: 19,
    span: [760, 940],
    roadY: [308, 368],
    waterDrop: [54, 84],
    floorDepth: [130, 205],
    shoreRun: [110, 174],
    shoreBulge: 26,
    shoreRough: 0.72,
    floorRough: 42,
    shelves: [1, 2],
    shelfWeights: [4, 3],
    shelfLengths: [34, 62],
    basins: 1,
    backdrop: "mountains",
    backdropLayers: 2,
    reeds: [0, 6],
    budgetFactor: [10.4, 12.2],
  },
  {
    id: "alpine_gorge",
    label: "Alpine Gorge",
    names: ["Alpine Gorge", "Deep Mountain Pass", "Blackwater Gorge"],
    weight: 16,
    span: [820, 1040],
    roadY: [278, 344],
    waterDrop: [76, 116],
    floorDepth: [180, 278],
    shoreRun: [72, 132],
    shoreBulge: 34,
    shoreRough: 1.0,
    floorRough: 60,
    shelves: [1, 2, 3],
    shelfWeights: [3, 4, 2],
    shelfLengths: [30, 54],
    basins: 1,
    backdrop: "peaks",
    backdropLayers: 3,
    reeds: [0, 2],
    budgetFactor: [11.2, 13.0],
  },
  {
    id: "split_valley",
    label: "Split Valley",
    names: ["Twin Valley", "Double Basin", "Forked River Gorge"],
    weight: 15,
    span: [850, 1080],
    roadY: [300, 374],
    waterDrop: [48, 86],
    floorDepth: [130, 220],
    shoreRun: [112, 190],
    shoreBulge: 24,
    shoreRough: 0.65,
    floorRough: 38,
    shelves: [1, 2],
    shelfWeights: [3, 3],
    shelfLengths: [32, 58],
    basins: 2,
    backdrop: "mountains",
    backdropLayers: 2,
    reeds: [2, 8],
    budgetFactor: [10.8, 12.6],
  },
  {
    id: "canyon",
    label: "Canyon",
    names: ["Knife Edge Canyon", "Dry Canyon River", "Sawtooth Ravine"],
    weight: 12,
    span: [700, 900],
    roadY: [270, 336],
    waterDrop: [86, 128],
    floorDepth: [190, 285],
    shoreRun: [62, 116],
    shoreBulge: 40,
    shoreRough: 1.15,
    floorRough: 52,
    shelves: [1, 2, 3],
    shelfWeights: [2, 4, 2],
    shelfLengths: [26, 48],
    basins: 1,
    backdrop: "ridges",
    backdropLayers: 3,
    reeds: [0, 1],
    budgetFactor: [11.0, 12.8],
  },
];

export function generateRandomLevel(seed) {
  const normalizedSeed = normalizeSeed(seed);
  const rng = new SeededRandom(normalizedSeed);
  const regime = chooseRegime(rng);
  const style = rng.choice(regime.names);
  const roadY = snap(rng.int(...regime.roadY), 10);
  const span = snap(rng.int(...regime.span), 10);
  const center = snap(rng.int(CANVAS_WIDTH / 2 - 70, CANVAS_WIDTH / 2 + 70), 10);
  const leftEdge = Math.max(72, center - span / 2);
  const rightEdge = Math.min(CANVAS_WIDTH - 72, center + span / 2);
  const bridgeSpan = rightEdge - leftEdge;
  const waterY = roadY + snap(rng.int(...regime.waterDrop), 2);
  const floorY = Math.min(CANVAS_HEIGHT - 54, waterY + rng.int(...regime.floorDepth));
  const load = rng.int(1550, 2450);

  const shoreShape = superformulaParams(rng, [3, 4, 5, 6, 7, 8]);
  const floorShape = superformulaParams(rng, [2, 3, 4, 5, 6, 7]);
  const leftProfile = superformulaShore(leftEdge, roadY, waterY, shoreShape, 1, rng, regime);
  const rightProfile = superformulaShore(rightEdge, roadY, waterY, shoreShape, -1, rng, regime);
  const leftShore = leftProfile.points;
  const rightShore = rightProfile.points;
  const leftWaterX = leftShore.at(-1)[0];
  const rightWaterX = rightShore.at(-1)[0];
  const riverbed = superformulaRiverbed(
    leftWaterX,
    rightWaterX,
    waterY,
    floorY,
    floorShape,
    regime,
  ).points;
  const waterBodies = buildWaterBodies(
    regime,
    leftEdge,
    rightEdge,
    leftWaterX,
    rightWaterX,
    waterY,
    floorY,
    rng,
  );
  const water = waterBounds(waterBodies);
  const anchorPlatforms = [
    { x1: 0, x2: leftEdge, y: roadY, kind: "road" },
    { x1: rightEdge, x2: CANVAS_WIDTH, y: roadY, kind: "road" },
    ...leftProfile.platforms,
    ...rightProfile.platforms,
  ];
  const terrain = buildTerrain(leftEdge, rightEdge, roadY, leftShore, rightShore, riverbed);
  const anchors = buildAnchors(leftEdge, rightEdge, roadY, anchorPlatforms, rng);
  const cliffPlatformCount = anchorPlatforms.filter((platform) => platform.kind === "cliff").length;
  const budget = Math.floor(
    bridgeSpan * rng.uniform(...regime.budgetFactor) +
      cliffPlatformCount * 250 +
      rng.int(2400, 3400),
  );

  return {
    name: style,
    slug: `seed-${normalizedSeed}`,
    seed: normalizedSeed,
    procedural: true,
    generator: {
      name: "superformula",
      regime: regime.id,
      regimeLabel: regime.label,
      shore: shoreShape,
      river: floorShape,
      style,
    },
    canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    grid: 20,
    snap: 10,
    roadY,
    deckTolerance: 26,
    maxDeckSlope: 0.34,
    budget,
    costs: { node: 90, beamPerPixel: 1.0 },
    water,
    waterBodies,
    terrain,
    anchorPlatforms,
    groundSegments: [
      { x1: 0, x2: leftEdge, y: roadY },
      { x1: rightEdge, x2: CANVAS_WIDTH, y: roadY },
    ],
    anchors,
    start: { x: Math.max(44, leftEdge - 136), y: roadY - 25 },
    goal: { x: Math.min(CANVAS_WIDTH - 44, rightEdge + 136), y: roadY },
    vehicle: {
      width: rng.choice([48, 50, 52]),
      height: 18,
      wheelRadius: 7,
      speed: rng.int(38, 45),
      mass: 2.2,
      load,
    },
    physics: {
      gravity: 900,
      damping: 0.991,
      constraintIterations: 14,
      beamStiffness: 0.72,
      beamBreakStress: rng.uniform(0.106, 0.122),
      beamBendingCapacity: rng.int(2600000, 3000000),
      beamSelfWeightCapacity: rng.int(17000000, 20000000),
      deckStrengthFactor: 0.92,
      supportStrengthFactor: 1.08,
      longBeamWeakening: rng.uniform(0.00032, 0.0004),
    },
    backdrop: buildBackdrop(regime, roadY, rng),
    details: buildDetails(regime, roadY, waterBodies, rng),
  };
}

export function normalizeSeed(seed) {
  return String(seed ?? "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 48) || "bridge";
}

function chooseRegime(rng) {
  return rng.weightedChoice(
    REGIMES,
    REGIMES.map((regime) => regime.weight),
  );
}

function buildTerrain(leftEdge, rightEdge, roadY, leftShore, rightShore, riverbed) {
  return [
    {
      color: ROCK_COLOR,
      points: [
        [0, roadY],
        [leftEdge, roadY],
        ...leftShore,
        ...riverbed,
        ...[...rightShore].reverse(),
        [rightEdge, roadY],
        [CANVAS_WIDTH, roadY],
        [CANVAS_WIDTH, CANVAS_HEIGHT],
        [0, CANVAS_HEIGHT],
      ],
    },
  ];
}

function buildAnchors(leftEdge, rightEdge, roadY, platforms, rng) {
  const anchors = [
    ...anchorLine(Math.max(20, leftEdge - 150), leftEdge, roadY, 4),
    ...anchorLine(rightEdge, Math.min(CANVAS_WIDTH - 20, rightEdge + 150), roadY, 4),
  ];
  const cliffPlatforms = platforms.filter((platform) => platform.kind === "cliff");

  for (const platform of cliffPlatforms) {
    const center = snap((platform.x1 + platform.x2) / 2, 10);
    anchors.push({ x: center, y: platform.y });
    if (platform.x2 - platform.x1 >= 54 && rng.random() < 0.5) {
      const side = rng.choice([-1, 1]);
      anchors.push({ x: snap(center + side * 22, 10), y: platform.y });
    }
  }

  return uniqueAnchors(anchors);
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
  const term1 = Math.abs(Math.cos((params.m * phi) / 4) / params.a) ** params.n2;
  const term2 = Math.abs(Math.sin((params.m * phi) / 4) / params.b) ** params.n3;
  const value = term1 + term2;
  return value <= 0 ? 1 : value ** (-1 / n1);
}

function superformulaShore(edgeX, roadY, waterY, params, side, rng, regime) {
  const points = [];
  const platforms = [];
  const totalRun = rng.int(...regime.shoreRun);
  const shelfCount = rng.weightedChoice(regime.shelves, regime.shelfWeights);
  const shelfPositions = rng
    .sample([0.28, 0.38, 0.5, 0.62, 0.74], Math.min(3, shelfCount))
    .sort((first, second) => first - second);
  let nextShelf = 0;
  let lastRun = 0;
  let lastY = roadY;
  const maxShoreY = waterY - 6;

  function shapedRun(t) {
    const phi = -Math.PI / 2 + t * Math.PI;
    const radius = superformulaRadius(phi, params);
    const normalized = Math.min(1.8, radius) / 1.8;
    let wave = Math.sin(t * Math.PI * 2 + params.m) * 9 * regime.shoreRough;
    wave += Math.sin(t * Math.PI * 5 + params.a * 4) * 5 * regime.shoreRough;
    return 14 + t * totalRun + normalized * regime.shoreBulge + wave;
  }

  function shapedY(t) {
    const smooth = t * t * (3 - 2 * t);
    let wave = Math.sin(t * Math.PI * 3 + params.a * Math.PI) * 5 * regime.shoreRough;
    wave += Math.sin(t * Math.PI * 7 + params.b) * 3 * regime.shoreRough;
    return roadY + (waterY - roadY) * smooth + wave;
  }

  function appendPoint(run, y, allowFlat = false) {
    run = Math.max(run, lastRun + 7);
    y = Math.min(maxShoreY, Math.max(roadY + 2, y));
    if (points.length > 0 && !allowFlat) {
      y = Math.min(maxShoreY, Math.max(y, lastY + 2));
    }
    points.push([snap(edgeX + side * run, 2), snap(y, 2)]);
    lastRun = run;
    lastY = y;
  }

  function appendShelf(t) {
    const rawRun = shapedRun(t);
    let shelfY = snap(shapedY(t), 10);
    shelfY = Math.min(maxShoreY, Math.max(lastY + 4, shelfY));
    const shelfLength = rng.int(...regime.shelfLengths);
    const approachRun = Math.max(rawRun - rng.int(14, 26), lastRun + 8);
    appendPoint(approachRun, shelfY - rng.int(8, 18));

    const startRun = Math.max(rawRun, lastRun + 9);
    const endRun = startRun + shelfLength;
    const startX = snap(edgeX + side * startRun, 2);
    const endX = snap(edgeX + side * endRun, 2);
    appendPoint(startRun, shelfY, true);
    appendPoint(endRun, shelfY, true);
    platforms.push({
      x1: Math.min(startX, endX),
      x2: Math.max(startX, endX),
      y: shelfY,
      kind: "cliff",
      side: side === 1 ? "left" : "right",
    });
  }

  const samples = 22;
  for (let index = 1; index <= samples; index += 1) {
    const t = index / (samples + 1);
    while (nextShelf < shelfPositions.length && t >= shelfPositions[nextShelf]) {
      appendShelf(shelfPositions[nextShelf]);
      nextShelf += 1;
    }
    appendPoint(shapedRun(t), shapedY(t));
  }

  while (nextShelf < shelfPositions.length) {
    appendShelf(shelfPositions[nextShelf]);
    nextShelf += 1;
  }

  const waterRun = Math.max(totalRun + rng.int(18, 38), lastRun + 18);
  points.push([snap(edgeX + side * waterRun, 2), waterY]);
  return { points, platforms };
}

function superformulaRiverbed(leftEdge, rightEdge, waterY, floorY, params, regime) {
  const points = [];
  const samples = regime.basins === 2 ? 29 : 23;
  const width = Math.max(1, rightEdge - leftEdge);
  const bankFraction = LOWLAND_REGIMES.has(regime.id) ? 0.2 : 0.14;
  const bankInset = Math.min(width * 0.12, 58);

  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    const phi = -Math.PI + t * Math.PI * 2;
    const radius = superformulaRadius(phi, params);
    const normalized = Math.min(1.8, radius) / 1.8 - 0.5;
    const x = leftEdge + bankInset + (width - bankInset * 2) * t;
    const deepT = smoothstep(Math.min(1, Math.min(t, 1 - t) / bankFraction));
    const floorTarget = floorY + normalized * regime.floorRough;
    let y = waterY + 12 + (floorTarget - waterY - 12) * deepT;
    y += Math.sin(t * Math.PI * 4 + params.m) * regime.floorRough * 0.18;
    y += Math.sin(t * Math.PI * 9 + params.a * 4) * regime.floorRough * 0.08;

    if (regime.basins === 2) {
      const ridge = gaussian(t, 0.5, 0.18) * (floorY - waterY + 34);
      const leftBasin = gaussian(t, 0.28, 0.16) * 22;
      const rightBasin = gaussian(t, 0.72, 0.16) * 22;
      y = Math.max(waterY - 8, y - ridge + leftBasin + rightBasin);
    } else {
      y = Math.max(waterY + 10, y);
    }

    points.push([Math.round(x), snap(y, 2)]);
  }

  return { points };
}

function buildWaterBodies(regime, leftEdge, rightEdge, leftX, rightX, waterY, floorY, rng) {
  const overlap = LOWLAND_REGIMES.has(regime.id) ? 84 : 56;
  const drawLeft = Math.max(leftEdge, leftX - overlap);
  const drawRight = Math.min(rightEdge, rightX + overlap);
  const height = Math.max(36, floorY - waterY + 24);
  const wave = regime.id === "marshland" || regime.id === "swampland" ? 2 : 4;
  return [waterBody(drawLeft, drawRight, waterY, height, rng, wave)];
}

function waterBody(x1, x2, y, height, rng, wave) {
  x1 = snap(x1, 2);
  x2 = snap(x2, 2);
  const width = Math.max(1, x2 - x1);
  const sideInset = Math.min(width * 0.2, rng.int(26, 72));
  const bottomLeft = snap(x1 + sideInset, 2);
  const bottomRight = snap(x2 - sideInset, 2);
  const top = [];
  const samples = Math.max(4, Math.min(14, Math.round(width / 56)));
  const phase = rng.random() * Math.PI;

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = x1 + (x2 - x1) * t;
    const topY = y + Math.sin(t * Math.PI * 2 + phase) * wave;
    top.push([Math.round(x), snap(topY, 2)]);
  }

  const rightBank = [];
  const leftBank = [];
  const sideSamples = 4;
  for (let index = 1; index <= sideSamples; index += 1) {
    const t = index / sideSamples;
    const curve = smoothstep(t);
    const bankWave = Math.sin(t * Math.PI + phase) * wave * 0.8;
    rightBank.push([snap(x2 - sideInset * curve + bankWave, 2), snap(y + height * curve, 2)]);
    leftBank.push([snap(x1 + sideInset * curve - bankWave, 2), snap(y + height * curve, 2)]);
  }

  const bottom = [];
  const bottomSamples = Math.max(4, Math.min(12, Math.round((bottomRight - bottomLeft) / 64)));
  const bottomPhase = rng.random() * Math.PI * 2;
  for (let index = 0; index <= bottomSamples; index += 1) {
    const t = index / bottomSamples;
    const x = bottomRight - (bottomRight - bottomLeft) * t;
    const bottomY = y + height + Math.sin(t * Math.PI * 3 + bottomPhase) * wave * 2.2;
    bottom.push([Math.round(x), snap(bottomY, 2)]);
  }

  return {
    color: WATER_COLOR,
    points: [...top, ...rightBank, ...bottom, ...leftBank.reverse()],
  };
}

function waterBounds(bodies) {
  const allPoints = bodies.flatMap((body) => body.points);
  const xs = allPoints.map((point) => point[0]);
  const ys = allPoints.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    color: WATER_COLOR,
  };
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
      const ridge = Math.sin(t * Math.PI * (3 + layer) + phase) * amplitude * 0.45;
      const jag = Math.sin(t * Math.PI * (11 + layer * 2) + phase * 0.7) * amplitude * 0.22;
      const peak = Math.abs(Math.sin(t * Math.PI * (5 + layer) + phase * 1.3)) * amplitude;
      const y = regime.backdrop === "peaks" || regime.backdrop === "ridges"
        ? base - peak + jag
        : base + ridge + jag;
      points.push([x, Math.max(34, Math.round(y))]);
    }

    const opacity = 0.24 + layer * 0.08;
    layers.push({
      points,
      color: `rgba(66, 73, 74, ${opacity.toFixed(2)})`,
    });
  }

  return { layers };
}

function buildDetails(regime, roadY, waterBodies, rng) {
  const strata = [];
  const count = regime.id === "alpine_gorge" || regime.id === "canyon" ? 7 : 5;
  for (let index = 0; index < count; index += 1) {
    const y = roadY + 64 + index * rng.int(24, 36);
    const points = [];
    const phase = rng.random() * Math.PI * 2;
    for (let x = 0; x <= CANVAS_WIDTH; x += 72) {
      const offset = Math.sin(x / 95 + phase) * 5 + Math.sin(x / 37 + phase) * 2;
      points.push([x, snap(y + offset, 2)]);
    }
    strata.push({
      points,
      color: "rgba(20, 22, 23, 0.28)",
      width: 1,
    });
  }

  const reeds = [];
  const [reedMin, reedMax] = regime.reeds;
  for (let index = 0; index < rng.int(reedMin, reedMax); index += 1) {
    const body = rng.choice(waterBodies);
    const bodyPoints = body.points.slice(0, -2);
    const xs = bodyPoints.map((point) => point[0]);
    const ys = bodyPoints.map((point) => point[1]);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const y = Math.min(...ys) + rng.int(0, 8);
    const x = rng.random() < 0.5 ? left + rng.int(0, 34) : right - rng.int(0, 34);
    reeds.push({
      x: Math.round(x),
      y: Math.round(y),
      height: rng.int(10, 24),
      color: "rgba(138, 142, 77, 0.76)",
    });
  }

  return { strata, reeds };
}

function anchorLine(startX, endX, y, count) {
  if (count <= 1) {
    return [{ x: Math.round(startX), y }];
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

function gaussian(value, center, width) {
  return Math.exp(-((value - center) ** 2) / (2 * width ** 2));
}

function smoothstep(value) {
  value = Math.max(0, Math.min(1, value));
  return value * value * (3 - 2 * value);
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

  sample(items, count) {
    const pool = [...items];
    const sample = [];
    for (let index = 0; index < count && pool.length > 0; index += 1) {
      sample.push(...pool.splice(this.int(0, pool.length - 1), 1));
    }
    return sample;
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
