const EPSILON = 0.0001;
const CONTACT_PENETRATION = 9;
const CONTACT_MEMORY_TICKS = 6;
const EXIT_DWELL_TICKS = 30;
const TIP_DWELL_TICKS = 24;
const STALL_SECONDS = 5;

export const SIMULATION_DT = 1 / 120;
export const PHYSICS_VERSION = "2.0.0";

export class BridgeSimulation {
  constructor(level, graph, options = {}) {
    this.level = level;
    this.load = Math.max(
      0,
      Number(options.load ?? level.challenge.ratedLoad),
    );
    this.tickCount = 0;
    this.completionTick = null;
    this.status = "running";
    this.reason = "";
    this.message = "Testing bridge";
    this.peakUtilization = 0;
    this.firstFailure = null;
    this.breakSequence = [];
    this.exitTicks = 0;
    this.tipTicks = 0;
    this.stallTicks = 0;
    this.timeAccumulator = 0;

    this.nodes = graph.nodes.map((node, index) => ({
      index,
      x: Number(node.x),
      y: Number(node.y),
      previousX: Number(node.x),
      previousY: Number(node.y),
      fixed: Boolean(node.fixed),
      mass: 0,
      inverseMass: 0,
      forceX: 0,
      forceY: 0,
    }));
    this.beams = graph.beams.map((beam, index) => ({
      index,
      a: beam.a,
      b: beam.b,
      deck: Boolean(beam.deck),
      restLength: distance(graph.nodes[beam.a], graph.nodes[beam.b]),
      effectiveSpan: 0,
      stress: 0,
      utilization: 0,
      peakUtilization: 0,
      constraintForce: 0,
      peakConstraintForce: 0,
      components: {
        axial: 0,
        bending: 0,
        selfWeight: 0,
      },
      failureCause: "",
      broken: false,
      key: canonicalBeamKey(
        graph.nodes[beam.a],
        graph.nodes[beam.b],
        Boolean(beam.deck),
      ),
    }));

    this.adjacency = buildAdjacency(this.nodes.length, this.beams);
    const orderedBeams = [...this.beams].sort((first, second) => {
      return first.key.localeCompare(second.key);
    });
    const braceConnectivityCache = new Map();
    for (const beam of orderedBeams) {
      beam.effectiveSpan = effectiveMemberSpan(
        beam,
        this.beams,
        this.nodes,
        this.adjacency,
        braceConnectivityCache,
      );
    }
    this.solverOrder = [...this.beams.keys()].sort((first, second) => {
      return compareBeams(this.beams[first], this.beams[second], this.nodes);
    });
    this.assignNodeMasses();

    const vehicleConfig = level.vehicle;
    this.vehicle = {
      x: level.start.x,
      previousX: level.start.x,
      y: level.start.y,
      previousY: level.start.y,
      vx: vehicleConfig.speed,
      vy: 0,
      angle: 0,
      previousAngle: 0,
      angularVelocity: 0,
      wheelRotation: 0,
      grounded: true,
      contacts: [],
      supportMemory: [null, null],
      supportAges: [CONTACT_MEMORY_TICKS + 1, CONTACT_MEMORY_TICKS + 1],
    };
  }

  tick() {
    if (this.status !== "running") {
      return this.result();
    }

    this.tickCount += 1;
    this.clearForces();
    this.advanceVehicle(SIMULATION_DT);
    this.integrateNodes(SIMULATION_DT);
    this.solveBeams();
    this.evaluateState();
    return this.result();
  }

  step(deltaSeconds = SIMULATION_DT) {
    this.timeAccumulator += Math.max(0, Number(deltaSeconds) || 0);
    while (
      this.timeAccumulator + EPSILON >= SIMULATION_DT &&
      this.status === "running"
    ) {
      this.tick();
      this.timeAccumulator = Math.max(0, this.timeAccumulator - SIMULATION_DT);
    }
    return this.result();
  }

