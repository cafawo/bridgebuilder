export const LEADERBOARD_SCHEMA_VERSION = 2;
export const COST_EVENT_VERSION = "v1";
export const CAPACITY_EVENT_VERSION = "v1";
export const LEADERBOARD_URL = "static/data/leaderboard.json";

const COST_EVENT_PREFIX = "bridgebuilder-cost";
const CAPACITY_EVENT_PREFIX = "bridgebuilder-capacity";
const MAX_LEADERBOARD_ENTRIES = 100;
const SEED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const sessionReportedCosts = new Map();
const sessionReportedCapacities = new Map();

export function qualifyingCostRecord({
  gameMode,
  won,
  testLoad,
  requiredLoad,
  cost,
  maximumCost,
  seed,
  generatorVersion,
  physicsVersion,
}) {
  const normalizedCost = Math.round(Number(cost));
  const normalizedMaximumCost = Math.round(Number(maximumCost));
  const normalizedLoad = Math.round(Number(testLoad));
  const normalizedRequiredLoad = Math.round(Number(requiredLoad));
  if (
    gameMode !== "challenge" ||
    won !== true ||
    !validSeed(seed) ||
    !validVersion(generatorVersion) ||
    !validVersion(physicsVersion) ||
    !Number.isFinite(normalizedLoad) ||
    !Number.isFinite(normalizedRequiredLoad) ||
    normalizedRequiredLoad <= 0 ||
    normalizedLoad < normalizedRequiredLoad ||
    !Number.isFinite(normalizedCost) ||
    normalizedCost < 0 ||
    !Number.isFinite(normalizedMaximumCost) ||
    normalizedMaximumCost < 0 ||
    normalizedCost > normalizedMaximumCost
  ) {
    return null;
  }
  return {
    seed,
    cost: normalizedCost,
    requiredLoad: normalizedRequiredLoad,
    generatorVersion,
    physicsVersion,
  };
}

export function costEventPath(record) {
  const normalized = normalizeCostRecord(record);
  return [
    COST_EVENT_PREFIX,
    COST_EVENT_VERSION,
    normalized.generatorVersion,
    normalized.physicsVersion,
    normalized.requiredLoad,
    normalized.seed,
    normalized.cost,
  ].join("/");
}

export function qualifyingCapacityRecord({
  gameMode,
  certified,
  maxLoad,
  requiredLoad,
  cost,
  maximumCost,
  seed,
  generatorVersion,
  physicsVersion,
}) {
  const normalizedCost = Math.round(Number(cost));
  const normalizedMaximumCost = Math.round(Number(maximumCost));
  const normalizedLoad = Math.round(Number(maxLoad));
  const normalizedRequiredLoad = Math.round(Number(requiredLoad));
  if (
    gameMode !== "challenge" ||
    certified !== true ||
    !validSeed(seed) ||
    !validVersion(generatorVersion) ||
    !validVersion(physicsVersion) ||
    !Number.isFinite(normalizedLoad) ||
    !Number.isFinite(normalizedRequiredLoad) ||
    normalizedRequiredLoad <= 0 ||
    normalizedLoad < normalizedRequiredLoad ||
    !Number.isFinite(normalizedCost) ||
    normalizedCost <= 0 ||
    !Number.isFinite(normalizedMaximumCost) ||
    normalizedMaximumCost < 0 ||
    normalizedCost > normalizedMaximumCost
  ) {
    return null;
  }
  return {
    seed,
    cost: normalizedCost,
    requiredLoad: normalizedRequiredLoad,
    maxLoad: normalizedLoad,
    generatorVersion,
    physicsVersion,
  };
}

export function capacityEventPath(record) {
  const normalized = normalizeCapacityRecord(record);
  return [
    CAPACITY_EVENT_PREFIX,
    CAPACITY_EVENT_VERSION,
    normalized.generatorVersion,
    normalized.physicsVersion,
    normalized.requiredLoad,
    normalized.seed,
    normalized.cost,
    normalized.maxLoad,
  ].join("/");
}

export function reportedCostKey(record) {
  const normalized = normalizeCostRecord(record);
  return [
    "bridgebuilder",
    "reported-cost",
    COST_EVENT_VERSION,
    normalized.generatorVersion,
    normalized.physicsVersion,
    normalized.requiredLoad,
    normalized.seed,
  ].join(":");
}

export function reportedCapacityKey(record) {
  const normalized = normalizeCapacityRecord(record);
  return [
    "bridgebuilder",
    "reported-capacity",
    CAPACITY_EVENT_VERSION,
    normalized.generatorVersion,
    normalized.physicsVersion,
    normalized.requiredLoad,
    normalized.seed,
  ].join(":");
}

