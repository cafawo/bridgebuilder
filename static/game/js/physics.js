const EPSILON = 0.0001;

export class BridgeSimulation {
  constructor(level, graph) {
    this.level = level;
    this.nodes = graph.nodes.map((node) => ({
      x: node.x,
      y: node.y,
      previousX: node.x,
      previousY: node.y,
      fixed: node.fixed,
      forceX: 0,
      forceY: 0,
    }));
    this.beams = graph.beams.map((beam) => ({
      a: beam.a,
      b: beam.b,
      deck: Boolean(beam.deck),
      restLength: distance(graph.nodes[beam.a], graph.nodes[beam.b]),
      selfStress: this.beamSelfStress(distance(graph.nodes[beam.a], graph.nodes[beam.b]), Boolean(beam.deck)),
      loadStress: 0,
      stress: 0,
      broken: false,
    }));
    this.vehicle = {
      x: level.start.x,
      y: level.start.y,
      vy: 0,
      angle: 0,
    };
    this.status = "running";
    this.message = "Testing bridge";
  }

  step(deltaSeconds) {
    if (this.status !== "running") {
      return;
    }

    const dt = Math.min(deltaSeconds, 1 / 30);
    this.clearForces();
    this.advanceVehicle(dt);
    this.integrateNodes(dt);
    this.solveBeams();
    this.evaluateState();
  }

  clearForces() {
    const gravity = this.level.physics.gravity;
    for (const node of this.nodes) {
      node.forceX = 0;
      node.forceY = gravity;
    }

    for (const beam of this.beams) {
      if (!beam.broken) {
        beam.loadStress = beam.selfStress;
        beam.stress = beam.selfStress;
      }
    }
  }

  advanceVehicle(dt) {
    const vehicleConfig = this.level.vehicle;
    this.vehicle.x += vehicleConfig.speed * dt;

    const wheelInset = Math.max(8, vehicleConfig.width * 0.27);
    const wheelXs = [
      this.vehicle.x - vehicleConfig.width / 2 + wheelInset,
      this.vehicle.x + vehicleConfig.width / 2 - wheelInset,
    ];
    const contacts = wheelXs.map((wheelX) => this.findSurfaceAt(wheelX)).filter(Boolean);

    if (contacts.length === 0) {
      this.vehicle.vy += this.level.physics.gravity * dt;
      this.vehicle.y += this.vehicle.vy * dt;
      return;
    }

    const averageY = contacts.reduce((total, contact) => total + contact.y, 0) / contacts.length;
    const targetY = averageY - vehicleConfig.height - vehicleConfig.wheelRadius;
    this.vehicle.y += (targetY - this.vehicle.y) * 0.45;
    this.vehicle.vy = 0;
    this.vehicle.angle = this.surfaceAngle(contacts);

    const wheelLoad = vehicleConfig.load / wheelXs.length;
    for (const contact of contacts) {
      if (contact.type === "beam") {
        this.applyWheelLoad(contact, wheelLoad);
      }
    }
  }

  applyWheelLoad(contact, load) {
    const beam = this.beams[contact.beamIndex];
    if (!beam || beam.broken) {
      return;
    }

    const a = this.nodes[beam.a];
    const b = this.nodes[beam.b];
    const t = contact.t;
    a.forceY += load * (1 - t);
    b.forceY += load * t;
    beam.loadStress += this.wheelBendingStress(beam, load, t);
    beam.stress = Math.max(beam.stress, beam.loadStress);
  }

  integrateNodes(dt) {
    const damping = this.level.physics.damping;

    for (const node of this.nodes) {
      if (node.fixed) {
        node.previousX = node.x;
        node.previousY = node.y;
        continue;
      }

      const velocityX = (node.x - node.previousX) * damping;
      const velocityY = (node.y - node.previousY) * damping;
      node.previousX = node.x;
      node.previousY = node.y;
      node.x += velocityX + node.forceX * dt * dt;
      node.y += velocityY + node.forceY * dt * dt;
    }
  }

