import { generateRandomLevel, normalizeSeed } from "./generator.js?v=landscape10";

export { normalizeSeed };

export function loadLevel(seed) {
  const level = generateRandomLevel(seed);
  validateLevel(level);
  return level;
}

function validateLevel(level) {
  const requiredKeys = [
    "canvas",
    "terrain",
    "water",
    "waterBodies",
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

  if (!Number.isFinite(level.canvas.width) || !Number.isFinite(level.canvas.height)) {
    throw new Error("Level canvas size is invalid");
  }

  if (!level.procedural || !level.seed || level.generator?.name !== "superformula") {
    throw new Error("Level must be generated from a Superformula seed");
  }

  if (!level.generator?.regime || !Array.isArray(level.waterBodies)) {
    throw new Error("Level must include procedural visual regimes");
  }
}
