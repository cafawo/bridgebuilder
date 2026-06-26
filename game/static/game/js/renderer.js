import { formatCost, modeLabel } from "./ui.js";

export class Renderer {
  constructor(canvas, level) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.setLevel(level);
  }

  setLevel(level) {
    this.level = level;
    this.canvas.width = level.canvas.width;
    this.canvas.height = level.canvas.height;
  }

  render({ mode, editor, simulation, paused, systemMessage, levelIndex, levelCount }) {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground(ctx);
    this.drawWater(ctx);
    this.drawTerrain(ctx);
    this.drawRoadEdges(ctx);

    if (mode === "simulation" && simulation) {
      this.drawBeams(ctx, simulation.nodes, simulation.beams, true);
      this.drawNodes(ctx, simulation.nodes, null, null);
      this.drawVehicle(ctx, simulation.vehicle);
    } else {
      this.drawBeams(ctx, editor.nodes, editor.beams, false);
      this.drawPreview(ctx, editor.previewBeam());
      this.drawNodes(ctx, editor.nodes, editor.selectedNode, editor.hoverNode);
      this.drawVehicle(ctx, {
        x: this.level.start.x,
        y: this.level.start.y,
        angle: 0,
      });
    }

    this.drawGoal(ctx);
    this.drawUi(ctx, { mode, editor, simulation, paused, systemMessage, levelIndex, levelCount });
    this.drawFrame(ctx);
  }

  drawBackground(ctx) {
    ctx.fillStyle = "#252a2f";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const minor = Math.max(5, this.level.grid / 2);
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.canvas.width; x += minor) {
      const major = x % (this.level.grid * 5) === 0;
      const normal = x % this.level.grid === 0;
      ctx.strokeStyle = major ? "#14181c" : normal ? "#1e2328" : "#30363c";
      line(ctx, x, 0, x, this.canvas.height);
    }
    for (let y = 0; y <= this.canvas.height; y += minor) {
      const major = y % (this.level.grid * 5) === 0;
      const normal = y % this.level.grid === 0;
      ctx.strokeStyle = major ? "#14181c" : normal ? "#1e2328" : "#30363c";
      line(ctx, 0, y, this.canvas.width, y);
    }
  }

  drawWater(ctx) {
    const water = this.level.water;
    ctx.fillStyle = water.color || "#11106d";
    ctx.fillRect(water.x, water.y, water.width, water.height);
    ctx.strokeStyle = "#1b1a83";
    ctx.lineWidth = 2;
    line(ctx, water.x, water.y, water.x + water.width, water.y);
  }

  drawTerrain(ctx) {
    for (const terrain of this.level.terrain) {
      ctx.beginPath();
      terrain.points.forEach(([x, y], index) => {
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = terrain.color || "#303335";
      ctx.fill();
      ctx.strokeStyle = "#1d2022";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawRoadEdges(ctx) {
    ctx.lineCap = "butt";
    for (const segment of this.level.groundSegments) {
      ctx.strokeStyle = "#bdbdbd";
      ctx.lineWidth = 4;
      line(ctx, segment.x1, segment.y, segment.x2, segment.y);
    }
  }

  drawBeams(ctx, nodes, beams, showStress) {
    ctx.lineCap = "round";
    const ordered = [...beams].sort((a, b) => Number(a.deck) - Number(b.deck));

    for (const beam of ordered) {
      const a = nodes[beam.a];
      const b = nodes[beam.b];
      ctx.lineWidth = beam.deck ? 4 : 2.4;
      ctx.strokeStyle = showStress ? stressColor(beam) : buildBeamColor(beam);

      if (showStress) {
        ctx.lineWidth += Math.min(4, beam.stress * 18);
      }

      if (beam.broken) {
        ctx.save();
        ctx.setLineDash([7, 7]);
        line(ctx, a.x, a.y, b.x, b.y);
        ctx.restore();
      } else {
        line(ctx, a.x, a.y, b.x, b.y);
      }
    }
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
    const top = -config.height - config.wheelRadius;
    const wheelY = -config.wheelRadius;
    const wheelInset = Math.max(8, config.width * 0.27);

    ctx.save();
    ctx.translate(vehicle.x, vehicle.y + config.height + config.wheelRadius);
    ctx.rotate(vehicle.angle || 0);

    ctx.fillStyle = "#d5d5d5";
    ctx.fillRect(left, top, config.width, config.height);
    ctx.fillStyle = "#bfbfbf";
    ctx.fillRect(left + config.width * 0.52, top - 5, config.width * 0.34, 5);
    ctx.strokeStyle = "#222222";
    ctx.lineWidth = 2;
    ctx.strokeRect(left, top, config.width, config.height);

    this.drawWheel(ctx, left + wheelInset, wheelY, config.wheelRadius);
    this.drawWheel(ctx, left + config.width - wheelInset, wheelY, config.wheelRadius);
    ctx.restore();
  }

  drawWheel(ctx, x, y, radius) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#101010";
    ctx.fill();
    ctx.strokeStyle = "#b7b7b7";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawGoal(ctx) {
    ctx.strokeStyle = "#d7d7d7";
    ctx.lineWidth = 2;
    line(ctx, this.level.goal.x, this.level.goal.y - 28, this.level.goal.x, this.level.goal.y + 10);
    ctx.fillStyle = "#d7d7d7";
    ctx.fillRect(this.level.goal.x, this.level.goal.y - 28, 20, 12);
  }

  drawUi(ctx, { mode, editor, simulation, paused, systemMessage, levelIndex, levelCount }) {
    ctx.save();
    ctx.textBaseline = "top";
    ctx.fillStyle = "#dddddd";
    drawText(ctx, modeLabel(mode, paused), 8, 5, 20, "left");
    drawText(ctx, this.centerLabel(mode, simulation), this.canvas.width / 2, 5, 22, "center");

    const levelLabel = this.level.procedural ? "RANDOM" : `MAP ${levelIndex + 1}/${levelCount}`;
    drawText(ctx, levelLabel, this.canvas.width - 8, 5, 18, "right");

    if (mode === "simulation" && simulation) {
      const broken = simulation.beams.filter((beam) => beam.broken).length;
      drawText(ctx, `Broken: ${broken}`, 8, this.canvas.height - 54, 18, "left");
    } else {
      drawText(ctx, `Cost: ${formatCost(editor.totalCost())}`, 8, this.canvas.height - 76, 18, "left");
      drawText(ctx, `Budget: ${formatCost(this.level.budget)}`, 8, this.canvas.height - 52, 18, "left");
      drawText(ctx, `Weight: ${formatCost(this.level.vehicle.load)}`, 8, this.canvas.height - 28, 18, "left");
      drawText(ctx, "TEST", this.canvas.width - 8, this.canvas.height - 28, 18, "right");
    }

    const message = systemMessage || editor.currentMessage();
    if (message) {
      drawText(ctx, message, this.canvas.width / 2, this.canvas.height - 34, 20, "center");
    }
    ctx.restore();
  }

  centerLabel(mode, simulation) {
    if (mode === "simulation" && simulation) {
      return simulation.message;
    }
    return this.level.name;
  }

  drawFrame(ctx) {
    ctx.strokeStyle = "#090a0b";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, this.canvas.width - 2, this.canvas.height - 2);
  }
}

function buildBeamColor(beam) {
  return beam.deck ? "#d0d0d0" : "#8f9295";
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

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function stressColor(beam) {
  if (beam.broken) {
    return "#8c2020";
  }
  if (beam.stress < 0.035) {
    return "#22e022";
  }
  if (beam.stress < 0.072) {
    return "#d6ce35";
  }
  if (beam.stress < 0.1) {
    return "#d7832f";
  }
  return "#ff4040";
}
