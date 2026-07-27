import { clamp } from "./ui.js?v=challenge2";

const NODE_RADIUS = 12;
const BEAM_PICK_DISTANCE = 18;
const BEAM_SPLIT_MIN_DISTANCE = 14;
const NODE_MERGE_DISTANCE = 5;
const SEGMENT_EPSILON = 0.001;

export class BridgeEditor {
  constructor(level) {
    this.level = level;
    this.enforceBudget = true;
    this.nodes = [];
    this.beams = [];
    this.selectedNode = null;
    this.pointer = null;
    this.hoverNode = null;
    this.hoverBeam = null;
    this.history = [];
    this.redoHistory = [];
    this.message = "";
    this.messageUntil = 0;
    this.reset({ remember: false, silent: true });
  }

  reset({ remember = true, silent = false } = {}) {
    if (remember && this.hasUserStructure()) {
      this.remember();
    }

    this.nodes = this.level.anchors.map((anchor) => ({
      x: anchor.x,
      y: anchor.y,
      fixed: true,
    }));
    this.beams = [];
    this.selectedNode = null;
    this.pointer = null;
    this.hoverNode = null;
    this.hoverBeam = null;
    if (!remember) {
      this.history = [];
      this.redoHistory = [];
    }
    if (!silent) {
      this.setMessage(remember ? "Bridge cleared" : "Bridge restored");
    }
  }

  setBudgetEnforced(enforced) {
    this.enforceBudget = Boolean(enforced);
    return this.enforceBudget;
  }

  hasUserStructure() {
    return this.beams.length > 0 || this.nodes.some((node) => !node.fixed);
  }

  snapshot() {
    return {
      nodes: this.nodes.map((node) => ({ ...node })),
      beams: this.beams.map((beam) => ({ ...beam })),
    };
  }

  totalCost() {
    const nodeCost = this.level.costs.node;
    const beamCost = this.level.costs.beamPerPixel;
    const movableNodes = this.nodes.filter((node) => !node.fixed).length;
    const beamTotal = this.beams.reduce((total, beam) => {
      return total + distance(this.nodes[beam.a], this.nodes[beam.b]) * beamCost;
    }, 0);
    return movableNodes * nodeCost + beamTotal;
  }

  remainingBudget(previewCost = 0) {
    return this.level.budget - this.totalCost() - previewCost;
  }

  canUndo() {
    return this.history.length > 0;
  }

  canRedo() {
    return this.redoHistory.length > 0;
  }

  currentMessage(now = performance.now()) {
    return now < this.messageUntil ? this.message : "";
  }

  helpText() {
    const undo = this.undoHint();
    if (this.selectedNode !== null) {
      const selected = this.nodes[this.selectedNode];
      const kind = selected.fixed ? "anchor" : "node";
      return {
        primary: `Building from ${kind}: LMB target places beam`,
        secondary: `RMB, Esc, or Delete cancels | R resets | Space tests${undo}`,
      };
    }

    if (this.hoverNode) {
      const node = this.nodes[this.hoverNode.index];
      return {
        primary: node.fixed ? "LMB anchor starts beam" : "LMB node starts beam",
        secondary: node.fixed
          ? `Anchors are fixed | R resets | Space tests${undo}`
          : `RMB or Delete removes node | R resets | Space tests${undo}`,
      };
    }

    if (this.hoverBeam) {
      return {
        primary: "LMB splits hovered beam",
        secondary: `RMB or Delete removes hovered beam | Space tests${undo}`,
      };
    }

    return {
      primary: "LMB grid places node | LMB dot starts beam",
      secondary: `RMB deletes hovered part | Space tests | G random seed${undo}`,
    };
  }

  undoHint() {
    const hints = [];
    if (this.canUndo()) {
      hints.push("Z undo");
    }
    if (this.canRedo()) {
      hints.push("Y redo");
    }
    return hints.length ? ` | ${hints.join(" | ")}` : "";
  }

  setPointer(rawPoint) {
    if (!rawPoint) {
      this.pointer = null;
      this.hoverNode = null;
      this.hoverBeam = null;
      return;
    }

    this.hoverNode = this.findNode(rawPoint, NODE_RADIUS);
    this.hoverBeam = this.hoverNode ? null : this.findBeam(rawPoint);
    this.pointer = this.hoverBeam ? this.hoverBeam.point : this.snapPoint(rawPoint);
  }