export function submitCostScore(record, options = {}) {
  let normalized;
  try {
    normalized = normalizeCostRecord(record);
  } catch {
    return false;
  }

  const providedOptions =
    options && typeof options === "object" ? options : {};
  const counter = Object.prototype.hasOwnProperty.call(providedOptions, "counter")
    ? providedOptions.counter
    : globalThis.goatcounter;
  let storage = providedOptions.storage;
  if (!Object.prototype.hasOwnProperty.call(providedOptions, "storage")) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }
  const key = reportedCostKey(normalized);
  const previous = Math.min(
    sessionReportedCosts.get(key) ?? Number.POSITIVE_INFINITY,
    readStoredCost(storage, key),
  );
  if (normalized.cost >= previous || typeof counter?.count !== "function") {
    return false;
  }

  try {
    counter.count({
      path: costEventPath(normalized),
      title: `${normalized.seed}: cost ${normalized.cost}`,
      event: true,
    });
  } catch {
    return false;
  }

  sessionReportedCosts.set(key, normalized.cost);
  try {
    storage?.setItem(key, String(normalized.cost));
  } catch {
    // In-memory deduplication still applies when browser storage is unavailable.
  }
  return true;
}

export function submitCapacityScore(record, options = {}) {
  let normalized;
  try {
    normalized = normalizeCapacityRecord(record);
  } catch {
    return false;
  }

  const providedOptions =
    options && typeof options === "object" ? options : {};
  const counter = Object.prototype.hasOwnProperty.call(providedOptions, "counter")
    ? providedOptions.counter
    : globalThis.goatcounter;
  let storage = providedOptions.storage;
  if (!Object.prototype.hasOwnProperty.call(providedOptions, "storage")) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }

  const key = reportedCapacityKey(normalized);
  const previous = mergeCapacityProgress(
    sessionReportedCapacities.get(key),
    readStoredCapacity(storage, key),
  );
  if (!capacityImproves(normalized, previous) || typeof counter?.count !== "function") {
    return false;
  }

  try {
    counter.count({
      path: capacityEventPath(normalized),
      title: `${normalized.seed}: load ${normalized.maxLoad} at cost ${normalized.cost}`,
      event: true,
    });
  } catch {
    return false;
  }

  const next = improvedCapacityProgress(normalized, previous);
  sessionReportedCapacities.set(key, next);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // In-memory deduplication still applies when browser storage is unavailable.
  }
  return true;
}