  result() {
    const deckNodeIndices = new Set(
      this.beams
        .filter((beam) => beam.deck)
        .flatMap((beam) => [beam.a, beam.b]),
    );
    const deckYs = [...deckNodeIndices].map((index) => this.nodes[index].y);
    const brokenMembers = this.beams
      .filter((beam) => beam.broken)
      .sort((first, second) => first.key.localeCompare(second.key))
      .map((beam) => ({
        key: beam.key,
        beamIndex: beam.index,
        cause: beam.failureCause || "overload",
        peakUtilization: beam.peakUtilization,
      }));
    const memberUtilization =
      this.status === "running"
        ? []
        : [...this.beams]
            .sort((first, second) => first.key.localeCompare(second.key))
            .map((beam) => ({
              key: beam.key,
              utilization: beam.peakUtilization,
              axialForce: beam.peakConstraintForce,
              broken: beam.broken,
            }));
    return {
      status: this.status,
      reason: this.reason || (this.status === "running" ? "" : this.message),
      message: this.message,
      completionTick: this.completionTick,
      tick: this.tickCount,
      peakUtilization: this.peakUtilization,
      memberUtilization,
      brokenMembers,
      brokenCount: brokenMembers.length,
      load: this.load,
      peakLoad: this.load,
      failureCause: this.firstFailure?.cause ?? (this.status === "lost" ? this.reason : ""),
      firstFailure: this.firstFailure ? { ...this.firstFailure } : null,
      breakSequence: this.breakSequence.map((failure) => ({ ...failure })),
      vehicle: {
        x: this.vehicle.x,
        y: this.vehicle.y,
        vx: this.vehicle.vx,
        vy: this.vehicle.vy,
        angle: this.vehicle.angle,
        grounded: this.vehicle.grounded,
        contactCount: this.vehicle.contacts.filter(Boolean).length,
      },
      deckYRange:
        deckYs.length > 0
          ? {
              minimum: Math.min(...deckYs),
              maximum: Math.max(...deckYs),
            }
          : null,
    };
  }

  assignNodeMasses() {
    const physics = this.level.physics;
    const baseMass = physics.nodeBaseMass;
    const massPerPixel = physics.nodeMassPerBeamPixel;
    for (const node of this.nodes) {
      node.mass = baseMass;
    }
    const orderedBeams = [...this.beams].sort((first, second) => {
      return first.key.localeCompare(second.key);
    });
    for (const beam of orderedBeams) {
      const contribution = beam.restLength * massPerPixel * 0.5;
      this.nodes[beam.a].mass += contribution;
      this.nodes[beam.b].mass += contribution;
    }
    for (const node of this.nodes) {
      node.inverseMass = node.fixed ? 0 : 1 / Math.max(0.05, node.mass);
    }
  }

  clearForces() {
    const gravity = this.level.physics.gravity;
    for (const node of this.nodes) {
      node.forceX = 0;
      node.forceY = node.mass * gravity;
    }

    for (const beam of this.beams) {
      if (beam.broken) {
        continue;
      }
      const selfWeight = this.selfWeightUtilization(beam);
      beam.components = {
        axial: 0,
        bending: 0,
        selfWeight,
      };
      beam.constraintForce = 0;
      beam.utilization = selfWeight;
      beam.stress = selfWeight;
    }
  }

  advanceVehicle(dt) {
    const config = this.level.vehicle;
    const wheelPoints = this.wheelPoints(
      this.vehicle.x,
      this.vehicle.y,
      this.vehicle.angle,
    );
    const previousWheelPoints = this.wheelPoints(
      this.vehicle.previousX,
      this.vehicle.previousY,
      this.vehicle.previousAngle,
    );
    const priorContacts = this.vehicle.supportMemory;
    const contacts = wheelPoints.map((point, index) =>
      this.findSurfaceContact(
        point.x,
        point.y,
        previousWheelPoints[index].x,
        previousWheelPoints[index].y,
        priorContacts[index],
      ),
    );
    const activeContacts = contacts.filter(Boolean);

    this.vehicle.previousX = this.vehicle.x;
    this.vehicle.previousY = this.vehicle.y;
    this.vehicle.previousAngle = this.vehicle.angle;
    this.vehicle.contacts = contacts;
    this.vehicle.grounded = activeContacts.length > 0;
    contacts.forEach((contact, index) => {
      if (contact) {
        this.vehicle.supportMemory[index] = contact;
        this.vehicle.supportAges[index] = 0;
      } else {
        this.vehicle.supportAges[index] += 1;
        if (this.vehicle.supportAges[index] > CONTACT_MEMORY_TICKS) {
          this.vehicle.supportMemory[index] = null;
        }
      }
    });

    if (activeContacts.length > 0) {
      this.vehicle.vy = Math.min(0, this.vehicle.vy * 0.18);
      if (activeContacts.length === 2) {
        const targetAngle = this.contactAngle(contacts);
        this.vehicle.angle += (targetAngle - this.vehicle.angle) * 0.72;
        this.vehicle.angularVelocity *= 0.18;
      } else {
        const pivotDirection = contacts[0] ? 1 : -1;
        this.vehicle.angularVelocity += pivotDirection * 0.15 * dt;
        this.vehicle.angle += this.vehicle.angularVelocity * dt;
      }
      this.alignVehicleToContacts(contacts);
      const traction = Math.min(1, activeContacts.length / 2);
      this.vehicle.vx += (config.speed - this.vehicle.vx) * (0.08 + traction * 0.08);

      const contactLoad = this.load / activeContacts.length;
      for (const contact of activeContacts) {
        if (contact.type === "beam") {
          this.applyWheelLoad(contact, contactLoad);
        }
      }
    } else {
      this.vehicle.vy += this.level.physics.gravity * dt;
      this.vehicle.y += this.vehicle.vy * dt;
      this.vehicle.vx *= 0.9985;
      this.vehicle.angularVelocity *= 0.999;
      this.vehicle.angle += this.vehicle.angularVelocity * dt;
    }

    this.vehicle.x += this.vehicle.vx * dt;
    this.vehicle.wheelRotation +=
      (this.vehicle.vx * dt) / Math.max(1, config.wheelRadius);
  }

