export const BLUEPRINT_VERSION = 2;

const MAX_MOVABLE_NODES = 256;
const MAX_BEAMS = 512;
const MAX_ENCODED_LENGTH = 24000;

export function challengeIdentity(level, mode = "challenge") {
  const generatorVersion = level.generator.version;
  const physicsVersion = level.physics.version;
  const fingerprint = level.challenge.fingerprint;
  return `${generatorVersion}:${physicsVersion}:${mode}:${fingerprint}`;
}

export function draftStorageKey(level, mode = "challenge") {
  return `bridgebuilder:draft:v${BLUEPRINT_VERSION}:${challengeIdentity(level, mode)}`;
}

export function recordStorageKey(level) {
  return `bridgebuilder:record:v${BLUEPRINT_VERSION}:${challengeIdentity(level, "challenge")}`;
}

export function encodeBlueprint(level, graph) {
  const fixedCount = level.anchors.length;
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.beams) ||
    graph.nodes.length < fixedCount
  ) {
    throw new Error("Bridge data is invalid");
  }
  if (graph.nodes.length - fixedCount > MAX_MOVABLE_NODES) {
    throw new Error("Bridge has too many movable nodes to share");
  }
  if (graph.beams.length > MAX_BEAMS) {
    throw new Error("Bridge has too many beams to share");
  }
  for (let index = 0; index < fixedCount; index += 1) {
    const node = graph.nodes[index];
    const anchor = level.anchors[index];
    if (
      !Number.isFinite(node?.x) ||
      !Number.isFinite(node?.y) ||
      Math.hypot(node.x - anchor.x, node.y - anchor.y) > 0.001
    ) {
      throw new Error("Bridge foundations do not match this challenge");
    }
  }
  const movable = graph.nodes.slice(fixedCount).map((node) => [
    finiteCoordinate(node.x),
    finiteCoordinate(node.y),
  ]);
  const seen = new Set();
  const beams = graph.beams
    .map((beam) => {
      const a = Number(beam?.a);
      const b = Number(beam?.b);
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= graph.nodes.length ||
        b >= graph.nodes.length ||
        a === b
      ) {
        throw new Error("Bridge contains an invalid beam");
      }
      const pair = [Math.min(a, b), Math.max(a, b)];
      const key = `${pair[0]}:${pair[1]}`;
      if (seen.has(key)) {
        throw new Error("Bridge contains a duplicate beam");
      }
      seen.add(key);
      return pair;
    })
    .sort((first, second) => first[0] - second[0] || first[1] - second[1]);

  const encoded = encodePayload({
    v: BLUEPRINT_VERSION,
    g: level.generator.version,
    p: level.physics.version,
    f: level.challenge.fingerprint,
    n: movable,
    b: beams,
  });
  if (encoded.length > MAX_ENCODED_LENGTH) {
    throw new Error("Bridge is too large to share");
  }
  return encoded;
}

export function decodeBlueprint(level, encoded) {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH) {
    throw new Error("Shared bridge data is invalid");
  }

  const payload = decodePayload(encoded);
  if (!payload || payload.v !== BLUEPRINT_VERSION) {
    throw new Error("Shared bridge version is not supported");
  }

  const expectedGenerator = level.generator.version;
  const expectedPhysics = level.physics.version;
  const expectedFingerprint = level.challenge.fingerprint;
  if (
    payload.g !== expectedGenerator ||
    payload.p !== expectedPhysics ||
    payload.f !== expectedFingerprint
  ) {
    throw new Error("Shared bridge belongs to a different challenge version");
  }

  if (!Array.isArray(payload.n) || payload.n.length > MAX_MOVABLE_NODES) {
    throw new Error("Shared bridge has too many nodes");
  }
  if (!Array.isArray(payload.b) || payload.b.length > MAX_BEAMS) {
    throw new Error("Shared bridge has too many beams");
  }

  const movable = payload.n.map((point) => validatePoint(point, level));
  const nodes = [
    ...level.anchors.map((anchor) => ({ x: anchor.x, y: anchor.y, fixed: true })),
    ...movable.map(([x, y]) => ({ x, y, fixed: false })),
  ];

  const seen = new Set();
  const beams = payload.b.map((entry) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isInteger(entry[0]) ||
      !Number.isInteger(entry[1]) ||
      entry[0] < 0 ||
      entry[1] < 0 ||
      entry[0] >= nodes.length ||
      entry[1] >= nodes.length ||
      entry[0] === entry[1]
    ) {
      throw new Error("Shared bridge contains an invalid beam");
    }

    const a = Math.min(entry[0], entry[1]);
    const b = Math.max(entry[0], entry[1]);
    const key = `${a}:${b}`;
    if (seen.has(key)) {
      throw new Error("Shared bridge contains a duplicate beam");
    }
    seen.add(key);
    return { a, b };
  });

  return { nodes, beams };
}

export function designFromLocationHash(hash = window.location.hash) {
  const raw = String(hash || "").replace(/^#/, "");
  return new URLSearchParams(raw).get("design") || "";
}

export function hashForDesign(encoded) {
  const params = new URLSearchParams();
  params.set("design", encoded);
  return `#${params.toString()}`;
}

export function loadStoredJson(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function storeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function betterRecord(candidate, current) {
  if (!current) {
    return true;
  }
  if (candidate.maxLoad !== current.maxLoad) {
    return candidate.maxLoad > current.maxLoad;
  }
  return candidate.cost < current.cost;
}

function finiteCoordinate(value) {
  if (!Number.isFinite(value)) {
    throw new Error("Bridge contains an invalid coordinate");
  }
  return Math.round(value * 1000) / 1000;
}

function validatePoint(point, level) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1])
  ) {
    throw new Error("Shared bridge contains an invalid node");
  }

  const [x, y] = point;
  if (x < 0 || x > level.canvas.width || y < 0 || y > level.canvas.height) {
    throw new Error("Shared bridge contains an out-of-bounds node");
  }

  return [finiteCoordinate(x), finiteCoordinate(y)];
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePayload(encoded) {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Shared bridge data could not be decoded");
  }
}
