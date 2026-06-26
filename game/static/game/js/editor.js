import { clamp } from "./ui.js";

const NODE_RADIUS = 12;
const BEAM_PICK_DISTANCE = 8;

export class BridgeEditor {
  constructor(level) {
    this.level = level;
    this.reset();
  }

  reset() {
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
    this.message = "";
    this.messageUntil = 0;
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

  currentMessage(now = performance.now()) {
    return now < this.messageUntil ? this.message : "";
  }

  setPointer(rawPoint) {
    if (!rawPoint) {
      this.pointer = null;
      this.hoverNode = null;
      this.hoverBeam = null;
      return;
    }

    this.pointer = this.snapPoint(rawPoint);
    this.hoverNode = this.findNode(rawPoint, NODE_RADIUS);
    this.hoverBeam = this.findBeam(rawPoint);
  }

  previewBeam() {
    if (this.selectedNode === null || !this.pointer) {
      return null;
    }

    const from = this.nodes[this.selectedNode];
    const hover = this.hoverNode ? this.nodes[this.hoverNode.index] : this.pointer;
    const length = distance(from, hover);
    const existing = this.hoverNode
      ? this.beams.some((beam) => sameBeam(beam, this.selectedNode, this.hoverNode.index))
      : false;
    const beamCost = length * this.level.costs.beamPerPixel;
    const cost = this.hoverNode ? beamCost : this.level.costs.node + beamCost;

    return {
      from,
      to: hover,
      length,
      deck: this.isDeckBeam(from, hover),
      valid:
        length >= 8 &&
        length <= this.level.maxBeamLength &&
        !existing &&
        this.totalCost() + cost <= this.level.budget,
    };
  }

  handleLeftClick(rawPoint) {
    const point = this.snapPoint(rawPoint);
    const nearestNode = this.findNode(point);

    if (nearestNode) {
      this.handleNodeClick(nearestNode.index);
      return;
    }

    this.handleEmptyClick(point);
  }

  handleRightClick(point) {
    const nearestNode = this.findNode(point, 9);
    const nearestBeam = this.findBeam(point);

    if (nearestNode && (!nearestBeam || nearestNode.distance <= nearestBeam.distance)) {
      this.deleteNode(nearestNode.index);
      return;
    }

    if (nearestBeam) {
      this.beams.splice(nearestBeam.index, 1);
      this.setMessage("Beam deleted");
      return;
    }

    this.setMessage("Nothing selected");
  }

  handleNodeClick(index) {
    if (this.selectedNode === null) {
      this.selectedNode = index;
      return;
    }

    if (this.selectedNode === index) {
      this.selectedNode = null;
      return;
    }

    if (this.addBeam(this.selectedNode, index)) {
      this.selectedNode = index;
    }
  }

  handleEmptyClick(point) {
    const newNodeCost = this.level.costs.node;
    let extraCost = newNodeCost;

    if (this.selectedNode !== null) {
      const selected = this.nodes[this.selectedNode];
      const beamLength = distance(selected, point);
      if (!this.canCreateBeamLength(beamLength)) {
        return;
      }
      extraCost += beamLength * this.level.costs.beamPerPixel;
    }

    if (this.totalCost() + extraCost > this.level.budget) {
      this.setMessage("Budget exceeded");
      return;
    }

    const newIndex = this.nodes.length;
    this.nodes.push({
      x: point.x,
      y: point.y,
      fixed: false,
    });

    if (this.selectedNode !== null) {
      this.beams.push(this.createBeam(this.selectedNode, newIndex));
    }

    this.selectedNode = newIndex;
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

    const extraCost = beamLength * this.level.costs.beamPerPixel;
    if (this.totalCost() + extraCost > this.level.budget) {
      this.setMessage("Budget exceeded");
      return false;
    }

    this.beams.push(this.createBeam(a, b));
    return true;
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
    const tolerance = this.level.deckTolerance ?? 26;
    const maxSlope = this.level.maxDeckSlope ?? 0.34;
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

    if (beamLength > this.level.maxBeamLength) {
      this.setMessage("Beam too long");
      return false;
    }

    return true;
  }

  deleteNode(index) {
    if (this.nodes[index].fixed) {
      this.setMessage("Anchor nodes are fixed");
      return;
    }

    this.nodes.splice(index, 1);
    this.beams = this.beams
      .filter((beam) => beam.a !== index && beam.b !== index)
      .map((beam) => ({
        a: beam.a > index ? beam.a - 1 : beam.a,
        b: beam.b > index ? beam.b - 1 : beam.b,
      }));

    if (this.selectedNode === index) {
      this.selectedNode = null;
    } else if (this.selectedNode > index) {
      this.selectedNode -= 1;
    }

    this.setMessage("Node deleted");
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
      const beamDistance = distancePointToSegment(point, this.nodes[beam.a], this.nodes[beam.b]);
      if (beamDistance <= BEAM_PICK_DISTANCE && (!best || beamDistance < best.distance)) {
        best = { index, distance: beamDistance };
      }
    }
    return best;
  }

  snapPoint(point) {
    const snap = this.level.snap || 10;
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

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return distance(point, a);
  }

  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  return distance(point, {
    x: a.x + t * dx,
    y: a.y + t * dy,
  });
}