  previewBeam() {
    if (this.selectedNode === null || !this.pointer) {
      return null;
    }

    const from = this.nodes[this.selectedNode];
    const hover = this.hoverNode ? this.nodes[this.hoverNode.index] : this.pointer;
    const length = distance(from, hover);
    const splitBeam = !this.hoverNode && this.hoverBeam ? this.beams[this.hoverBeam.index] : null;
    const connectsThroughSplit =
      splitBeam && (splitBeam.a === this.selectedNode || splitBeam.b === this.selectedNode);
    const targetNode = this.hoverNode?.index ?? null;
    const existing = this.hoverNode
      ? this.beams.some((beam) => sameBeam(beam, this.selectedNode, targetNode))
      : false;
    const plan = connectsThroughSplit
      ? { cost: 0, crossings: [] }
      : this.planBeamPath(this.selectedNode, hover, {
          ignoredBeamIndex: splitBeam ? this.hoverBeam.index : null,
          targetNode,
        });
    const nodeCost = targetNode === null ? this.level.costs.node : 0;
    const cost = nodeCost + plan.cost;
    const reason = this.previewReason(length, existing, cost, from, hover, targetNode === null);
    const splitPoints = splitBeam ? [hover] : [];
    splitPoints.push(...plan.crossings.map((crossing) => crossing.point));

    return {
      from,
      to: hover,
      length,
      deck: this.isDeckBeam(from, hover),
      split: splitPoints.length > 0,
      splitPoints,
      valid: reason === "",
      reason,
      cost,
      projectedCost: this.totalCost() + cost,
      remainingBudget: this.remainingBudget(cost),
    };
  }

  previewReason(length, existing, cost, from, to, createsNode = true) {
    if (length < 8) {
      return "too short";
    }
    if (existing) {
      return "already built";
    }
    const placementReason = createsNode ? this.placementReason(to) : "";
    if (placementReason) {
      return placementReason;
    }
    const beamReason = this.beamPlacementReason(from, to);
    if (beamReason) {
      return beamReason;
    }
    if (this.wouldExceedBudget(cost)) {
      return "over budget";
    }
    return "";
  }

  handleLeftClick(rawPoint) {
    const point = this.snapPoint(rawPoint);
    const nearestNode = this.findNode(rawPoint);

    if (nearestNode) {
      this.handleNodeClick(nearestNode.index);
      return;
    }

    const nearestBeam = this.findBeam(rawPoint) || this.findBeam(point);
    if (nearestBeam) {
      this.handleBeamClick(nearestBeam);
      return;
    }

    this.handleEmptyClick(point);
  }

  handleRightClick(point) {
    if (this.selectedNode !== null) {
      this.cancelSelection();
      return;
    }

    const nearestNode = this.findNode(point, 9);
    const nearestBeam = this.findBeam(point);

    if (nearestNode && (!nearestBeam || nearestNode.distance <= nearestBeam.distance)) {
      this.deleteNode(nearestNode.index);
      return;
    }

    if (nearestBeam) {
      this.deleteBeam(nearestBeam.index);
      return;
    }

    this.setMessage("Nothing selected");
  }

  deleteHovered() {
    if (this.selectedNode !== null) {
      this.cancelSelection();
      return;
    }

    if (this.hoverNode) {
      this.deleteNode(this.hoverNode.index);
      return;
    }

    if (this.hoverBeam) {
      this.deleteBeam(this.hoverBeam.index);
      return;
    }

    this.setMessage("Nothing selected");
  }

  deleteSelectionOrHovered() {
    if (this.selectedNode !== null) {
      const selected = this.selectedNode;
      if (this.nodes[selected]?.fixed) {
        this.cancelSelection();
      } else {
        this.deleteNode(selected);
      }
      return;
    }
    this.deleteHovered();
  }

  cancelSelection() {
    this.selectedNode = null;
    this.setMessage("Build cancelled");
  }

  handleNodeClick(index) {
    if (this.selectedNode === null) {
      this.selectedNode = index;
      this.setMessage("Choose beam end");
      return;
    }

    if (this.selectedNode === index) {
      this.setMessage("Right click cancels");
      return;
    }

    if (this.addBeam(this.selectedNode, index)) {
      this.selectedNode = index;
    }
  }

