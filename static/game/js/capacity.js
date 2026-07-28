import { BridgeSimulation, SIMULATION_DT } from "./physics.js?v=challenge3";

const DEFAULT_RESOLUTION = 50;
const DEFAULT_MAX_SECONDS = 45;

export function runTrial(level, graph, load, options = {}) {
  const runner = new TrialRunner(level, graph, load, options);
  while (!runner.done) {
    runner.tick();
  }
  return runner.result;
}

export class CapacitySearch {
  constructor(level, graph, options = {}) {
    this.level = level;
    this.graph = cloneGraph(graph);
    this.resolution = positiveIncrement(options.resolution ?? DEFAULT_RESOLUTION);
    this.startLoad = roundToIncrement(
      options.startLoad ?? level.challenge?.ratedLoad ?? this.resolution,
      this.resolution,
    );
    this.maxLoad = Math.max(
      this.startLoad,
      roundDownToIncrement(
        options.maxLoad ?? this.startLoad * (options.maxMultiplier ?? 64),
        this.resolution,
      ),
    );
    this.maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS;
    this.phase = "bracket";
    this.currentLoad = this.startLoad;
    this.candidateLoad = this.startLoad;
    this.runner = null;
    this.low = null;
    this.high = null;
    this.lowResult = null;
    this.highResult = null;
    this.testedLoads = [];
    this.done = false;
    this.cancelled = false;
    this.result = null;
    this.progress = {
      phase: this.phase,
      candidateLoad: this.currentLoad,
      testedCount: 0,
      trialProgress: 0,
    };
  }

  advance(workBudgetMs = 6) {
    if (this.done) {
      return this.state();
    }
    const started = performance.now();
    const budget = Math.max(0.25, Number(workBudgetMs) || 0.25);

    while (!this.done && performance.now() - started < budget) {
      if (!this.runner) {
        this.runner = new TrialRunner(this.level, this.graph, this.currentLoad, {
          maxSeconds: this.maxSeconds,
        });
      }
      this.runner.tick();
      this.updateProgress();
      if (this.runner.done) {
        const trialResult = this.runner.result;
        this.runner = null;
        this.acceptTrial(trialResult);
      }
    }
    return this.state();
  }

  cancel() {
    if (this.done) {
      return;
    }
    this.cancelled = true;
    this.done = true;
    this.runner = null;
    this.result = {
      cancelled: true,
      certified: false,
      maxLoad: this.low ?? 0,
      failingLoad: this.high,
      testedLoads: [...this.testedLoads],
    };
    this.updateProgress();
  }

  state() {
    return {
      done: this.done,
      result: this.result,
      progress: { ...this.progress },
    };
  }

  acceptTrial(trialResult) {
    const load = this.currentLoad;
    if (trialResult.status === "indeterminate") {
      this.testedLoads.push({ load, passed: false, result: trialResult });
      this.finish({
        maxLoad: this.low ?? 0,
        failingLoad: null,
        passResult: this.lowResult,
        failResult: null,
        error: `Trial at ${load} did not complete`,
      });
      return;
    }
    const passed = trialResult.status === "won";
    this.testedLoads.push({ load, passed, result: trialResult });

    if (this.phase === "bracket") {
      if (!passed) {
        this.high = load;
        this.highResult = trialResult;
        if (this.low === null) {
          this.finish({
            maxLoad: 0,
            failingLoad: load,
            passResult: null,
            failResult: trialResult,
          });
          return;
        }
        this.beginBinaryOrVerification();
        return;
      }

      this.low = load;
      this.lowResult = trialResult;
      if (load >= this.maxLoad) {
        this.phase = "verify-pass";
        this.currentLoad = load;
        return;
      }
      const doubled = Math.max(load + this.resolution, load * 2);
      this.currentLoad = Math.min(
        this.maxLoad,
        roundDownToIncrement(doubled, this.resolution),
      );
      this.candidateLoad = this.currentLoad;
      return;
    }

    if (this.phase === "binary") {
      if (passed) {
        this.low = load;
        this.lowResult = trialResult;
      } else {
        this.high = load;
        this.highResult = trialResult;
      }
      this.beginBinaryOrVerification();
      return;
    }

    if (this.phase === "verify-pass") {
      if (!passed) {
        this.finish({
          maxLoad: 0,
          failingLoad: load,
          passResult: null,
          failResult: trialResult,
          error: "Passing boundary was not repeatable",
        });
        return;
      }
      this.low = load;
      this.lowResult = trialResult;
      if (this.high === null) {
        this.finish({
          maxLoad: load,
          failingLoad: null,
          passResult: trialResult,
          failResult: null,
          capReached: true,
        });
        return;
      }
      this.phase = "verify-fail";
      this.currentLoad = this.high;
      this.candidateLoad = this.currentLoad;
      return;
    }

    if (this.phase === "verify-fail") {
      if (passed) {
        this.finish({
          maxLoad: this.low ?? 0,
          failingLoad: null,
          passResult: this.lowResult,
          failResult: null,
          error: "Failure boundary was not monotonic",
        });
        return;
      }
      this.finish({
        maxLoad: this.low,
        failingLoad: this.high,
        passResult: this.lowResult,
        failResult: trialResult,
      });
    }
  }