  wheelOffsets() {
    const config = this.level.vehicle;
    const inset = Math.max(8, config.width * 0.27);
    const horizontal = config.width / 2 - inset;
    const vertical = config.height / 2 + config.wheelRadius;
    return [
      { x: -horizontal, y: vertical },
      { x: horizontal, y: vertical },
    ];
  }

  wheelPoints(x, y, angle) {
    const centerY = y + this.level.vehicle.height / 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return this.wheelOffsets().map((offset) => ({
      x: x + offset.x * cosine - offset.y * sine,
      y: centerY + offset.x * sine + offset.y * cosine,
    }));
  }

  alignVehicleToContacts(contacts) {
    const offsets = this.wheelOffsets();
    const cosine = Math.cos(this.vehicle.angle);
    const sine = Math.sin(this.vehicle.angle);
    const targets = contacts
      .map((contact, index) => (contact ? { contact, offset: offsets[index] } : null))
      .filter(Boolean);
    if (targets.length === 0) {
      return;
    }
    const centerY =
      targets.reduce((sum, target) => {
        const rotatedY =
          target.offset.x * sine + target.offset.y * cosine;
        return sum + target.contact.y - rotatedY;
      }, 0) / targets.length;
    this.vehicle.y = centerY - this.level.vehicle.height / 2;
  }

  axleOffset() {
    const config = this.level.vehicle;
    return config.height + config.wheelRadius;
  }

  applyWheelLoad(contact, load) {
    const beam = this.beams[contact.beamIndex];
    if (!beam || beam.broken) {
      return;
    }
    const a = this.nodes[beam.a];
    const b = this.nodes[beam.b];
    a.forceY += load * (1 - contact.t);
    b.forceY += load * contact.t;

    const bending = this.wheelBendingUtilization(beam, load, contact.t);
    beam.components.bending += bending;
    this.updateBeamUtilization(beam);
  }

