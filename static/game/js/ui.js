export function pointerToCanvas(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export function formatCost(value) {
  return Math.round(value).toString();
}

export function modeLabel(mode, paused) {
  if (mode === "simulation" && paused) {
    return "PAUSE";
  }
  return mode === "build" ? "EDIT" : "TEST";
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