export async function fetchLeaderboard({
  url = LEADERBOARD_URL,
  generatorVersion,
  physicsVersion,
  fetchImpl = globalThis.fetch,
  timeoutMs = 4500,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Leaderboard request is unavailable");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestUrl = new URL(url, globalThis.location?.href);
    requestUrl.searchParams.set("updated", String(Date.now()));
    const response = await fetchImpl(requestUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`Leaderboard request failed (${response?.status ?? "unknown"})`);
    }
    return validateLeaderboard(
      await response.json(),
      generatorVersion,
      physicsVersion,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function validateLeaderboard(data, generatorVersion, physicsVersion) {
  if (
    !data ||
    data.schemaVersion !== LEADERBOARD_SCHEMA_VERSION ||
    data.generatorVersion !== generatorVersion ||
    data.physicsVersion !== physicsVersion ||
    !Array.isArray(data.entries)
  ) {
    throw new Error("Leaderboard data is incompatible");
  }

  const generatedAt =
    data.generatedAt === null ? null : new Date(data.generatedAt);
  if (generatedAt && Number.isNaN(generatedAt.getTime())) {
    throw new Error("Leaderboard date is invalid");
  }

  const bestBySeed = new Map();
  for (const entry of data.entries) {
    const highestLoad = entry?.highestLoad ?? null;
    const loadPerCost = entry?.loadPerCost ?? null;
    if (
      !validSeed(entry?.seed) ||
      !Number.isInteger(entry?.cost) ||
      entry.cost < 0 ||
      !Number.isInteger(entry?.requiredLoad) ||
      entry.requiredLoad <= 0 ||
      !(
        highestLoad === null ||
        (Number.isInteger(highestLoad) && highestLoad >= entry.requiredLoad)
      ) ||
      !(
        loadPerCost === null ||
        (Number.isFinite(loadPerCost) && loadPerCost > 0)
      ) ||
      (highestLoad === null) !== (loadPerCost === null)
    ) {
      throw new Error("Leaderboard entry is invalid");
    }
    const previous = bestBySeed.get(entry.seed);
    if (!previous) {
      bestBySeed.set(entry.seed, {
        seed: entry.seed,
        cost: entry.cost,
        requiredLoad: entry.requiredLoad,
        highestLoad,
        loadPerCost,
      });
      continue;
    }
    if (entry.cost < previous.cost) {
      previous.cost = entry.cost;
      previous.requiredLoad = entry.requiredLoad;
    }
    if (highestLoad !== null) {
      previous.highestLoad = Math.max(previous.highestLoad ?? 0, highestLoad);
      previous.loadPerCost = Math.max(previous.loadPerCost ?? 0, loadPerCost);
    }
  }

  const entries = [...bestBySeed.values()]
    .sort(
      (first, second) =>
        first.cost - second.cost ||
        (first.seed < second.seed ? -1 : first.seed > second.seed ? 1 : 0),
    )
    .slice(0, MAX_LEADERBOARD_ENTRIES);
  return {
    schemaVersion: LEADERBOARD_SCHEMA_VERSION,
    generatedAt: generatedAt?.toISOString() ?? null,
    generatorVersion,
    physicsVersion,
    entries,
  };
}

export function challengeSeedUrl(seed, baseUrl = globalThis.location?.href) {
  if (!validSeed(seed)) {
    throw new Error("Leaderboard seed is invalid");
  }
  const url = new URL(baseUrl);
  url.searchParams.set("seed", seed);
  url.searchParams.delete("mode");
  url.hash = "";
  return url.toString();
}

function normalizeCostRecord(record) {
  const cost = Number(record?.cost);
  const requiredLoad = Number(record?.requiredLoad);
  if (
    !validSeed(record?.seed) ||
    !validVersion(record?.generatorVersion) ||
    !validVersion(record?.physicsVersion) ||
    !Number.isInteger(cost) ||
    cost < 0 ||
    !Number.isInteger(requiredLoad) ||
    requiredLoad <= 0
  ) {
    throw new Error("Cost record is invalid");
  }
  return {
    seed: record.seed,
    cost,
    requiredLoad,
    generatorVersion: record.generatorVersion,
    physicsVersion: record.physicsVersion,
  };
}

function normalizeCapacityRecord(record) {
  const cost = Number(record?.cost);
  const requiredLoad = Number(record?.requiredLoad);
  const maxLoad = Number(record?.maxLoad);
  if (
    !validSeed(record?.seed) ||
    !validVersion(record?.generatorVersion) ||
    !validVersion(record?.physicsVersion) ||
    !Number.isInteger(cost) ||
    cost <= 0 ||
    !Number.isInteger(requiredLoad) ||
    requiredLoad <= 0 ||
    !Number.isInteger(maxLoad) ||
    maxLoad < requiredLoad
  ) {
    throw new Error("Capacity record is invalid");
  }
  return {
    seed: record.seed,
    cost,
    requiredLoad,
    maxLoad,
    generatorVersion: record.generatorVersion,
    physicsVersion: record.physicsVersion,
  };
}

function readStoredCost(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined || raw === "") {
      return Number.POSITIVE_INFINITY;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0
      ? value
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readStoredCapacity(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      !value ||
      !Number.isInteger(value.maxLoad) ||
      value.maxLoad <= 0 ||
      !Number.isInteger(value.efficiencyLoad) ||
      value.efficiencyLoad <= 0 ||
      !Number.isInteger(value.efficiencyCost) ||
      value.efficiencyCost <= 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function mergeCapacityProgress(first, second) {
  if (!first) {
    return second ?? null;
  }
  if (!second) {
    return first;
  }
  const efficiency =
    compareEfficiency(
      first.efficiencyLoad,
      first.efficiencyCost,
      second.efficiencyLoad,
      second.efficiencyCost,
    ) >= 0
      ? first
      : second;
  return {
    maxLoad: Math.max(first.maxLoad, second.maxLoad),
    efficiencyLoad: efficiency.efficiencyLoad,
    efficiencyCost: efficiency.efficiencyCost,
  };
}

function capacityImproves(record, previous) {
  return (
    !previous ||
    record.maxLoad > previous.maxLoad ||
    compareEfficiency(
      record.maxLoad,
      record.cost,
      previous.efficiencyLoad,
      previous.efficiencyCost,
    ) > 0
  );
}

function improvedCapacityProgress(record, previous) {
  const improvesEfficiency =
    !previous ||
    compareEfficiency(
      record.maxLoad,
      record.cost,
      previous.efficiencyLoad,
      previous.efficiencyCost,
    ) > 0;
  return {
    maxLoad: Math.max(previous?.maxLoad ?? 0, record.maxLoad),
    efficiencyLoad: improvesEfficiency
      ? record.maxLoad
      : previous.efficiencyLoad,
    efficiencyCost: improvesEfficiency
      ? record.cost
      : previous.efficiencyCost,
  };
}

function compareEfficiency(firstLoad, firstCost, secondLoad, secondCost) {
  return firstLoad * secondCost - secondLoad * firstCost;
}

function validSeed(seed) {
  return typeof seed === "string" && SEED_PATTERN.test(seed);
}

function validVersion(version) {
  return typeof version === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(version);
}