  integrateNodes(dt) {
    const damping = Math.pow(this.level.physics.damping, dt / (1 / 60));
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
      node.x += velocityX + node.forceX * node.inverseMass * dt * dt;
      node.y += velocityY + node.forceY * node.inverseMass * dt * dt;
    }
  }

  solveBeams() {
    const iterations = this.level.physics.constraintIterations;
    const stiffness = this.level.physics.beamStiffness;
    const correctionX = new Float64Array(this.nodes.length);
    const correctionY = new Float64Array(this.nodes.length);
    const correctionCount = new Uint16Array(this.nodes.length);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      correctionX.fill(0);
      correctionY.fill(0);
      correctionCount.fill(0);
      const toBreak = [];

      for (const beamIndex of this.solverOrder) {
        const beam = this.beams[beamIndex];
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
        const inverseA = a.inverseMass;
        const inverseB = b.inverseMass;
        const inverseTotal = inverseA + inverseB;
        const axial = this.axialUtilization(beam, delta, inverseTotal);
        beam.components.axial = Math.max(beam.components.axial, axial);
        this.updateBeamUtilization(beam);
        if (beam.utilization > 1) {
          toBreak.push(beamIndex);
          continue;
        }

        if (inverseTotal <= 0) {
          continue;
        }

        const correction = (delta / currentLength) * stiffness;
        if (inverseA > 0) {
          correctionX[beam.a] += dx * correction * (inverseA / inverseTotal);
          correctionY[beam.a] += dy * correction * (inverseA / inverseTotal);
          correctionCount[beam.a] += 1;
        }
        if (inverseB > 0) {
          correctionX[beam.b] -= dx * correction * (inverseB / inverseTotal);
          correctionY[beam.b] -= dy * correction * (inverseB / inverseTotal);
          correctionCount[beam.b] += 1;
        }
      }

      for (let index = 0; index < this.nodes.length; index += 1) {
        const count = correctionCount[index];
        if (count > 0 && !this.nodes[index].fixed) {
          this.nodes[index].x += correctionX[index] / count;
          this.nodes[index].y += correctionY[index] / count;
        }
      }

      for (const beamIndex of [...new Set(toBreak)].sort((first, second) => {
        return this.beams[first].key.localeCompare(this.beams[second].key);
      })) {
        this.breakBeam(this.beams[beamIndex]);
      }
    }
  }

  updateBeamUtilization(beam) {
    const utilization = Math.max(
      beam.components.selfWeight,
      beam.components.bending,
      beam.components.axial,
    );
    beam.utilization = utilization;
    beam.stress = utilization;
    beam.peakUtilization = Math.max(beam.peakUtilization, utilization);
    this.peakUtilization = Math.max(this.peakUtilization, utilization);

    if (utilization === beam.components.bending) {
      beam.failureCause = "deck bending";
    } else if (utilization === beam.components.axial) {
      beam.failureCause = "member strain";
    } else {
      beam.failureCause = "member self-weight";
    }
  }

  selfWeightUtilization(beam) {
    const capacity = this.level.physics.beamSelfWeightCapacity;
    const typeFactor = beam.deck ? 1.12 : 0.82;
    const demand = (beam.effectiveSpan * beam.effectiveSpan * typeFactor) / capacity;
    return demand / Math.max(EPSILON, this.memberStrainCapacity(beam));
  }

  wheelBendingUtilization(beam, load, t) {
    const capacity = this.level.physics.beamBendingCapacity;
    const typeFactor = beam.deck ? 1.15 : 0.78;
    const lever = Math.max(0.04, t * (1 - t));
    const demand = (load * beam.effectiveSpan * lever * typeFactor) / capacity;
    return demand / Math.max(EPSILON, this.memberStrainCapacity(beam));
  }

  axialUtilization(beam, delta, inverseTotal) {
    if (inverseTotal <= 0) {
      return 0;
    }
    const stiffness = this.level.physics.beamStiffness;
    const constraintForce =
      (Math.abs(delta) * stiffness) /
      Math.max(EPSILON, inverseTotal * SIMULATION_DT * SIMULATION_DT);
    beam.constraintForce = Math.max(beam.constraintForce, constraintForce);
    beam.peakConstraintForce = Math.max(
      beam.peakConstraintForce,
      constraintForce,
    );
    const baseForceCapacity =
      delta >= 0
        ? this.level.physics.beamAxialCapacity
        : this.level.physics.beamCompressionCapacity;
    const baseStrainCapacity = this.level.physics.beamBreakStress;
    const memberFactor =
      this.memberStrainCapacity(beam) / Math.max(EPSILON, baseStrainCapacity);
    return constraintForce / Math.max(1, baseForceCapacity * memberFactor);
  }

  memberStrainCapacity(beam) {
    const base = this.level.physics.beamBreakStress;
    const typeFactor = beam.deck
      ? this.level.physics.deckStrengthFactor
      : this.level.physics.supportStrengthFactor;
    const weakening = this.level.physics.longBeamWeakening;
    const lengthFactor = Math.max(
      0.55,
      1 - Math.max(0, beam.effectiveSpan - 140) * weakening,
    );
    return base * typeFactor * lengthFactor;
  }

  breakBeam(beam) {
    if (beam.broken) {
      return;
    }
    beam.broken = true;
    beam.utilization = Math.max(1, beam.utilization);
    beam.stress = beam.utilization;
    const a = this.nodes[beam.a];
    const b = this.nodes[beam.b];
    const failure = {
      key: beam.key,
      beamIndex: beam.index,
      cause: beam.failureCause || "overload",
      utilization: beam.utilization,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      tick: this.tickCount,
    };
    this.breakSequence.push(failure);
    if (!this.firstFailure) {
      this.firstFailure = {
        ...failure,
        memberKey: beam.key,
      };
    }
  }

  findSurfaceContact(x, axleY, previousX, previousAxleY, priorContact = null) {
    const candidates = [];
    for (const segment of this.level.groundSegments) {
      if (x >= segment.x1 - EPSILON && x <= segment.x2 + EPSILON) {
        const contact = {
          type: "ground",
          x,
          y: segment.y,
          previousY: segment.y,
          segment,
        };
        contact.continuousWithPrior = this.contactsShareSurface(
          priorContact,
          contact,
        );
        addContactCandidate(
          candidates,
          contact,
          axleY,
          previousAxleY,
          priorContact,
        );
      }
    }

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
      const slope = (b.y - a.y) / dx;
      if (Math.abs(slope) > Math.max(0.48, this.level.maxDeckSlope * 1.8)) {
        continue;
      }
      const y = a.y + (b.y - a.y) * t;
      const previousA = {
        x: a.previousX,
        y: a.previousY,
      };
      const previousB = {
        x: b.previousX,
        y: b.previousY,
      };
      const previousDx = previousB.x - previousA.x;
      const previousT =
        Math.abs(previousDx) < EPSILON
          ? t
          : (previousX - previousA.x) / previousDx;
      const previousY =
        previousT >= -EPSILON && previousT <= 1 + EPSILON
          ? previousA.y + (previousB.y - previousA.y) * previousT
          : y;
      const contact = {
        type: "beam",
        x,
        y,
        t,
        beamIndex: index,
        memberKey: beam.key,
        previousY,
      };
      contact.continuousWithPrior = this.contactsShareSurface(
        priorContact,
        contact,
      );
      addContactCandidate(
        candidates,
        contact,
        axleY,
        previousAxleY,
        priorContact,
      );
    }

    candidates.sort((first, second) => {
      const gapDifference = Math.abs(first.gap) - Math.abs(second.gap);
      if (Math.abs(gapDifference) > EPSILON) {
        return gapDifference;
      }
      if (first.type !== second.type) {
        return first.type === "ground" ? -1 : 1;
      }
      return String(first.memberKey ?? "").localeCompare(
        String(second.memberKey ?? ""),
      );
    });
    return candidates[0] ?? null;
  }

  contactsShareSurface(first, second) {
    if (!first || !second) {
      return false;
    }
    if (sameContact(first, second)) {
      return true;
    }
    if (first.type === "beam" && second.type === "beam") {
      const firstBeam = this.beams[first.beamIndex];
      const secondBeam = this.beams[second.beamIndex];
      return (
        firstBeam &&
        secondBeam &&
        !firstBeam.broken &&
        !secondBeam.broken &&
        [firstBeam.a, firstBeam.b].some(
          (nodeIndex) =>
            nodeIndex === secondBeam.a || nodeIndex === secondBeam.b,
        )
      );
    }
    if (first.type === "ground" && second.type === "ground") {
      return groundSegmentsMeet(first.segment, second.segment);
    }
    const beamContact = first.type === "beam" ? first : second;
    const groundContact = first.type === "ground" ? first : second;
    const beam = this.beams[beamContact.beamIndex];
    if (!beam || beam.broken || !groundContact.segment) {
      return false;
    }
    return [this.nodes[beam.a], this.nodes[beam.b]].some((node) =>
      nodeMeetsGround(node, groundContact.segment),
    );
  }

  contactAngle(contacts) {
    if (contacts.every(Boolean)) {
      const [left, right] = contacts;
      return Math.atan2(right.y - left.y, Math.max(1, right.x - left.x));
    }
    return this.vehicle.angle * 0.92;
  }

  vehicleCollisionPoints(x, y, angle) {
    const config = this.level.vehicle;
    const center = {
      x,
      y: y + config.height * 0.5,
    };
    const halfWidth = config.width * 0.38;
    const halfHeight = config.height * 0.38;
    const axleInset = Math.max(8, config.width * 0.27);
    const axleFromCenter = this.axleOffset() - halfHeight;
    const offsets = [
      { x: 0, y: 0 },
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
      { x: -halfWidth + axleInset, y: axleFromCenter },
      { x: halfWidth - axleInset, y: axleFromCenter },
    ];
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return offsets.map((offset) => ({
      x: center.x + offset.x * cosine - offset.y * sine,
      y: center.y + offset.x * sine + offset.y * cosine,
    }));
  }

  evaluateState() {
    const bodyBottom = this.vehicle.y + this.level.vehicle.height;
    const currentCollisionPoints = this.vehicleCollisionPoints(
      this.vehicle.x,
      this.vehicle.y,
      this.vehicle.angle,
    );
    const previousCollisionPoints = this.vehicleCollisionPoints(
      this.vehicle.previousX,
      this.vehicle.previousY,
      this.vehicle.previousAngle,
    );

    const hazard = this.level.hazards.find((candidate) => {
      return (
        currentCollisionPoints
          .slice(0, 5)
          .some((point) => pointInPolygon(point, candidate.points)) ||
        currentCollisionPoints.slice(0, 5).some((point, index) => {
          return segmentCrossesPolygon(
            previousCollisionPoints[index],
            point,
            candidate.points,
          );
        })
      );
    });
    if (hazard) {
      if (hazard.type === "water") {
        this.finish("lost", "Vehicle drowned");
      } else {
        this.finish("lost", "Vehicle struck terrain");
      }
      return;
    }

    if (bodyBottom > this.level.canvas.height + 40) {
      this.finish("lost", "Vehicle fell from the site");
      return;
    }

    if (Math.abs(this.vehicle.angle) > 1.05) {
      this.tipTicks += 1;
    } else {
      this.tipTicks = Math.max(0, this.tipTicks - 2);
    }
    if (this.tipTicks >= TIP_DWELL_TICKS) {
      this.finish("lost", "Vehicle tipped over");
      return;
    }

    if (Math.abs(this.vehicle.vx) < 2) {
      this.stallTicks += 1;
    } else {
      this.stallTicks = 0;
    }
    if (this.stallTicks >= Math.round(STALL_SECONDS / SIMULATION_DT)) {
      this.finish("lost", "Vehicle stalled");
      return;
    }

    const [rearWheel] = this.wheelPoints(
      this.vehicle.x,
      this.vehicle.y,
      this.vehicle.angle,
    );
    const [previousRearWheel] = this.wheelPoints(
      this.vehicle.previousX,
      this.vehicle.previousY,
      this.vehicle.previousAngle,
    );
    const rearContact = this.findSurfaceContact(
      rearWheel.x,
      rearWheel.y,
      previousRearWheel.x,
      previousRearWheel.y,
      this.vehicle.contacts[0],
    );
    const supportedExit =
      rearWheel.x >= this.level.goal.x &&
      rearContact?.type === "ground" &&
      Math.abs(this.vehicle.angle) < 0.35;
    this.exitTicks = supportedExit ? this.exitTicks + 1 : 0;
    if (this.exitTicks >= EXIT_DWELL_TICKS) {
      this.finish("won", "Bridge held");
    }
  }

  finish(status, message) {
    if (this.status !== "running") {
      return;
    }
    this.status = status;
    this.reason = message;
    this.message = message;
    this.completionTick = this.tickCount;
  }
}