  handleEmptyClick(point) {
    const blockedReason = this.placementReason(point);
    if (blockedReason) {
      this.setMessage(blockedReason);
      return;
    }

    const newNodeCost = this.level.costs.node;
    let extraCost = newNodeCost;

    if (this.selectedNode !== null) {
      const selected = this.nodes[this.selectedNode];
      const beamLength = distance(selected, point);
      if (!this.canCreateBeamLength(beamLength)) {
        return;
      }
      const beamReason = this.beamPlacementReason(selected, point);
      if (beamReason) {
        this.setMessage(beamReason);
        return;
      }
      extraCost += this.planBeamPath(this.selectedNode, point).cost;
    }

    if (this.wouldExceedBudget(extraCost)) {
      this.setMessage("Budget exceeded");
      return;
    }

    this.remember();
    const newIndex = this.nodes.length;
    this.nodes.push({
      x: point.x,
      y: point.y,
      fixed: false,
    });

    if (this.selectedNode !== null) {
      const plan = this.planBeamPath(this.selectedNode, point, { targetNode: newIndex });
      this.applyBeamPathPlan(this.selectedNode, newIndex, plan);
    }

    this.selectedNode = newIndex;
    this.setMessage("Node placed");
  }

  handleBeamClick(beamHit) {
    const beam = this.beams[beamHit.index];
    if (!beam || !this.canSplitBeam(beamHit, beam)) {
      return;
    }

    const selected = this.selectedNode;
    const shouldConnect = selected !== null && selected !== beam.a && selected !== beam.b;
    const splitCost = this.level.costs.node;
    const connectPlan = shouldConnect
      ? this.planBeamPath(selected, beamHit.point, { ignoredBeamIndex: beamHit.index })
      : null;
    const connectCost = connectPlan ? connectPlan.cost : 0;

    if (
      shouldConnect &&
      this.beamPlacementReason(this.nodes[selected], beamHit.point)
    ) {
      this.setMessage(this.beamPlacementReason(this.nodes[selected], beamHit.point));
      return;
    }

    if (this.wouldExceedBudget(splitCost + connectCost)) {
      this.setMessage("Budget exceeded");
      return;
    }

    this.remember();
    const newIndex = this.splitBeam(beamHit.index, beamHit.point);

    if (shouldConnect) {
      const plan = this.planBeamPath(selected, this.nodes[newIndex], { targetNode: newIndex });
      this.applyBeamPathPlan(selected, newIndex, plan);
    }

    this.selectedNode = newIndex;
    this.setMessage(shouldConnect ? "Beam split and connected" : "Beam split");
  }

  addBeam(a, b) {
    if (this.beams.some((beam) => sameBeam(beam, a, b))) {
      this.setMessage("Beam already exists");
      return false;
    }

    const beamLength = distance(this.nodes[a], this.nodes[b]);
    if (!this.canCreateBeamLength(beamLength)) {
      return false;
    }

    const beamReason = this.beamPlacementReason(this.nodes[a], this.nodes[b]);
    if (beamReason) {
      this.setMessage(beamReason);
      return false;
    }

    const plan = this.planBeamPath(a, this.nodes[b], { targetNode: b });
    const extraCost = plan.cost;
    if (this.wouldExceedBudget(extraCost)) {
      this.setMessage("Budget exceeded");
      return false;
    }

    this.remember();
    this.applyBeamPathPlan(a, b, plan);
    return true;
  }

