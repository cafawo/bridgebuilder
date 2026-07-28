import {
  GENERATOR_VERSION,
  generateRandomLevel,
  normalizeSeed,
} from "./generator.js?v=challenge3";

export { GENERATOR_VERSION, normalizeSeed };

export function loadLevel(seed) {
  const level = generateRandomLevel(seed);
  validateLevel(level);
  return level;
}

export function validateLevel(level) {
  const requiredKeys = [
    "name",
    "generator",
    "challenge",
    "palette",
    "canvas",
    "grid",
    "snap",
    "roadY",
    "deckTolerance",
    "maxDeckSlope",
    "terrain",
    "waterBodies",
    "hazards",
    "buildExclusions",
    "anchors",
    "start",
    "goal",
    "vehicle",
    "groundSegments",
    "budget",
    "costs",
    "physics",
    "backdrop",
    "details",
  ];
  for (const key of requiredKeys) {
    if (!(key in level)) {
      throw new Error(`Level is missing ${key}`);
    }
  }

  if (!Array.isArray(level.anchors) || level.anchors.length < 2) {
    throw new Error("Level needs at least two anchors");
  }
  if (typeof level.name !== "string" || level.name.length === 0) {
    throw new Error("Level name is invalid");
  }

  if (!Number.isFinite(level.canvas.width) || !Number.isFinite(level.canvas.height)) {
    throw new Error("Level canvas size is invalid");
  }
  if (
    !Number.isFinite(level.grid) ||
    level.grid <= 0 ||
    !Number.isFinite(level.snap) ||
    level.snap <= 0 ||
    !Number.isFinite(level.roadY) ||
    !Number.isFinite(level.deckTolerance) ||
    level.deckTolerance <= 0 ||
    !Number.isFinite(level.maxDeckSlope) ||
    level.maxDeckSlope <= 0
  ) {
    throw new Error("Level editor geometry is invalid");
  }
  if (
    !Number.isFinite(level.start?.x) ||
    !Number.isFinite(level.start?.y) ||
    !Number.isFinite(level.goal?.x) ||
    !Number.isFinite(level.goal?.y) ||
    !Number.isFinite(level.budget) ||
    level.budget <= 0 ||
    !Number.isFinite(level.costs?.node) ||
    level.costs.node <= 0 ||
    !Number.isFinite(level.costs?.beamPerPixel) ||
    level.costs.beamPerPixel <= 0
  ) {
    throw new Error("Level playfield contract is invalid");
  }

  if (
    !level.seed ||
    level.generator?.name !== "superformula" ||
    level.generator?.version !== GENERATOR_VERSION
  ) {
    throw new Error("Level must be generated from a Superformula seed");
  }

  if (!level.generator?.regime || !Array.isArray(level.waterBodies)) {
    throw new Error("Level must include procedural visual regimes");
  }

  validateChallenge(level);
  validateGeometry(level);
  validateConstructionContract(level);
}

function validateChallenge(level) {
  const challenge = level.challenge;
  const archetypes = new Set([
    "open_bank_span",
    "asymmetric_shelf_gorge",
    "fixed_central_pier",
    "twin_channel_island",
  ]);

  if (
    challenge?.version !== GENERATOR_VERSION ||
    !archetypes.has(challenge?.archetype) ||
    typeof challenge?.archetypeLabel !== "string" ||
    challenge.archetypeLabel.length === 0
  ) {
    throw new Error("Level challenge identity is invalid");
  }

  if (
    !Number.isFinite(challenge.ratedLoad) ||
    challenge.ratedLoad <= 0 ||
    challenge.ratedLoad % 50 !== 0 ||
    !Array.isArray(challenge.tiers) ||
    challenge.tiers.join(",") !== "1,1.5,2"
  ) {
    throw new Error("Level challenge load tiers are invalid");
  }

  if (
    !/^g2-[a-z0-9]{7}$/.test(challenge.fingerprint) ||
    !Number.isFinite(challenge.referenceCost) ||
    challenge.referenceCost <= 0
  ) {
    throw new Error("Level challenge fingerprint or reference cost is invalid");
  }

  const targetHeadroom = level.budget - challenge.referenceCost * 1.25;
  if (targetHeadroom < 0 || targetHeadroom >= 50) {
    throw new Error("Level cost target must be the rounded 125% reference cost");
  }

  if (
    "load" in level.vehicle ||
    "mass" in level.vehicle ||
    !Number.isFinite(level.vehicle.speed) ||
    !Number.isFinite(level.vehicle.width) ||
    level.vehicle.width <= 0 ||
    !Number.isFinite(level.vehicle.height) ||
    level.vehicle.height <= 0 ||
    !Number.isFinite(level.vehicle.wheelRadius) ||
    level.vehicle.wheelRadius <= 0
  ) {
    throw new Error("Vehicle load must be supplied by a simulation trial");
  }
}