  solveBeams() {
    const iterations = this.level.physics.constraintIterations;
    const stiffness = this.level.physics.beamStiffness;

    for (const beam of this.beams) {
      if (!beam.broken) {
        beam.stress = Math.max(beam.stress, beam.loadStress);
        if (beam.stress > this.beamCapacity(beam)) {
          this.breakBeam(beam);
        }
      }
    }

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const beam of this.beams) {
        if (beam.broken) {
          continue;
        }

        const a = this.nodes[beam.a];
        const b = this.nodes[beam.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const currentLength = Math.hypot(dx, dy);

        if (currentLength < EPSILON) {
          continue;
        }

        const delta = currentLength - beam.restLength;
        const axialStress = Math.abs(delta) / beam.restLength;
        beam.stress = Math.max(beam.stress, axialStress);

        if (beam.stress > this.beamCapacity(beam)) {
          this.breakBeam(beam);
          continue;
        }

        const inverseA = a.fixed ? 0 : 1;
        const inverseB = b.fixed ? 0 : 1;
        const inverseTotal = inverseA + inverseB;
        if (inverseTotal === 0) {
          continue;
        }

        const correction = (delta / currentLength) * stiffness;
        a.x += dx * correction * (inverseA / inverseTotal);
        a.y += dy * correction * (inverseA / inverseTotal);
        b.x -= dx * correction * (inverseB / inverseTotal);
        b.y -= dy * correction * (inverseB / inverseTotal);
      }
    }
  }

  beamSelfStress(length, isDeck) {
    const capacity = this.level.physics.beamSelfWeightCapacity ?? 18000000;
    const deckFactor = isDeck ? 1.12 : 0.82;
    return (length * length * deckFactor) / capacity;
  }

  wheelBendingStress(beam, load, t) {
    const bendingCapacity = this.level.physics.beamBendingCapacity ?? 2800000;
    const deckFactor = beam.deck ? 1.15 : 0.78;
    const lever = Math.max(0, t * (1 - t));
    return (load * beam.restLength * lever * deckFactor) / bendingCapacity;
  }

  beamCapacity(beam) {
    const base = this.level.physics.beamBreakStress;
    const deckFactor = beam.deck
      ? this.level.physics.deckStrengthFactor ?? 0.92
      : this.level.physics.supportStrengthFactor ?? 1.08;
    const weakening = this.level.physics.longBeamWeakening ?? 0.00035;
    const lengthFactor = Math.max(0.58, 1 - Math.max(0, beam.restLength - 140) * weakening);
    return base * deckFactor * lengthFactor;
  }

  breakBeam(beam) {
    beam.broken = true;
    beam.stress = 1;
  }

  findSurfaceAt(x) {
    for (const segment of this.level.groundSegments) {
      if (x >= segment.x1 && x <= segment.x2) {
        return {
          type: "ground",
          x,
          y: segment.y,
        };
      }
    }

    const vehicleConfig = this.level.vehicle;
    const wheelBottom = this.vehicle.y + vehicleConfig.height + vehicleConfig.wheelRadius;
    let best = null;

    for (let index = 0; index < this.beams.length; index += 1) {
      const beam = this.beams[index];
      if (beam.broken || !beam.deck) {
        continue;
      }

      const a = this.nodes[beam.a];
      const b = this.nodes[beam.b];
      const dx = b.x - a.x;
      if (Math.abs(dx) < 5) {
        continue;
      }

      const t = (x - a.x) / dx;
      if (t < 0 || t > 1) {
        continue;
      }

      const y = a.y + (b.y - a.y) * t;
      const gap = Math.abs(y - wheelBottom);
      if (gap <= 66 && (!best || gap < best.gap)) {
        best = {
          type: "beam",
          x,
          beamIndex: index,
          t,
          y,
          gap,
        };
      }
    }

    return best;
  }

  evaluateState() {
    const vehicleConfig = this.level.vehicle;
    const vehicleBottom = this.vehicle.y + vehicleConfig.height + vehicleConfig.wheelRadius;
    const brokenCount = this.beams.filter((beam) => beam.broken).length;
    const waterLine = this.level.water.y + 6;

    if (this.vehicle.x >= this.level.goal.x) {
      this.status = "won";
      this.message = "Bridge held";
      return;
    }

    if (vehicleBottom > this.level.canvas.height + 70) {
      this.status = "lost";
      this.message = "Vehicle lost";
      return;
    }

    if (
      this.vehicle.x > this.level.water.x &&
      this.vehicle.x < this.level.water.x + this.level.water.width &&
      vehicleBottom > waterLine
    ) {
      this.status = "lost";
      this.message = "Vehicle drowned";
      return;
    }

    if (this.beams.length > 0 && brokenCount / this.beams.length > 0.62) {
      this.status = "lost";
      this.message = "Bridge failed";
    }
  }

  surfaceAngle(contacts) {
    if (contacts.length < 2) {
      return this.vehicle.angle * 0.92;
    }

    const [left, right] = contacts;
    const dx = Math.max(1, right.x - left.x);
    return Math.atan2(right.y - left.y, dx);
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