  planBeamPath(a, to, options = {}) {
    const from = this.nodes[a];
    const ignoredBeamIndexes = new Set(options.ignoredBeamIndexes ?? []);
    if (options.ignoredBeamIndex !== null && options.ignoredBeamIndex !== undefined) {
      ignoredBeamIndexes.add(options.ignoredBeamIndex);
    }

    const crossings = [];
    for (let index = 0; index < this.beams.length; index += 1) {
      if (ignoredBeamIndexes.has(index)) {
        continue;
      }

      const beam = this.beams[index];
      const intersection = segmentIntersection(from, to, this.nodes[beam.a], this.nodes[beam.b]);
      if (!intersection || !isInteriorIntersection(intersection)) {
        continue;
      }

      if (!this.isSplitPointInsideBeam(intersection.point, beam)) {
        continue;
      }

      const existingNode = this.findNode(intersection.point, NODE_MERGE_DISTANCE);
      crossings.push({
        point: existingNode ? this.nodes[existingNode.index] : intersection.point,
        t: intersection.t,
        nodeIndex: existingNode?.index ?? null,
        beamIndexes: [index],
      });
    }

    for (let index = 0; index < this.nodes.length; index += 1) {
      if (index === a || index === options.targetNode) {
        continue;
      }

      const node = this.nodes[index];
      const projection = closestPointOnSegment(node, from, to);
      if (projection.t <= SEGMENT_EPSILON || projection.t >= 1 - SEGMENT_EPSILON) {
        continue;
      }

      if (projection.distance <= NODE_MERGE_DISTANCE) {
        crossings.push({
          point: node,
          t: projection.t,
          nodeIndex: index,
          beamIndexes: [],
        });
      }
    }

    const mergedCrossings = mergeCrossings(crossings);
    const addedNodes = mergedCrossings.filter((crossing) => crossing.nodeIndex === null).length;
    return {
      crossings: mergedCrossings,
      cost: distance(from, to) * this.level.costs.beamPerPixel + addedNodes * this.level.costs.node,
    };
  }

  applyBeamPathPlan(a, b, plan) {
    for (const crossing of plan.crossings) {
      if (crossing.nodeIndex === null) {
        crossing.nodeIndex = this.nodes.length;
        this.nodes.push({
          x: crossing.point.x,
          y: crossing.point.y,
          fixed: false,
        });
      }
    }

    const splitKeys = new Set();
    const splits = [];
    for (const crossing of plan.crossings) {
      for (const beamIndex of crossing.beamIndexes) {
        const key = `${beamIndex}:${crossing.nodeIndex}`;
        if (!splitKeys.has(key)) {
          splitKeys.add(key);
          splits.push({ beamIndex, nodeIndex: crossing.nodeIndex });
        }
      }
    }

    splits
      .sort((first, second) => second.beamIndex - first.beamIndex)
      .forEach((split) => this.splitBeamAtNode(split.beamIndex, split.nodeIndex));

    const path = [a, ...plan.crossings.map((crossing) => crossing.nodeIndex), b];
    for (const nodeIndex of path) {
      this.splitBeamsContainingNode(nodeIndex);
    }

    for (let index = 0; index < path.length - 1; index += 1) {
      this.addBeamSegment(path[index], path[index + 1]);
    }
  }

  createBeam(a, b) {
    return {
      a,
      b,
      deck: this.isDeckBeam(this.nodes[a], this.nodes[b]),
    };
  }

  isDeckBeam(a, b) {
    const roadY = this.level.roadY;
    const tolerance = this.level.deckTolerance;
    const maxSlope = this.level.maxDeckSlope;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);

    if (dx < 12) {
      return false;
    }