function validateGeometry(level) {
  if (
    !Array.isArray(level.terrain) ||
    level.terrain.length === 0 ||
    !level.terrain.every((shape) => {
      return isPolygon(shape) && typeof shape.color === "string";
    })
  ) {
    throw new Error("Level terrain polygons are invalid");
  }

  if (
    level.waterBodies.length === 0 ||
    !level.waterBodies.every((body) => {
      return (
        isPolygon(body) &&
        body.kind === "water" &&
        typeof body.color === "string" &&
        typeof body.highlight === "string" &&
        Number.isFinite(body.surfaceY) &&
        isBounds(body.bounds) &&
        Number.isFinite(body.animation?.phase) &&
        Number.isFinite(body.animation?.speed) &&
        Number.isFinite(body.animation?.amplitude)
      );
    })
  ) {
    throw new Error("Level water geometry is invalid");
  }

  if (
    !Array.isArray(level.hazards) ||
    level.hazards.length < level.waterBodies.length ||
    !level.hazards.every(isPolygon)
  ) {
    throw new Error("Level hazard polygons are invalid");
  }

  if (
    !Array.isArray(level.groundSegments) ||
    level.groundSegments.length < 2 ||
    !level.groundSegments.every((segment) => {
      return (
        Number.isFinite(segment.x1) &&
        Number.isFinite(segment.x2) &&
        Number.isFinite(segment.y) &&
        segment.x2 > segment.x1
      );
    })
  ) {
    throw new Error("Level ground segments are invalid");
  }

  if (level.challenge.archetype === "twin_channel_island") {
    const island = level.groundSegments.find((segment) => segment.kind === "island");
    if (level.waterBodies.length !== 2 || !island) {
      throw new Error("Twin-channel challenges need two waters and a driveable island");
    }
    const [leftWater, rightWater] = [...level.waterBodies].sort(
      (first, second) => first.bounds.x - second.bounds.x,
    );
    if (
      leftWater.bounds.x + leftWater.bounds.width >= island.x1 ||
      rightWater.bounds.x <= island.x2
    ) {
      throw new Error("Twin-channel water bodies must be separated by the island");
    }
  }

  if (level.challenge.archetype === "fixed_central_pier") {
    const pier = level.terrain.find((shape) => shape.id === "central-pier-terrain");
    const water = level.waterBodies[0];
    const pierXs = pier?.points.map(([x]) => x) ?? [];
    const pierImpact = level.hazards.find(
      (hazard) => hazard.id === "central-pier-terrain-impact",
    );
    if (
      level.waterBodies.length !== 1 ||
      pierXs.length === 0 ||
      water.bounds.x >= Math.min(...pierXs) ||
      water.bounds.x + water.bounds.width <= Math.max(...pierXs) ||
      pierImpact?.occludesWater !== true
    ) {
      throw new Error("Fixed-pier water must continue behind solid foreground terrain");
    }
  }
}

function validateConstructionContract(level) {
  if (
    !Array.isArray(level.buildExclusions) ||
    !level.buildExclusions.every(isPolygon)
  ) {
    throw new Error("Level construction boundaries are invalid");
  }
  if (
    !Array.isArray(level.backdrop?.layers) ||
    !level.backdrop.layers.every((layer) => {
      return (
        Array.isArray(layer.points) &&
        layer.points.length >= 2 &&
        typeof layer.color === "string"
      );
    }) ||
    !Array.isArray(level.details?.strata) ||
    !Array.isArray(level.details?.reeds) ||
    !Number.isFinite(level.details?.animation?.reedSway) ||
    !Number.isFinite(level.details?.effects?.breakParticles) ||
    !Number.isFinite(level.details?.effects?.splashParticles) ||
    !Number.isFinite(level.details?.effects?.impactShake)
  ) {
    throw new Error("Level visual details are invalid");
  }

  const requiredPaletteFields = [
    "sky",
    "grid",
    "gridMajor",
    "rock",
    "water",
    "waterHighlight",
    "road",
    "vegetation",
    "stressSafe",
    "stressWarning",
    "stressHigh",
    "stressCritical",
  ];
  if (
    !level.palette ||
    requiredPaletteFields.some((field) => typeof level.palette[field] !== "string")
  ) {
    throw new Error("Level biome palette is incomplete");
  }

  const fixedPhysicsFields = [
    "gravity",
    "damping",
    "constraintIterations",
    "beamStiffness",
    "beamBreakStress",
    "beamAxialCapacity",
    "beamCompressionCapacity",
    "beamBendingCapacity",
    "beamSelfWeightCapacity",
    "deckStrengthFactor",
    "supportStrengthFactor",
    "longBeamWeakening",
    "nodeBaseMass",
    "nodeMassPerBeamPixel",
  ];
  if (
    !level.physics ||
    fixedPhysicsFields.some((field) => !Number.isFinite(level.physics[field]))
  ) {
    throw new Error("Level material physics is invalid");
  }
}

function isPolygon(value) {
  return (
    value &&
    Array.isArray(value.points) &&
    value.points.length >= 3 &&
    value.points.every((point) => {
      return (
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
      );
    })
  );
}

function isBounds(value) {
  return (
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}