function addContactCandidate(
  candidates,
  contact,
  axleY,
  previousAxleY,
  priorContact,
) {
  const gap = contact.y - axleY;
  const previousSurfaceY = contact.previousY ?? contact.y;
  const wasOnOrAbove = previousAxleY <= previousSurfaceY + EPSILON;
  const retained =
    sameContact(priorContact, contact) &&
    gap >= -CONTACT_PENETRATION &&
    gap <= EPSILON;
  const crossedFromAbove =
    wasOnOrAbove &&
    axleY >= contact.y - EPSILON;
  if (retained || crossedFromAbove) {
    candidates.push({ ...contact, gap, retained });
  }
}

function sameContact(first, second) {
  if (!first) {
    return false;
  }
  if (second.continuousWithPrior) {
    return true;
  }
  if (first.type !== second.type) {
    return false;
  }
  if (second.type === "beam") {
    return first.memberKey === second.memberKey;
  }
  return first.segment === second.segment;
}

function groundSegmentsMeet(first, second) {
  if (!first || !second || Math.abs(first.y - second.y) > 2) {
    return false;
  }
  return (
    Math.abs(first.x1 - second.x2) <= 2 ||
    Math.abs(first.x2 - second.x1) <= 2 ||
    first === second
  );
}

function nodeMeetsGround(node, segment) {
  if (!node || !segment || Math.abs(node.y - segment.y) > 3) {
    return false;
  }
  return (
    Math.abs(node.x - segment.x1) <= 3 ||
    Math.abs(node.x - segment.x2) <= 3
  );
}