    return Math.abs(a.y - roadY) <= tolerance && Math.abs(b.y - roadY) <= tolerance && dy / dx <= maxSlope;
  }

  canCreateBeamLength(beamLength) {
    if (beamLength < 8) {
      this.setMessage("Beam too short");
      return false;
    }

    return true;
  }

  wouldExceedBudget(extraCost = 0) {
    return this.enforceBudget && this.totalCost() + extraCost > this.level.budget + SEGMENT_EPSILON;
  }

  placementReason(point) {
    if (!isFinitePoint(point)) {
      return "invalid position";
    }
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x > this.level.canvas.width ||
      point.y > this.level.canvas.height
    ) {
      return "outside build area";
    }

    const exclusion = (this.level.buildExclusions ?? []).find((shape) => {
      return shapeContainsPoint(shape, point, true);
    });
    if (exclusion) {
      return exclusion.reason || exclusionLabel(exclusion);
    }

    const terrain = (this.level.terrain ?? []).find((shape) => {
      return shape.collidable !== false && shapeContainsPoint(shape, point, false);
    });
    return terrain ? "inside terrain" : "";
  }

  beamPlacementReason(from, to) {
    if (!isFinitePoint(from) || !isFinitePoint(to)) {
      return "invalid beam";
    }

    const physicalExclusions = [
      ...(this.level.buildExclusions ?? []),
      ...(this.level.buildExclusions?.length ? [] : this.level.terrain ?? []),
    ];
    const blocked = physicalExclusions.find((shape) => {
      return shape.collidable !== false && segmentEntersShape(from, to, shape);
    });
    if (blocked) {
      return blocked.reason || exclusionLabel(blocked);
    }

    const clearance = (this.level.navigationClearances ?? []).find((shape) => {
      return segmentEntersShape(from, to, shape);
    });
    return clearance ? clearance.reason || "vehicle clearance blocked" : "";
  }

  canSplitBeam(beamHit, beam) {
    if (!this.isSplitPointInsideBeam(beamHit.point, beam)) {
      this.setMessage("Too close to beam end");
      return false;
    }
    return true;
  }

  isSplitPointInsideBeam(point, beam) {
    const start = this.nodes[beam.a];
    const end = this.nodes[beam.b];
    return (
      distance(point, start) >= BEAM_SPLIT_MIN_DISTANCE &&
      distance(point, end) >= BEAM_SPLIT_MIN_DISTANCE
    );
  }

  splitBeam(index, point) {
    const newIndex = this.nodes.length;
    this.nodes.push({
      x: point.x,
      y: point.y,
      fixed: false,
    });
    this.splitBeamAtNode(index, newIndex);
    return newIndex;
  }

  splitBeamAtNode(index, nodeIndex) {
    const beam = this.beams[index];
    if (!beam || beam.a === nodeIndex || beam.b === nodeIndex) {
      return;
    }

    this.beams.splice(
      index,
      1,
      this.createBeam(beam.a, nodeIndex),
      this.createBeam(nodeIndex, beam.b),
    );
  }

  splitBeamsContainingNode(nodeIndex) {
    const node = this.nodes[nodeIndex];
    const containingBeamIndexes = [];

    for (let index = 0; index < this.beams.length; index += 1) {
      const beam = this.beams[index];
      if (beam.a === nodeIndex || beam.b === nodeIndex) {
        continue;
      }

      const projection = closestPointOnSegment(node, this.nodes[beam.a], this.nodes[beam.b]);
      if (
        projection.distance <= NODE_MERGE_DISTANCE &&
        projection.t > SEGMENT_EPSILON &&
        projection.t < 1 - SEGMENT_EPSILON &&
        this.isSplitPointInsideBeam(node, beam)
      ) {
        containingBeamIndexes.push(index);
      }
    }

    containingBeamIndexes
      .sort((first, second) => second - first)
      .forEach((index) => this.splitBeamAtNode(index, nodeIndex));
  }

  addBeamSegment(a, b) {
    if (a === b || distance(this.nodes[a], this.nodes[b]) < 8) {
      return;
    }

    if (!this.beams.some((beam) => sameBeam(beam, a, b))) {
      this.beams.push(this.createBeam(a, b));
    }
  }

  deleteNode(index) {
    if (!this.nodes[index]) {
      this.setMessage("Nothing selected");
      return;
    }
    if (this.nodes[index].fixed) {
      this.setMessage("Anchor nodes are fixed");
      return;
    }

    this.remember();
    this.nodes.splice(index, 1);
    this.beams = this.beams
      .filter((beam) => beam.a !== index && beam.b !== index)
      .map((beam) => ({
        a: beam.a > index ? beam.a - 1 : beam.a,
        b: beam.b > index ? beam.b - 1 : beam.b,
        deck: beam.deck,
      }));

    if (this.selectedNode === index) {
      this.selectedNode = null;
    } else if (this.selectedNode > index) {
      this.selectedNode -= 1;
    }

    this.setMessage("Node deleted");
  }

  deleteBeam(index) {
    if (!this.beams[index]) {
      this.setMessage("Nothing selected");
      return;
    }
    this.remember();
    this.beams.splice(index, 1);
    this.setMessage("Beam deleted");
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) {
      this.setMessage("Nothing to undo");
      return false;
    }

    this.redoHistory.push(this.historySnapshot());
    this.applyHistorySnapshot(previous);
    this.setMessage("Undo");
    return true;
  }

  redo() {
    const next = this.redoHistory.pop();
    if (!next) {
      this.setMessage("Nothing to redo");
      return false;
    }

    this.history.push(this.historySnapshot());
    this.applyHistorySnapshot(next);
    this.setMessage("Redo");
    return true;
  }

  remember() {
    this.history.push(this.historySnapshot());
    this.redoHistory = [];

    if (this.history.length > 100) {
      this.history.shift();
    }
  }

  historySnapshot() {
    return {
      nodes: this.nodes.map((node) => ({ ...node })),
      beams: this.beams.map((beam) => ({ ...beam })),
      selectedNode: this.selectedNode,
    };
  }

  applyHistorySnapshot(snapshot) {
    this.nodes = snapshot.nodes.map((node) => ({ ...node }));
    this.beams = snapshot.beams.map((beam) => ({ ...beam }));
    this.selectedNode = Number.isInteger(snapshot.selectedNode) ? snapshot.selectedNode : null;
    this.pointer = null;
    this.hoverNode = null;
    this.hoverBeam = null;
  }

  restore(snapshot, { remember = false, silent = false, allowOverBudget = false } = {}) {
    const validation = this.validateSnapshot(snapshot, { allowOverBudget });
    if (!validation.valid) {
      if (!silent) {
        this.setMessage(`Could not restore: ${validation.reason}`);
      }
      return false;
    }

    if (remember) {
      this.remember();
    } else {
      this.history = [];
      this.redoHistory = [];
    }

    this.nodes = validation.nodes;
    this.beams = validation.beams;
    this.selectedNode = null;
    this.pointer = null;
    this.hoverNode = null;
    this.hoverBeam = null;
    if (!silent) {
      this.setMessage("Bridge restored");
    }
    return true;
  }

  validateSnapshot(snapshot, { allowOverBudget = false } = {}) {
    if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.beams)) {
      return invalidSnapshot("invalid blueprint");
    }

    const anchors = this.level.anchors ?? [];
    if (snapshot.nodes.length < anchors.length || snapshot.nodes.length > 600) {
      return invalidSnapshot("invalid node count");
    }
    if (snapshot.beams.length > 1500) {
      return invalidSnapshot("too many beams");
    }

    const nodes = [];
    for (let index = 0; index < snapshot.nodes.length; index += 1) {
      const source = snapshot.nodes[index];
      if (!isFinitePoint(source)) {
        return invalidSnapshot("invalid node");
      }

      if (index < anchors.length) {
        const anchor = anchors[index];
        if (distance(source, anchor) > NODE_MERGE_DISTANCE) {
          return invalidSnapshot("anchors do not match this seed");
        }
        nodes.push({ x: anchor.x, y: anchor.y, fixed: true });
        continue;
      }

      const node = { x: Number(source.x), y: Number(source.y), fixed: false };
      const reason = this.placementReason(node);
      if (reason) {
        return invalidSnapshot(reason);
      }
      if (nodes.some((existing) => distance(existing, node) <= NODE_MERGE_DISTANCE)) {
        return invalidSnapshot("overlapping nodes");
      }
      nodes.push(node);
    }

    const beamKeys = new Set();
    const beams = [];
    for (const source of snapshot.beams) {
      const a = Number(source?.a);
      const b = Number(source?.b);
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= nodes.length ||
        b >= nodes.length ||
        a === b
      ) {
        return invalidSnapshot("invalid beam connection");
      }

      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (beamKeys.has(key) || distance(nodes[a], nodes[b]) < 8) {
        return invalidSnapshot(beamKeys.has(key) ? "duplicate beam" : "beam too short");
      }
      const reason = this.beamPlacementReason(nodes[a], nodes[b]);
      if (reason) {
        return invalidSnapshot(reason);
      }
      const passThroughNode = nodes.some((node, nodeIndex) => {
        if (nodeIndex === a || nodeIndex === b) {
          return false;
        }
        const projection = closestPointOnSegment(node, nodes[a], nodes[b]);
        return (
          projection.t > SEGMENT_EPSILON &&
          projection.t < 1 - SEGMENT_EPSILON &&
          projection.distance <= SEGMENT_EPSILON
        );
      });
      if (passThroughNode) {
        return invalidSnapshot("beam must be split at existing node");
      }
      const unsplitCrossing = beams.some((beam) => {
        if (
          beam.a === a ||
          beam.a === b ||
          beam.b === a ||
          beam.b === b
        ) {
          return false;
        }
        const intersection = segmentIntersection(
          nodes[a],
          nodes[b],
          nodes[beam.a],
          nodes[beam.b],
        );
        return intersection && isInteriorIntersection(intersection);
      });
      if (unsplitCrossing) {
        return invalidSnapshot("crossing beams must share a node");
      }

      beamKeys.add(key);
      beams.push({
        a,
        b,
        deck: this.isDeckBeam(nodes[a], nodes[b]),
      });
    }

    const cost = graphCost(nodes, beams, this.level.costs);
    if (!allowOverBudget && this.enforceBudget && cost > this.level.budget + SEGMENT_EPSILON) {
      return invalidSnapshot("over budget");
    }

    return { valid: true, nodes, beams, cost };
  }

  findNode(point, radius = NODE_RADIUS) {
    let best = null;
    for (let index = 0; index < this.nodes.length; index += 1) {
      const node = this.nodes[index];
      const nodeDistance = distance(point, node);
      if (nodeDistance <= radius && (!best || nodeDistance < best.distance)) {
        best = { index, distance: nodeDistance };
      }
    }
    return best;
  }

  findBeam(point) {
    let best = null;
    for (let index = 0; index < this.beams.length; index += 1) {
      const beam = this.beams[index];
      const projection = closestPointOnSegment(point, this.nodes[beam.a], this.nodes[beam.b]);
      if (projection.distance <= BEAM_PICK_DISTANCE && (!best || projection.distance < best.distance)) {
        best = { index, ...projection };
      }
    }
    return best;
  }

  snapPoint(point) {
    const snap = this.level.snap;
    return {
      x: clamp(Math.round(point.x / snap) * snap, 0, this.level.canvas.width),
      y: clamp(Math.round(point.y / snap) * snap, 0, this.level.canvas.height),
    };
  }

  setMessage(message) {
    this.message = message;
    this.messageUntil = performance.now() + 1400;
  }
}

