import { formatCost, formatLoad, modeLabel } from "./ui.js?v=challenge2";

export class Renderer {
  constructor(canvas, level) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.effects = [];
    this.effectSimulation = null;
    this.knownBroken = new Set();
    this.lastOutcome = "";
    this.shakeUntil = 0;
    this.shakeMagnitude = 0;
    this.setLevel(level);
  }

  setLevel(level) {
    this.level = level;
    this.palette = level.palette;
    this.canvas.width = level.canvas.width;
    this.canvas.height = level.canvas.height;
    this.resetEffects();
  }

  render(state) {
    const {
      mode,
      editor,
      simulation,
      paused,
      systemMessage,
      seed,
    } = state;
    const now = Number(state.now) || performance.now();
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.palette.sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.updateEffects(simulation, now);
    const shake = this.shakeOffset(now);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    this.drawBackground(ctx);
    this.drawBackdrop(ctx);
    this.drawWater(ctx, now);
    this.drawTerrain(ctx);
    this.drawTerrainDetails(ctx);
    this.drawDecorations(ctx, now);
    this.drawRoadEdges(ctx);
    if (mode === "build") {
      this.drawNavigationClearances(ctx);
    }

    if (mode === "simulation" && simulation) {
      this.drawBeams(ctx, simulation.nodes, simulation.beams, true);
      this.drawNodes(ctx, simulation.nodes, null, null);
      this.drawVehicle(ctx, simulation.vehicle);
    } else {
      this.drawBeams(ctx, editor.nodes, editor.beams, false);
      this.drawPreview(ctx, editor.previewBeam());
      this.drawSnapCursor(ctx, editor);
      this.drawNodes(ctx, editor.nodes, editor.selectedNode, editor.hoverNode);
      this.drawVehicle(ctx, {
        x: this.level.start.x,
        y: this.level.start.y,
        angle: 0,
        wheelRotation: 0,
      });
    }

    this.drawGoal(ctx);
    this.drawEffects(ctx, now);
    ctx.restore();
    this.drawUi(ctx, { ...state, mode, editor, simulation, paused, systemMessage, seed });
  }

  drawBackground(ctx) {
    ctx.fillStyle = this.palette.sky;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const minor = Math.max(5, this.level.grid / 2);
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.canvas.width; x += minor) {
      const major = x % (this.level.grid * 5) === 0;
      const normal = x % this.level.grid === 0;
      ctx.strokeStyle = major
        ? this.palette.gridMajor
        : normal
          ? this.palette.grid
          : withAlpha(this.palette.grid, 0.38);
      line(ctx, x, 0, x, this.canvas.height);
    }
    for (let y = 0; y <= this.canvas.height; y += minor) {
      const major = y % (this.level.grid * 5) === 0;
      const normal = y % this.level.grid === 0;
      ctx.strokeStyle = major
        ? this.palette.gridMajor
        : normal
          ? this.palette.grid
          : withAlpha(this.palette.grid, 0.38);
      line(ctx, 0, y, this.canvas.width, y);
    }
  }

  drawWater(ctx, now) {
    for (const water of this.level.waterBodies) {
      ctx.fillStyle = water.color;
      drawPolygon(ctx, water.points);
      ctx.fill();
      this.drawWaterHighlights(ctx, water, now);
    }
  }

  drawWaterHighlights(ctx, water, now) {
    const bounds = water.bounds;
    const surfaceY = water.surfaceY;
    const animation = water.animation;
    const phase =
      finiteValue(animation.phase, 0) +
      now * 0.001 * finiteValue(animation.speed, 1.2);
    const amplitude = finiteValue(animation.amplitude, 2);

    ctx.save();
    drawPolygon(ctx, water.points);
    ctx.clip();
    ctx.strokeStyle = water.highlight;
    ctx.globalAlpha = 0.58;
    ctx.lineWidth = 1.4;
    for (let row = 0; row < 3; row += 1) {
      ctx.beginPath();
      for (let x = bounds.x - 8; x <= bounds.x + bounds.width + 8; x += 12) {
        const y =
          surfaceY +
          5 +
          row * 12 +
          Math.sin(x * 0.035 + phase + row * 1.8) * amplitude;
        if (x === bounds.x - 8) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBackdrop(ctx) {
    for (const layer of this.level.backdrop.layers) {
      ctx.beginPath();
      layer.points.forEach(([x, y], index) => {
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo(this.canvas.width + 80, this.canvas.height);
      ctx.lineTo(-80, this.canvas.height);
      ctx.closePath();
      ctx.fillStyle = layer.color || "rgba(62, 68, 70, 0.28)";
      ctx.fill();
    }
  }

  drawTerrain(ctx) {
    for (const terrain of this.level.terrain) {
      drawPolygon(ctx, terrain.points);
      ctx.fillStyle = terrain.color || this.palette.rock;
      ctx.fill();
      ctx.strokeStyle = terrain.edgeColor || this.palette.rockEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  drawTerrainDetails(ctx) {
    const details = this.level.details;
    if (!details?.strata?.length) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    for (const terrain of this.level.terrain) {
      terrain.points.forEach(([x, y], index) => {
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
    }
    ctx.clip();

    ctx.lineCap = "round";
    for (const lineSpec of details.strata) {
      ctx.strokeStyle = lineSpec.color || "rgba(20, 22, 23, 0.25)";
      ctx.lineWidth = lineSpec.width || 1;
      drawPolyline(ctx, lineSpec.points);
    }
    ctx.restore();
  }

  drawDecorations(ctx, now) {
    const details = this.level.details;
    const reeds = details.reeds;
    if (!reeds.length) {
      return;
    }

    const swaySpeed = finiteValue(details.animation?.reedSway, 0.02);
    const phase = now * 0.001 * (0.6 + swaySpeed * 20);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (let index = 0; index < reeds.length; index += 1) {
      const reed = reeds[index];
      const sway =
        Math.sin(phase + finiteValue(reed.phase, index * 0.83)) *
        Math.min(2.8, reed.height * 0.12);
      ctx.strokeStyle = reed.color || this.palette.vegetation;
      line(ctx, reed.x, reed.y + 4, reed.x - 2 + sway, reed.y - reed.height);
      line(ctx, reed.x, reed.y + 4, reed.x + 2 + sway * 0.7, reed.y - reed.height * 0.75);
    }
    ctx.restore();
  }

  drawRoadEdges(ctx) {
    ctx.lineCap = "butt";
    for (const segment of this.level.groundSegments) {
      ctx.strokeStyle = this.palette.road;
      ctx.lineWidth = 4;
      line(ctx, segment.x1, segment.y, segment.x2, segment.y);
    }
  }

  drawNavigationClearances(ctx) {
    const clearances = this.level.navigationClearances;
    if (!clearances.length) {
      return;
    }

    ctx.save();
    ctx.setLineDash([6, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(this.palette.road, 0.34);
    ctx.fillStyle = withAlpha(this.palette.road, 0.54);
    for (const clearance of clearances) {
      if (!clearance.points?.length) {
        continue;
      }
      drawPolygon(ctx, clearance.points);
      ctx.stroke();
      const bounds = polygonBounds(clearance.points);
      if (bounds && bounds.width > 90) {
        drawText(
          ctx,
          "KEEP CLEAR",
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2 - 6,
          11,
          "center",
        );
      }
    }
    ctx.restore();
  }

  drawBeams(ctx, nodes, beams, showStress) {
    ctx.lineCap = "round";
    const ordered = [...beams].sort((a, b) => Number(a.deck) - Number(b.deck));

    for (const beam of ordered) {
      const a = nodes[beam.a];
      const b = nodes[beam.b];
      if (!a || !b) {
        continue;
      }
      const utilization = normalizedUtilization(beam);
      ctx.lineWidth = beam.deck ? 4 : 2.4;
      ctx.strokeStyle = showStress ? stressColor(beam, this.palette) : buildBeamColor(beam);

      if (showStress) {
        ctx.lineWidth += Math.min(2.8, utilization * 1.8);
      }

      ctx.save();
      if (beam.broken) {
        ctx.setLineDash([7, 7]);
      } else if (showStress && utilization >= 0.8) {
        ctx.setLineDash(utilization >= 1 ? [2, 3] : [10, 3]);
      }
      line(ctx, a.x, a.y, b.x, b.y);
      ctx.restore();

      if (showStress && !beam.broken && utilization >= 0.55) {
        this.drawStressMarker(ctx, a, b, utilization);
      }
    }
  }

  drawStressMarker(ctx, a, b, utilization) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const count = utilization >= 1 ? 3 : utilization >= 0.8 ? 2 : 1;
    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "#000000";
    ctx.shadowBlur = 2;
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * 6;
      const x = centerX + (dx / length) * offset;
      const y = centerY + (dy / length) * offset;
      line(ctx, x - nx * 4, y - ny * 4, x + nx * 4, y + ny * 4);
    }
    ctx.restore();
  }

  drawPreview(ctx, preview) {
    if (!preview) {
      return;
    }

    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = preview.deck ? 4 : 2;
    ctx.strokeStyle = preview.valid ? (preview.deck ? "#38ff38" : "#cfcfcf") : "#cc3030";
    line(ctx, preview.from.x, preview.from.y, preview.to.x, preview.to.y);
    ctx.restore();

    const label = preview.valid
      ? `${previewLabel(preview)} · ${formatCost(preview.cost)}`
      : preview.reason.toUpperCase();
    ctx.save();
    ctx.fillStyle = preview.valid ? "#eeeeee" : "#ff6a6a";
    drawText(
      ctx,
      label,
      (preview.from.x + preview.to.x) / 2,
      (preview.from.y + preview.to.y) / 2 - 18,
      13,
      "center",
    );
    ctx.restore();

    if (preview.valid) {
      for (const point of preview.splitPoints ?? []) {
        drawSnapNode(ctx, point);
      }
    }

    if (!preview.valid) {
      ctx.fillStyle = "#cc3030";
      ctx.beginPath();
      ctx.arc(preview.to.x, preview.to.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawNodes(ctx, nodes, selectedNode, hoverNode) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.fixed ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = node.fixed ? "#a5a247" : "#a6a8aa";
      ctx.fill();

      if (index === selectedNode || index === hoverNode?.index) {
        ctx.lineWidth = index === selectedNode ? 2.4 : 1.6;
        ctx.strokeStyle = index === selectedNode ? "#ffffff" : "#d0d0d0";
        ctx.stroke();
      }
    }
  }

  drawVehicle(ctx, vehicle) {
    const config = this.level.vehicle;
    const left = -config.width / 2;
    const top = -config.height / 2;
    const wheelY = config.height / 2 + config.wheelRadius;
    const wheelInset = Math.max(8, config.width * 0.27);
    const rotation =
      Number.isFinite(vehicle.wheelRotation)
        ? vehicle.wheelRotation
        : Number(vehicle.x || 0) / Math.max(1, config.wheelRadius);

    ctx.save();
    ctx.translate(vehicle.x, vehicle.y + config.height / 2);
    ctx.rotate(vehicle.angle || 0);

    ctx.fillStyle = "#d5d5d5";
    ctx.fillRect(left, top, config.width, config.height);
    ctx.fillStyle = "#b5b8ba";
    ctx.fillRect(left + config.width * 0.42, top - 8, config.width * 0.44, 8);
    ctx.fillStyle = "#8e9397";
    ctx.fillRect(left + config.width * 0.57, top - 5, config.width * 0.16, 7);
    ctx.fillRect(left + config.width * 0.18, top - 8, 5, 8);
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, config.width, config.height);

    this.drawWheel(ctx, left + wheelInset, wheelY, config.wheelRadius, rotation);
    this.drawWheel(ctx, left + config.width - wheelInset, wheelY, config.wheelRadius, rotation);
    ctx.restore();
  }

  drawWheel(ctx, x, y, radius, rotation = 0) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#101010";
    ctx.fill();
    ctx.strokeStyle = "#b7b7b7";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.strokeStyle = "#d4d4d4";
    ctx.lineWidth = 1;
    line(ctx, -radius + 2, 0, radius - 2, 0);
    line(ctx, 0, -radius + 2, 0, radius - 2);
    ctx.restore();
  }

  drawGoal(ctx) {
    ctx.strokeStyle = "#d7d7d7";
    ctx.lineWidth = 2;
    line(ctx, this.level.goal.x, this.level.goal.y - 28, this.level.goal.x, this.level.goal.y + 10);
    ctx.fillStyle = "#d7d7d7";
    ctx.fillRect(this.level.goal.x, this.level.goal.y - 28, 20, 12);
  }

  drawUi(ctx, state) {
    const {
      mode,
      editor,
      simulation,
      paused,
      systemMessage,
      seed,
    } = state;
    const result = simulationResult(simulation);
    const ratedLoad = challengeLoad(this.level);
    const trialLoad = activeLoad(this.level, simulation, result, state);
    const gameMode = state.gameMode;
    ctx.save();
    ctx.textBaseline = "top";
    ctx.fillStyle = "#dddddd";
    drawText(
      ctx,
      `${modeLabel(mode, paused)} · ${gameMode.toUpperCase()}`,
      8,
      5,
      18,
      "left",
    );
    drawText(ctx, this.centerLabel(mode, simulation, result), this.canvas.width / 2, 5, 22, "center");

    const levelLabel = `SEED ${displaySeed(seed)}`;
    drawText(ctx, levelLabel, this.canvas.width - 8, 5, 18, "right");

    if (mode === "simulation" && simulation) {
      const broken = brokenCount(simulation, result);
      const peakUtilization =
        finiteValue(result?.peakUtilization, simulation.peakUtilization, maxUtilization(simulation.beams));
      drawText(ctx, `Load: ${formatLoad(trialLoad)}`, 8, this.canvas.height - 76, 18, "left");
      drawText(ctx, `Rated: ${formatLoad(ratedLoad)}`, 8, this.canvas.height - 52, 16, "left");
      drawText(
        ctx,
        `Damage: ${broken} · Peak: ${formatPercent(peakUtilization)}`,
        8,
        this.canvas.height - 28,
        16,
        "left",
      );
      if (state.simulationSpeed) {
        drawText(
          ctx,
          `${state.simulationSpeed}×`,
          this.canvas.width - 8,
          this.canvas.height - 28,
          18,
          "right",
        );
      }
    } else {
      const totalCost = editor.totalCost();
      const remaining =
        editor.enforceBudget === false ? "Unlimited" : formatCost(editor.remainingBudget());
      drawText(ctx, `Cost: ${formatCost(totalCost)}`, 8, this.canvas.height - 76, 18, "left");
      drawText(ctx, `Remaining: ${remaining}`, 8, this.canvas.height - 52, 16, "left");
      drawText(ctx, `Rated load: ${formatLoad(ratedLoad)}`, 8, this.canvas.height - 28, 16, "left");
      const tierSummary = loadTierSummary(this.level);
      if (gameMode === "challenge" && tierSummary) {
        drawText(ctx, tierSummary, this.canvas.width - 8, this.canvas.height - 28, 14, "right");
      }
      if (gameMode === "challenge" && Number.isFinite(state.bestRecord?.maxLoad)) {
        drawText(
          ctx,
          `Personal best: ${formatLoad(state.bestRecord.maxLoad)}`,
          this.canvas.width - 8,
          this.canvas.height - 52,
          15,
          "right",
        );
      }
      this.drawHelp(ctx, editor.helpText());
    }

    const message = systemMessage || editor.currentMessage();
    if (message) {
      const y = mode === "build" ? this.canvas.height - 92 : this.canvas.height - 34;
      drawText(ctx, message, this.canvas.width / 2, y, 20, "center");
    }
    ctx.restore();
  }

  drawHelp(ctx, help) {
    ctx.save();
    ctx.fillStyle = "rgba(12, 14, 16, 0.64)";
    ctx.strokeStyle = "#3b4045";
    ctx.lineWidth = 1;
    const width = Math.min(620, this.canvas.width - 32);
    const height = 46;
    const x = (this.canvas.width - width) / 2;
    const y = 38;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = "#e0e0e0";
    drawText(ctx, help.primary, this.canvas.width / 2, y + 5, 14, "center");
    drawText(ctx, help.secondary, this.canvas.width / 2, y + 24, 13, "center");
    ctx.restore();
  }

  drawSnapCursor(ctx, editor) {
    if (!editor.pointer) {
      return;
    }

    const point = editor.pointer;
    ctx.save();
    if (editor.hoverBeam) {
      drawSnapNode(ctx, point);
      ctx.restore();
      return;
    }

    ctx.strokeStyle = editor.selectedNode === null ? "#6d7378" : "#d0d0d0";
    ctx.lineWidth = 1;
    line(ctx, point.x - 7, point.y, point.x + 7, point.y);
    line(ctx, point.x, point.y - 7, point.x, point.y + 7);
    ctx.restore();
  }

  resetEffects(simulation = null) {
    this.effects = [];
    this.effectSimulation = simulation;
    this.knownBroken = new Set();
    this.lastOutcome = "";
    this.shakeUntil = 0;
    this.shakeMagnitude = 0;
  }

  updateEffects(simulation, now) {
    if (simulation !== this.effectSimulation) {
      this.resetEffects(simulation);
    }
    if (!simulation) {
      return;
    }

    const nodes = simulation.nodes;
    for (let index = 0; index < simulation.beams.length; index += 1) {
      const beam = simulation.beams[index];
      if (!beam.broken || this.knownBroken.has(index)) {
        continue;
      }
      this.knownBroken.add(index);
      const a = nodes[beam.a];
      const b = nodes[beam.b];
      if (a && b) {
        this.spawnBreak((a.x + b.x) / 2, (a.y + b.y) / 2, now, index);
      }
    }

    const result = simulationResult(simulation);
    const outcome = result?.status && result.status !== "running"
      ? `${result.status}:${result.reason ?? ""}:${result.completionTick ?? ""}`
      : "";
    if (outcome && outcome !== this.lastOutcome) {
      this.lastOutcome = outcome;
      const reason = String(result.reason ?? "").toLowerCase();
      const vehicle = simulation.vehicle ?? this.level.goal;
      if (reason.includes("water") || reason.includes("drown")) {
        this.spawnSplash(vehicle.x, vehicle.y, now);
      } else if (
        reason.includes("terrain") ||
        reason.includes("impact") ||
        reason.includes("tip") ||
        reason.includes("fall")
      ) {
        this.startShake(
          now,
          finiteValue(this.level.details?.effects?.impactShake, 4.2),
        );
      }
    }
  }

  spawnBreak(x, y, now, salt = 0) {
    const configured = Math.max(
      1,
      Math.round(finiteValue(this.level.details?.effects?.breakParticles, 8)),
    );
    const particleCount = prefersReducedMotion() ? 2 : configured;
    for (let index = 0; index < particleCount; index += 1) {
      const angle = salt * 0.71 + index * 2.399;
      const speed = 18 + ((index * 17 + salt * 11) % 38);
      this.effects.push({
        kind: "debris",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 22,
        born: now,
        life: 0.72,
        color: index % 2 ? "#d3d3d3" : "#8f9295",
      });
    }
    this.startShake(
      now,
      finiteValue(this.level.details?.effects?.impactShake, 3) * 0.9,
    );
  }

  spawnSplash(x, y, now) {
    const configured = Math.max(
      1,
      Math.round(finiteValue(this.level.details?.effects?.splashParticles, 11)),
    );
    const particleCount = prefersReducedMotion() ? 3 : configured;
    for (let index = 0; index < particleCount; index += 1) {
      const spread = (index / Math.max(1, particleCount - 1) - 0.5) * 1.9;
      const speed = 36 + (index * 19) % 42;
      this.effects.push({
        kind: "splash",
        x,
        y,
        vx: Math.sin(spread) * speed,
        vy: -Math.cos(spread) * speed,
        born: now,
        life: 0.86,
        color: this.palette.waterHighlight,
      });
    }
    this.startShake(now, 2);
  }

  startShake(now, magnitude) {
    if (prefersReducedMotion()) {
      return;
    }
    this.shakeUntil = Math.max(this.shakeUntil, now + 220);
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
  }

  shakeOffset(now) {
    if (now >= this.shakeUntil) {
      this.shakeMagnitude = 0;
      return { x: 0, y: 0 };
    }
    const remaining = (this.shakeUntil - now) / 220;
    return {
      x: Math.sin(now * 0.097) * this.shakeMagnitude * remaining,
      y: Math.cos(now * 0.133) * this.shakeMagnitude * remaining * 0.65,
    };
  }

  drawEffects(ctx, now) {
    this.effects = this.effects.filter((effect) => (now - effect.born) / 1000 < effect.life);
    for (const effect of this.effects) {
      const age = (now - effect.born) / 1000;
      const progress = age / effect.life;
      const gravity = effect.kind === "splash" ? 115 : 90;
      const x = effect.x + effect.vx * age;
      const y = effect.y + effect.vy * age + 0.5 * gravity * age * age;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.fillStyle = effect.color;
      if (effect.kind === "splash") {
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * (1 - progress * 0.45), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.translate(x, y);
        ctx.rotate(age * 8 + effect.vx);
        ctx.fillRect(-2.5, -1, 5, 2);
      }
      ctx.restore();
    }
  }

  centerLabel(mode, simulation, result = simulationResult(simulation)) {
    if (mode === "simulation" && simulation) {
      return (
        simulation.message ||
        result?.message ||
        outcomeLabel(result?.status, result?.reason) ||
        "CROSSING"
      );
    }
    return `${this.level.name} · ${this.level.challenge.archetypeLabel}`;
  }
}

function buildBeamColor(beam) {
  return beam.deck ? "#d0d0d0" : "#8f9295";
}

function drawSnapNode(ctx, point) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = "#a5a247";
  ctx.fill();
}

function previewLabel(preview) {
  if (preview.split) {
    return "SPLIT";
  }
  return preview.deck ? "DECK" : "SUPPORT";
}

function displaySeed(seed) {
  if (!seed || seed.length <= 24) {
    return seed || "";
  }
  return `${seed.slice(0, 21)}...`;
}

function drawText(ctx, text, x, y, size, align) {
  ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textAlign = align;
  ctx.shadowColor = "#000000";
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 0;
  ctx.fillText(text, x, y);
  ctx.shadowColor = "transparent";
}

function drawPolygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.closePath();
}

function drawPolyline(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function stressColor(beam, palette) {
  if (beam.broken) {
    return palette.stressCritical;
  }
  const utilization = normalizedUtilization(beam);
  if (utilization < 0.55) {
    return palette.stressSafe;
  }
  if (utilization < 0.8) {
    return palette.stressWarning;
  }
  if (utilization < 1) {
    return palette.stressHigh;
  }
  return palette.stressCritical;
}

function normalizedUtilization(beam) {
  return Math.max(0, Number(beam.utilization) || 0);
}

function simulationResult(simulation) {
  return simulation?.result() ?? null;
}

function challengeLoad(level) {
  return level.challenge.ratedLoad;
}

function activeLoad(level, simulation, result, state) {
  return simulation?.load ?? result?.load ?? state.testLoad ?? challengeLoad(level);
}

function loadTierSummary(level) {
  return `Tiers ${level.challenge.tiers
    .map((tier) => `${trimNumber(tier)}×`)
    .join(" / ")}`;
}

function maxUtilization(beams = []) {
  return beams.reduce((highest, beam) => Math.max(highest, normalizedUtilization(beam)), 0);
}

function brokenCount(simulation, result) {
  return result?.brokenCount ??
    simulation.beams.filter((beam) => beam.broken).length;
}

function formatPercent(value) {
  return `${Math.round(Math.max(0, Number(value) || 0) * 100)}%`;
}

function finiteValue(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return 0;
}

function trimNumber(value) {
  return Number(value.toFixed(2)).toString();
}

function outcomeLabel(status, reason) {
  if (status === "running") {
    return "CROSSING";
  }
  if (status === "won") {
    return "BRIDGE HOLDS";
  }
  return reason ? reason.toUpperCase() : "CROSSING FAILED";
}

function polygonBounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function withAlpha(color, alpha) {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(String(color));
  if (!match) {
    return color;
  }
  const hex =
    match[1].length === 3
      ? [...match[1]].map((character) => character + character).join("")
      : match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function prefersReducedMotion() {
  return Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