function buildAdjacency(nodeCount, beams) {
  const adjacency = Array.from({ length: nodeCount }, () => []);
  for (let index = 0; index < beams.length; index += 1) {
    adjacency[beams[index].a].push(index);
    adjacency[beams[index].b].push(index);
  }
  return adjacency;
}

function effectiveMemberSpan(
  origin,
  beams,
  nodes,
  adjacency,
  braceConnectivityCache,
) {
  return (
    origin.restLength +
    walkCollinear(
      origin.index,
      origin.a,
      beams,
      nodes,
      adjacency,
      braceConnectivityCache,
    ) +
    walkCollinear(
      origin.index,
      origin.b,
      beams,
      nodes,
      adjacency,
      braceConnectivityCache,
    )
  );
}

function walkCollinear(
  originIndex,
  startNode,
  beams,
  nodes,
  adjacency,
  braceConnectivityCache,
) {
  let currentBeamIndex = originIndex;
  let currentNodeIndex = startNode;
  let total = 0;
  const visited = new Set([originIndex]);

  while (!nodes[currentNodeIndex].fixed) {
    const currentBeam = beams[currentBeamIndex];
    const previousNode =
      currentBeam.a === currentNodeIndex ? currentBeam.b : currentBeam.a;
    const continuations = adjacency[currentNodeIndex]
      .filter((index) => index !== currentBeamIndex && !visited.has(index))
      .map((index) => {
        const beam = beams[index];
        const nextNode = beam.a === currentNodeIndex ? beam.b : beam.a;
        return {
          beamIndex: index,
          nextNode,
          alignment: straightAlignment(
            nodes[previousNode],
            nodes[currentNodeIndex],
            nodes[nextNode],
          ),
          key: beam.key ?? canonicalBeamKey(
            nodes[beam.a],
            nodes[beam.b],
            beam.deck,
          ),
        };
      })
      .filter((candidate) => candidate.alignment !== null)
      .sort((first, second) => {
        const alignmentDifference = second.alignment - first.alignment;
        if (Math.abs(alignmentDifference) > EPSILON) {
          return alignmentDifference;
        }
        return first.key.localeCompare(second.key);
      });
    const continuation = continuations[0];
    if (!continuation) {
      break;
    }

    if (
      isGenuinelyBracedJoint(
        currentNodeIndex,
        previousNode,
        continuation.nextNode,
        currentBeamIndex,
        continuation.beamIndex,
        beams,
        nodes,
        adjacency,
        braceConnectivityCache,
      )
    ) {
      break;
    }

    const nextBeam = beams[continuation.beamIndex];
    total += nextBeam.restLength;
    visited.add(continuation.beamIndex);
    currentBeamIndex = continuation.beamIndex;
    currentNodeIndex = continuation.nextNode;
  }
  return total;
}