function sameBeam(beam, a, b) {
  return (beam.a === a && beam.b === b) || (beam.a === b && beam.b === a);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mergeCrossings(crossings) {
  const merged = [];
  const sorted = [...crossings].sort((first, second) => first.t - second.t);

  for (const crossing of sorted) {
    const existing = merged.find((candidate) => {
      return (
        (candidate.nodeIndex !== null && candidate.nodeIndex === crossing.nodeIndex) ||
        distance(candidate.point, crossing.point) <= NODE_MERGE_DISTANCE
      );
    });

    if (!existing) {
      merged.push({
        point: { x: crossing.point.x, y: crossing.point.y },
        t: crossing.t,
        nodeIndex: crossing.nodeIndex,
        beamIndexes: [...crossing.beamIndexes],
      });
      continue;
    }

    existing.t = Math.min(existing.t, crossing.t);
    if (crossing.nodeIndex !== null) {
      existing.nodeIndex = crossing.nodeIndex;
      existing.point = { x: crossing.point.x, y: crossing.point.y };
    }
    for (const beamIndex of crossing.beamIndexes) {
      if (!existing.beamIndexes.includes(beamIndex)) {
        existing.beamIndexes.push(beamIndex);
      }
    }
  }

  return merged.sort((first, second) => first.t - second.t);
}

function isInteriorIntersection(intersection) {
  return (
    intersection.t > SEGMENT_EPSILON &&
    intersection.t < 1 - SEGMENT_EPSILON &&
    intersection.u > SEGMENT_EPSILON &&
    intersection.u < 1 - SEGMENT_EPSILON
  );
}

function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);

  if (Math.abs(denominator) < 0.000001) {
    return null;
  }

  const cMinusA = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;

  if (t < -SEGMENT_EPSILON || t > 1 + SEGMENT_EPSILON) {
    return null;
  }
  if (u < -SEGMENT_EPSILON || u > 1 + SEGMENT_EPSILON) {
    return null;
  }

  return {
    point: {
      x: a.x + t * r.x,
      y: a.y + t * r.y,
    },
    t: clamp(t, 0, 1),
    u: clamp(u, 0, 1),
  };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return {
      point: { x: a.x, y: a.y },
      t: 0,
      distance: distance(point, a),
    };
  }

  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  const projected = {
    x: a.x + t * dx,
    y: a.y + t * dy,
  };
  return {
    point: projected,
    t,
    distance: distance(point, projected),
  };
}