  beginBinaryOrVerification() {
    if (this.high - this.low <= this.resolution) {
      this.phase = "verify-pass";
      this.currentLoad = this.low;
      this.candidateLoad = this.currentLoad;
      return;
    }

    this.phase = "binary";
    let midpoint = roundDownToIncrement((this.low + this.high) / 2, this.resolution);
    if (midpoint <= this.low) {
      midpoint = this.low + this.resolution;
    }
    this.currentLoad = midpoint;
    this.candidateLoad = midpoint;
  }

  finish(partialResult) {
    this.done = true;
    this.phase = "done";
    this.result = {
      cancelled: false,
      certified:
        !partialResult.error &&
        partialResult.passResult?.status === "won" &&
        (partialResult.capReached || partialResult.failResult?.status === "lost"),
      resolution: this.resolution,
      testedLoads: [...this.testedLoads],
      ...partialResult,
    };
    this.updateProgress();
  }

  updateProgress() {
    this.candidateLoad = this.currentLoad;
    this.progress = {
      phase: this.phase,
      candidateLoad: this.currentLoad,
      testedCount: this.testedLoads.length,
      trialProgress: this.runner?.progress ?? (this.done ? 1 : 0),
      lowerBound: this.low,
      upperBound: this.high,
    };
  }
}

class TrialRunner {
  constructor(level, graph, load, options = {}) {
    this.simulation = new BridgeSimulation(level, cloneGraph(graph), { load });
    this.maxTicks = Math.max(
      1,
      Math.round((options.maxSeconds ?? DEFAULT_MAX_SECONDS) / SIMULATION_DT),
    );
    this.done = false;
    this.result = null;
  }

  get progress() {
    return Math.min(1, this.simulation.tickCount / this.maxTicks);
  }

  tick() {
    if (this.done) {
      return;
    }
    this.simulation.tick();
    if (this.simulation.status !== "running") {
      this.done = true;
      this.result = this.simulation.result();
      return;
    }
    if (this.simulation.tickCount >= this.maxTicks) {
      this.done = true;
      this.result = {
        ...this.simulation.result(),
        status: "indeterminate",
        reason: "Test timed out",
        message: "Test timed out",
        completionTick: this.simulation.tickCount,
        timedOut: true,
      };
    }
  }
}

function cloneGraph(graph) {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    beams: graph.beams.map((beam) => ({ ...beam })),
  };
}

function positiveIncrement(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : DEFAULT_RESOLUTION;
}

function roundToIncrement(value, increment) {
  return Math.max(increment, Math.round(Number(value) / increment) * increment);
}

function roundDownToIncrement(value, increment) {
  return Math.max(increment, Math.floor(Number(value) / increment) * increment);
}
