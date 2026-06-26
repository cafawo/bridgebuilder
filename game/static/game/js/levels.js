export async function loadLevel(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load level: ${response.status}`);
  }

  const level = await response.json();
  validateLevel(level);
  return level;
}

export async function loadLevelCatalog(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load level list: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.levels) || data.levels.length === 0) {
    throw new Error("Level list is empty");
  }
  return data.levels;
}

function validateLevel(level) {
  const requiredKeys = [
    "canvas",
    "terrain",
    "water",
    "anchors",
    "start",
    "goal",
    "vehicle",
    "groundSegments",
    "budget",
    "costs",
    "physics",
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
}