function invalidSnapshot(reason) {
  return { valid: false, reason };
}

function isFinitePoint(point) {
  return Boolean(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function graphCost(nodes, beams, costs) {
  const movableNodes = nodes.filter((node) => !node.fixed).length;
  const beamTotal = beams.reduce((total, beam) => {
    return total + distance(nodes[beam.a], nodes[beam.b]) * costs.beamPerPixel;
  }, 0);
  return movableNodes * costs.node + beamTotal;
}

function exclusionLabel(shape) {
  if (shape.kind === "water" || shape.type === "water") {
    return "underwater construction blocked";
  }
  if (shape.kind === "terrain" || shape.type === "terrain") {
    return "inside terrain";
  }
  if (shape.kind === "vehicle") {
    return "vehicle clearance blocked";
  }
  return "build area blocked";
}

function segmentEntersShape(from, to, shape) {
  const polygon = shape?.points;
  if (Array.isArray(polygon) && polygon.length >= 3) {
    for (let index = 0; index < polygon.length; index += 1) {
      const edgeStart = {
        x: Number(polygon[index][0]),
        y: Number(polygon[index][1]),
      };
      const next = polygon[(index + 1) % polygon.length];
      const edgeEnd = { x: Number(next[0]), y: Number(next[1]) };
      const intersection = segmentIntersection(from, to, edgeStart, edgeEnd);
      if (
        intersection &&
        intersection.t > SEGMENT_EPSILON &&
        intersection.t < 1 - SEGMENT_EPSILON
      ) {
        return true;
      }
    }
  }

  const length = distance(from, to);
  const steps = clamp(Math.ceil(length / 4), 2, 400);
  for (let index = 1; index < steps; index += 1) {
    const t = index / steps;
    const point = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    if (shapeContainsPoint(shape, point, false)) {
      return true;
    }
  }
  return false;
}

function shapeContainsPoint(shape, point, includeBoundary) {
  const points = shape?.points;
  if (Array.isArray(points) && points.length >= 3) {
    return pointInPolygon(point, points, includeBoundary);
  }

  const bounds = shape?.bounds ?? shape;
  if (
    Number.isFinite(Number(bounds?.x)) &&
    Number.isFinite(Number(bounds?.y)) &&
    Number.isFinite(Number(bounds?.width)) &&
    Number.isFinite(Number(bounds?.height))
  ) {
    const left = Number(bounds.x);
    const top = Number(bounds.y);
    const right = left + Number(bounds.width);
    const bottom = top + Number(bounds.height);
    return includeBoundary
      ? point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
      : point.x > left && point.x < right && point.y > top && point.y < bottom;
  }

  if (
    Number.isFinite(Number(bounds?.x1)) &&
    Number.isFinite(Number(bounds?.x2)) &&
    Number.isFinite(Number(bounds?.y1)) &&
    Number.isFinite(Number(bounds?.y2))
  ) {
    const left = Math.min(Number(bounds.x1), Number(bounds.x2));
    const right = Math.max(Number(bounds.x1), Number(bounds.x2));
    const top = Math.min(Number(bounds.y1), Number(bounds.y2));
    const bottom = Math.max(Number(bounds.y1), Number(bounds.y2));
    return includeBoundary
      ? point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
      : point.x > left && point.x < right && point.y > top && point.y < bottom;
  }

  if (
    Number.isFinite(Number(shape?.x)) &&
    Number.isFinite(Number(shape?.y)) &&
    Number.isFinite(Number(shape?.radius))
  ) {
    const radius = Number(shape.radius);
    const pointDistance = Math.hypot(point.x - Number(shape.x), point.y - Number(shape.y));
    return includeBoundary ? pointDistance <= radius : pointDistance < radius;
  }

  return false;
}

function pointInPolygon(point, points, includeBoundary) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = arrayPoint(points[previous]);
    const b = arrayPoint(points[index]);
    if (!a || !b) {
      continue;
    }

    const projection = closestPointOnSegment(point, a, b);
    if (projection.distance <= SEGMENT_EPSILON) {
      return includeBoundary;
    }

    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function arrayPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    return { x: Number(point[0]), y: Number(point[1]) };
  }
  if (isFinitePoint(point)) {
    return { x: Number(point.x), y: Number(point.y) };
  }
  return null;
}