function straightAlignment(previous, center, next) {
  if (!collinear(previous, center, next)) {
    return null;
  }
  const previousX = previous.x - center.x;
  const previousY = previous.y - center.y;
  const nextX = next.x - center.x;
  const nextY = next.y - center.y;
  const denominator =
    Math.hypot(previousX, previousY) * Math.hypot(nextX, nextY);
  if (denominator < EPSILON) {
    return null;
  }
  const cosine = (previousX * nextX + previousY * nextY) / denominator;
  return cosine < 0 ? -cosine : null;
}

function isGenuinelyBracedJoint(
  jointIndex,
  previousNode,
  nextNode,
  incomingBeamIndex,
  outgoingBeamIndex,
  beams,
  nodes,
  adjacency,
  connectivityCache,
) {
  const braceNeighbors = adjacency[jointIndex]
    .filter(
      (beamIndex) =>
        beamIndex !== incomingBeamIndex && beamIndex !== outgoingBeamIndex,
    )
    .map((beamIndex) => {
      const beam = beams[beamIndex];
      return beam.a === jointIndex ? beam.b : beam.a;
    })
    .filter(
      (neighborIndex) =>
        !collinear(
          nodes[previousNode],
          nodes[jointIndex],
          nodes[neighborIndex],
        ),
    );
  if (braceNeighbors.length === 0) {
    return false;
  }

  const connectivity = connectivityWithoutNode(
    jointIndex,
    beams,
    nodes,
    adjacency,
    connectivityCache,
  );
  const memberComponents = new Set(
    [previousNode, nextNode]
      .map((nodeIndex) => connectivity.componentByNeighbor.get(nodeIndex))
      .filter((componentIndex) => componentIndex !== undefined),
  );

  return braceNeighbors.some((neighborIndex) => {
    const componentIndex = connectivity.componentByNeighbor.get(neighborIndex);
    return (
      componentIndex !== undefined &&
      (
        connectivity.hasFixedNode[componentIndex] ||
        memberComponents.has(componentIndex)
      )
    );
  });
}

function connectivityWithoutNode(
  removedNode,
  beams,
  nodes,
  adjacency,
  cache,
) {
  const cached = cache.get(removedNode);
  if (cached) {
    return cached;
  }

  const directNeighbors = new Set(
    adjacency[removedNode].map((beamIndex) => {
      const beam = beams[beamIndex];
      return beam.a === removedNode ? beam.b : beam.a;
    }),
  );
  const componentByNeighbor = new Map();
  const hasFixedNode = [];
  const visited = new Set([removedNode]);
  const seeds = [...directNeighbors].sort((first, second) => first - second);

  for (const seed of seeds) {
    if (visited.has(seed)) {
      continue;
    }
    const componentIndex = hasFixedNode.length;
    let containsFixed = false;
    const queue = [seed];
    visited.add(seed);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const nodeIndex = queue[cursor];
      containsFixed ||= nodes[nodeIndex].fixed;
      if (directNeighbors.has(nodeIndex)) {
        componentByNeighbor.set(nodeIndex, componentIndex);
      }
      const incidentBeams = [...adjacency[nodeIndex]].sort((first, second) => {
        const firstBeam = beams[first];
        const secondBeam = beams[second];
        const firstKey =
          firstBeam.key ??
          canonicalBeamKey(
            nodes[firstBeam.a],
            nodes[firstBeam.b],
            firstBeam.deck,
          );
        const secondKey =
          secondBeam.key ??
          canonicalBeamKey(
            nodes[secondBeam.a],
            nodes[secondBeam.b],
            secondBeam.deck,
          );
        return firstKey.localeCompare(secondKey);
      });
      for (const beamIndex of incidentBeams) {
        const beam = beams[beamIndex];
        const neighborIndex =
          beam.a === nodeIndex ? beam.b : beam.a;
        if (neighborIndex === removedNode || visited.has(neighborIndex)) {
          continue;
        }
        visited.add(neighborIndex);
        queue.push(neighborIndex);
      }
    }
    hasFixedNode.push(containsFixed);
  }

  const result = { componentByNeighbor, hasFixedNode };
  cache.set(removedNode, result);
  return result;
}

function collinear(a, center, b) {
  const firstX = a.x - center.x;
  const firstY = a.y - center.y;
  const secondX = b.x - center.x;
  const secondY = b.y - center.y;
  const denominator = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
  if (denominator < EPSILON) {
    return false;
  }
  return Math.abs(firstX * secondY - firstY * secondX) / denominator < 0.08;
}

function compareBeams(first, second, nodes) {
  if (first.key && second.key) {
    return first.key.localeCompare(second.key);
  }
  const firstA = nodes[first.a];
  const firstB = nodes[first.b];
  const secondA = nodes[second.a];
  const secondB = nodes[second.b];
  const firstKey = canonicalBeamKey(firstA, firstB, first.deck);
  const secondKey = canonicalBeamKey(secondA, secondB, second.deck);
  return firstKey.localeCompare(secondKey);
}

function canonicalBeamKey(a, b, deck) {
  const start = a.x < b.x || (a.x === b.x && a.y <= b.y) ? a : b;
  const end = start === a ? b : a;
  return [
    deck ? 1 : 0,
    start.x.toFixed(4),
    start.y.toFixed(4),
    end.x.toFixed(4),
    end.y.toFixed(4),
  ].join(":");
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[previous];
    const intersects =
      y1 > point.y !== y2 > point.y &&
      point.x < ((x2 - x1) * (point.y - y1)) / (y2 - y1 || EPSILON) + x1;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentCrossesPolygon(from, to, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const edgeStart = { x: polygon[index][0], y: polygon[index][1] };
    const edgeEnd = { x: polygon[next][0], y: polygon[next][1] };
    if (segmentsCross(from, to, edgeStart, edgeEnd)) {
      return true;
    }
  }
  return false;
}

function segmentsCross(a, b, c, d) {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const cd = { x: d.x - c.x, y: d.y - c.y };
  const denominator = ab.x * cd.y - ab.y * cd.x;
  if (Math.abs(denominator) < EPSILON) {
    return false;
  }
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = (ac.x * cd.y - ac.y * cd.x) / denominator;
  const u = (ac.x * ab.y - ac.y * ab.x) / denominator;
  return (
    t > EPSILON &&
    t <= 1 + EPSILON &&
    u >= -EPSILON &&
    u <= 1 + EPSILON
  );
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
