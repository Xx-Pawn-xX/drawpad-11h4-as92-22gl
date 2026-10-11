
"use strict";

const $ = (id) => document.getElementById(id);

const viewport = $("viewport");
const stage = $("stage");
const stack = $("canvasStack");
const gridCanvas = $("gridCanvas");
const gridCtx = gridCanvas.getContext("2d");
const projectFile = $("projectFile");

let width = 1000;
let height = 1000;
let zoom = 0.6;
let panX = 0;
let panY = 0;
let tool = "pen";
let drawing = false;
let panning = false;
let spaceDown = false;
let activePointer = null;
let startPoint = null;
let lastPoint = null;
let beforeAction = null;
let previewImage = null;
let dirty = false;
let documentTitle = "Untitled artwork";
let toastTimer;

const MAX_HISTORY = 30;
const MAX_PIXELS = 4096;

let layers = [];
let activeLayerId = null;
let nextLayerId = 1;
let undoStack = [];
let redoStack = [];

const defaultColors = [
  "#ffffff", "#000000", "#8b9cff", "#ff6b81",
  "#ffb86b", "#f9e784", "#70dfb0", "#57c7ff",
  "#c792ea", "#b1bacb", "#535f78", "#222838"
];
let paletteColors = [...defaultColors];

const state = {
  color: "#8b9cff",
  size: 8,
  opacity: 1,
  shapeMode: "stroke",
  fontSize: 32,
  grid: false,
  whiteBackground: true
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2300);
}

function setStatus(message) {
  $("statusText").textContent = message;
}

function markDirty() {
  dirty = true;
  $("unsavedMark").classList.add("show");
}

function markSaved() {
  dirty = false;
  $("unsavedMark").classList.remove("show");
}

function getLayer(id = activeLayerId) {
  return layers.find(layer => layer.id === id);
}

function activeLayer() {
  return getLayer();
}

function createCanvasLayer(name) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "drawing-layer";
  canvas.dataset.layerId = String(nextLayerId);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  return {
    id: nextLayerId++,
    name,
    canvas,
    ctx,
    visible: true,
    opacity: 1,
    blend: "source-over"
  };
}

function updateLayerCanvasStyle(layer) {
  layer.canvas.style.opacity = String(layer.opacity);
  layer.canvas.style.mixBlendMode =
    layer.blend === "source-over" ? "normal" : layer.blend;
  layer.canvas.style.pointerEvents =
    layer.id === activeLayerId ? "auto" : "none";
}

function syncCanvasDimensions() {
  stage.style.width = width + "px";
  stage.style.height = height + "px";
  stack.style.width = width + "px";
  stack.style.height = height + "px";

  gridCanvas.width = width;
  gridCanvas.height = height;
  gridCanvas.style.width = width + "px";
  gridCanvas.style.height = height + "px";

  $("canvasWidth").value = width;
  $("canvasHeight").value = height;
  $("canvasInfo").textContent = `${width} × ${height} px`;

  renderGrid();
  applyTransform();
}

function applyTransform() {
  stage.style.transform =
    `translate(${panX}px, ${panY}px) scale(${zoom})`;
  $("zoomValue").textContent = Math.round(zoom * 100) + "%";
}

function fitCanvas() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const margin = 60;
  zoom = Math.min(
    (rect.width - margin) / width,
    (rect.height - margin) / height,
    1
  );

  zoom = Math.max(0.05, zoom);
  panX = (rect.width - width * zoom) / 2;
  panY = (rect.height - height * zoom) / 2;
  applyTransform();
}

function setZoom(newZoom, clientX, clientY) {
  newZoom = Math.max(0.05, Math.min(4, newZoom));

  const rect = viewport.getBoundingClientRect();
  const anchorX = clientX ?? rect.left + rect.width / 2;
  const anchorY = clientY ?? rect.top + rect.height / 2;

  const localX = (anchorX - rect.left - panX) / zoom;
  const localY = (anchorY - rect.top - panY) / zoom;

  panX = anchorX - rect.left - localX * newZoom;
  panY = anchorY - rect.top - localY * newZoom;
  zoom = newZoom;

  applyTransform();
}

function screenToCanvas(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(width, (event.clientX - rect.left) / zoom)),
    y: Math.max(0, Math.min(height, (event.clientY - rect.top) / zoom))
  };
}

function renderGrid() {
  gridCtx.clearRect(0, 0, width, height);
  if (!state.grid) return;

  const step = 50;
  gridCtx.save();
  gridCtx.strokeStyle = "rgba(90, 110, 170, .28)";
  gridCtx.lineWidth = 1;
  gridCtx.beginPath();

  for (let x = 0; x <= width; x += step) {
    gridCtx.moveTo(x + 0.5, 0);
    gridCtx.lineTo(x + 0.5, height);
  }
  for (let y = 0; y <= height; y += step) {
    gridCtx.moveTo(0, y + 0.5);
    gridCtx.lineTo(width, y + 0.5);
  }

  gridCtx.stroke();
  gridCtx.restore();
}

function renderLayers() {
  stack.replaceChildren();

  for (const layer of layers) {
    stack.appendChild(layer.canvas);
    updateLayerCanvasStyle(layer);
  }

  $("layerList").replaceChildren();

  // Show the topmost layer first.
  [...layers].reverse().forEach((layer, index) => {
    const row = document.createElement("div");
    row.className =
      "layer-item" + (layer.id === activeLayerId ? " active" : "");

    const visibility = document.createElement("button");
    visibility.className = "layer-visibility";
    visibility.textContent = layer.visible ? "◉" : "○";
    visibility.title = layer.visible ? "Hide layer" : "Show layer";
    visibility.setAttribute("aria-label", visibility.title);

    visibility.addEventListener("click", event => {
      event.stopPropagation();
      layer.visible = !layer.visible;
      layer.canvas.style.display = layer.visible ? "block" : "none";
      markDirty();
      renderLayers();
    });

    const preview = document.createElement("canvas");
    preview.className = "layer-preview";
    preview.width = 64;
    preview.height = 64;

    const previewCtx = preview.getContext("2d");
    previewCtx.clearRect(0, 0, 64, 64);
    previewCtx.drawImage(layer.canvas, 0, 0, 64, 64);

    const name = document.createElement("span");
    name.className = "layer-name";
    name.textContent = layer.name;
    name.title = layer.name;

    const number = document.createElement("span");
    number.className = "layer-number";
    number.textContent = String(layers.length - index);

    row.append(visibility, preview, name, number);
    row.addEventListener("click", () => selectLayer(layer.id));
    $("layerList").appendChild(row);
  });

  const layer = activeLayer();
  const disabled = !layer;

  ["renameLayerBtn", "duplicateLayerBtn", "deleteLayerBtn",
    "moveLayerUpBtn", "moveLayerDownBtn"].forEach(id => {
      $(id).disabled = disabled;
    });

  if (layer) {
    $("layerOpacity").value = Math.round(layer.opacity * 100);
    $("layerOpacityValue").textContent =
      Math.round(layer.opacity * 100) + "%";
    $("layerBlend").value = layer.blend;
  }
}

function selectLayer(id) {
  if (!getLayer(id)) return;
  activeLayerId = id;
  renderLayers();
  setStatus("Selected " + activeLayer().name);
}

function addLayer(name = `Layer ${layers.length + 1}`) {
  if (layers.length >= 30) {
    toast("Maximum 30 layers.");
    return;
  }

  const layer = createCanvasLayer(name);
  layers.push(layer);
  activeLayerId = layer.id;
  renderLayers();
  markDirty();
  return layer;
}

function rememberUndo(layer = activeLayer()) {
  if (!layer) return;

  undoStack.push({
    layerId: layer.id,
    image: layer.canvas.toDataURL("image/png")
  });

  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

function loadLayerImage(layer, dataURL) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      layer.ctx.clearRect(0, 0, width, height);
      layer.ctx.drawImage(image, 0, 0, width, height);
      resolve();
    };

    image.onerror = () => reject(new Error("Could not restore image."));
    image.src = dataURL;
  });
}

async function undo() {
  if (!undoStack.length) return toast("Nothing to undo.");

  const entry = undoStack.pop();
  const layer = getLayer(entry.layerId);

  if (!layer) return toast("That layer no longer exists.");

  redoStack.push({
    layerId: layer.id,
    image: layer.canvas.toDataURL("image/png")
  });

  await loadLayerImage(layer, entry.image);
  renderLayers();
  markDirty();
  setStatus("Undo");
}

async function redo() {
  if (!redoStack.length) return toast("Nothing to redo.");

  const entry = redoStack.pop();
  const layer = getLayer(entry.layerId);

  if (!layer) return toast("That layer no longer exists.");

  undoStack.push({
    layerId: layer.id,
    image: layer.canvas.toDataURL("image/png")
  });

  await loadLayerImage(layer, entry.image);
  renderLayers();
  markDirty();
  setStatus("Redo");
}

function getRGBA(hex, alpha = 255) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
    alpha
  ];
}

function sameColor(data, offset, color) {
  return data[offset] === color[0] &&
    data[offset + 1] === color[1] &&
    data[offset + 2] === color[2] &&
    data[offset + 3] === color[3];
}

function floodFill(layer, x, y) {
  x = Math.floor(x);
  y = Math.floor(y);

  if (x < 0 || y < 0 || x >= width || y >= height) return false;

  const image = layer.ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const start = (y * width + x) * 4;
  const target = [
    data[start], data[start + 1],
    data[start + 2], data[start + 3]
  ];
  const replacement = getRGBA(state.color, Math.round(state.opacity * 255));

  if (sameColor(data, start, replacement)) return false;

  // Avoid locking up the browser on a huge fill.
  if (width * height > 8_000_000) {
    toast("Canvas too large for the fill tool.");
    return false;
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  queue[tail++] = y * width + x;
  visited[y * width + x] = 1;

  while (head < tail) {
    const pos = queue[head++];
    const px = pos % width;
    const py = Math.floor(pos / width);
    const offset = pos * 4;

    if (!sameColor(data, offset, target)) continue;

    data[offset] = replacement[0];
    data[offset + 1] = replacement[1];
    data[offset + 2] = replacement[2];
    data[offset + 3] = replacement[3];

    const neighbors = [
      px > 0 ? pos - 1 : -1,
      px < width - 1 ? pos + 1 : -1,
      py > 0 ? pos - width : -1,
      py < height - 1 ? pos + width : -1
    ];

    for (const n of neighbors) {
      if (n < 0 || visited[n]) continue;

      const no = n * 4;
      if (sameColor(data, no, target)) {
        visited[n] = 1;
        queue[tail++] = n;
      }
    }
  }

  layer.ctx.putImageData(image, 0, 0);
  return true;
}

function drawSegment(ctx, from, to, erase = false) {
  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  ctx.strokeStyle = state.color;
  ctx.lineWidth = state.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawShape(ctx, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = state.color;
  ctx.fillStyle = state.color;
  ctx.lineWidth = state.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();

  if (tool === "line") {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  } else if (tool === "rect") {
    if (state.shapeMode === "fill") {
      ctx.rect(from.x, from.y, dx, dy);
    } else {
      ctx.rect(from.x, from.y, dx, dy);
    }
  } else if (tool === "ellipse") {
    ctx.ellipse(
      from.x + dx / 2,
      from.y + dy / 2,
      Math.abs(dx / 2),
      Math.abs(dy / 2),
      0, 0, Math.PI * 2
    );
  }

  if (tool === "rect" && state.shapeMode === "fill") {
    ctx.fill();
  } else if (tool === "ellipse" && state.shapeMode === "fill") {
    ctx.fill();
  } else {
    ctx.stroke();
  }

  ctx.restore();
}

function sampleColor(point) {
  // Composite all visible layers into a temporary canvas.
  const temp = document.createElement("canvas");
  temp.width = width;
  temp.height = height;
  const ctx = temp.getContext("2d", { willReadFrequently: true });

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  const pixel = ctx.getImageData(
    Math.floor(point.x), Math.floor(point.y), 1, 1
  ).data;

  if (pixel[3] === 0) return toast("Transparent pixel.");
  const hex = "#" + [pixel[0], pixel[1], pixel[2]]
    .map(n => n.toString(16).padStart(2, "0"))
    .join("");

  setColor(hex);
}

function drawText(layer, point) {
  const text = prompt("Enter your text:");
  if (text === null || text === "") return;

  rememberUndo(layer);
  layer.ctx.save();
  layer.ctx.globalAlpha = state.opacity;
  layer.ctx.globalCompositeOperation = "source-over";
  layer.ctx.fillStyle = state.color;
  layer.ctx.font = `${state.fontSize}px sans-serif`;
  layer.ctx.textBaseline = "top";

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    layer.ctx.fillText(line, point.x, point.y + index * state.fontSize * 1.2);
  });

  layer.ctx.restore();
  renderLayers();
  markDirty();
  setStatus("Text added");
}

function updateCanvasCoordinates(event) {
  const point = screenToCanvas(event);
  $("coordinates").textContent =
    `X: ${Math.round(point.x)} Y: ${Math.round(point.y)}`;
}

viewport.addEventListener("pointerdown", event => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest("button, input, select")) return;

  if (spaceDown || tool === "pan" || event.button === 1) {
    panning = true;
    lastPoint = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }

  const layer = activeLayer();
  if (!layer) return;

  const point = screenToCanvas(event);

  if (tool === "eyedropper") {
    sampleColor(point);
    return;
  }

  if (tool === "text") {
    drawText(layer, point);
    return;
  }

  if (tool === "fill") {
    rememberUndo(layer);
    const changed = floodFill(layer, point.x, point.y);
    if (!changed) undoStack.pop();
    else {
      renderLayers();
      markDirty();
      setStatus("Filled area");
    }
    return;
  }

  drawing = true;
  activePointer = event.pointerId;
  startPoint = point;
  lastPoint = point;
  beforeAction = layer.ctx.getImageData(0, 0, width, height);
  rememberUndo(layer);

  try { viewport.setPointerCapture(event.pointerId); } catch {}

  if (tool === "pen" || tool === "eraser") {
    drawSegment(layer.ctx, point, point, tool === "eraser");
  }

  event.preventDefault();
});

viewport.addEventListener("pointermove", event => {
  updateCanvasCoordinates(event);

  if (panning) {
    panX += event.clientX - lastPoint.x;
    panY += event.clientY - lastPoint.y;
    lastPoint = { x: event.clientX, y: event.clientY };
    applyTransform();
    return;
  }

  if (!drawing || event.pointerId !== activePointer) return;

  const layer = activeLayer();
  if (!layer) return;

  const point = screenToCanvas(event);

  if (tool === "pen" || tool === "eraser") {
    drawSegment(layer.ctx, lastPoint, point, tool === "eraser");
    lastPoint = point;
  } else {
    layer.ctx.putImageData(beforeAction, 0, 0);
    drawShape(layer.ctx, startPoint, point);
  }
});

function finishDrawing(event) {
  if (panning) {
    panning = false;
    return;
  }

  if (!drawing) return;
  if (activePointer !== null && event.pointerId !== activePointer) return;

  const layer = activeLayer();

  if (layer && beforeAction && startPoint) {
    const point = screenToCanvas(event);

    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      layer.ctx.putImageData(beforeAction, 0, 0);
      drawShape(layer.ctx, startPoint, point);
    }

    renderLayers();
    markDirty();
    setStatus("Drawing updated");
  }

  drawing = false;
  activePointer = null;
  startPoint = null;
  lastPoint = null;
  beforeAction = null;
}

viewport.addEventListener("pointerup", finishDrawing);
viewport.addEventListener("pointercancel", finishDrawing);
viewport.addEventListener("contextmenu", event => event.preventDefault());

viewport.addEventListener("wheel", event => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setZoom(zoom * (event.deltaY < 0 ? 1.1 : 0.9),
    event.clientX, event.clientY);
}, { passive: false });

function setTool(nextTool) {
  tool = nextTool;
  document.querySelectorAll(".tool").forEach(button => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });

  viewport.style.cursor = tool === "pan" ? "grab" :
    tool === "text" ? "text" : "crosshair";

  setStatus("Tool: " + tool);
}

$("toolGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-tool]");
  if (button) setTool(button.dataset.tool);
});

function setColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;

  state.color = color.toLowerCase();
  $("colorPicker").value = state.color;
  $("hexInput").value = state.color.toUpperCase();
  $("colorHex").textContent = state.color.toUpperCase();
  renderPalette();
}

function renderPalette() {
  const container = $("palette");
  container.replaceChildren();

  paletteColors.forEach(color => {
    const button = document.createElement("button");
    button.className = "swatch" + (
      color.toLowerCase() === state.color ? " active" : ""
    );
    button.style.setProperty("--swatch", color);
    button.title = color;
    button.setAttribute("aria-label", `Choose ${color}`);
    button.addEventListener("click", () => setColor(color));
    container.appendChild(button);
  });
}

$("colorPicker").addEventListener("input", e => setColor(e.target.value));
$("hexInput").addEventListener("change", e => {
  let value = e.target.value.trim();
  if (/^[0-9a-fA-F]{6}$/.test(value)) value = "#" + value;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) setColor(value);
  else {
    e.target.value = state.color.toUpperCase();
    toast("Enter a valid hex color.");
  }
});

$("addColorBtn").addEventListener("click", () => {
  if (paletteColors.some(c => c.toLowerCase() === state.color)) {
    return toast("Color already in palette.");
  }
  if (paletteColors.length >= 36) return toast("Palette is full.");
  paletteColors.push(state.color);
  renderPalette();
});

$("brushSize").addEventListener("input", e => {
  state.size = Number(e.target.value);
  $("sizeValue").textContent = state.size + " px";
});

$("brushOpacity").addEventListener("input", e => {
  state.opacity = Number(e.target.value) / 100;
  $("opacityValue").textContent = e.target.value + "%";
});

$("shapeMode").addEventListener("change", e => state.shapeMode = e.target.value);
$("fontSize").addEventListener("change", e => {
  state.fontSize = Math.max(8, Math.min(300, Number(e.target.value) || 32));
  e.target.value = state.fontSize;
});

$("undoBtn").addEventListener("click", undo);
$("redoBtn").addEventListener("click", redo);

$("zoomInBtn").addEventListener("click", () => setZoom(zoom * 1.2));
$("zoomOutBtn").addEventListener("click", () => setZoom(zoom / 1.2));
$("zoomValue").addEventListener("click", fitCanvas);
$("fitBtn").addEventListener("click", fitCanvas);

function toggleGrid() {
  state.grid = !state.grid;
  $("gridToggle").checked = state.grid;
  $("gridBtn").classList.toggle("primary", state.grid);
  renderGrid();
}

$("gridToggle").addEventListener("change", e => {
  state.grid = e.target.checked;
  $("gridBtn").classList.toggle("primary", state.grid);
  renderGrid();
});
$("gridBtn").addEventListener("click", toggleGrid);

$("backgroundToggle").addEventListener("change", e => {
  state.whiteBackground = e.target.checked;
});

$("addLayerBtn").addEventListener("click", () => addLayer());

$("renameLayerBtn").addEventListener("click", () => {
  const layer = activeLayer();
  if (!layer) return;

  const name = prompt("Layer name:", layer.name);
  if (name === null || !name.trim()) return;

  layer.name = name.trim().slice(0, 60);
  renderLayers();
  markDirty();
});

$("duplicateLayerBtn").addEventListener("click", () => {
  const original = activeLayer();
  if (!original || layers.length >= 30) return toast("Cannot duplicate layer.");

  const copy = addLayer(original.name + " copy");
  copy.ctx.drawImage(original.canvas, 0, 0);
  copy.visible = original.visible;
  copy.opacity = original.opacity;
  copy.blend = original.blend;
  copy.canvas.style.display = copy.visible ? "block" : "none";
  renderLayers();
  markDirty();
});

$("deleteLayerBtn").addEventListener("click", () => {
  if (layers.length <= 1) return toast("Keep at least one layer.");

  const index = layers.findIndex(l => l.id === activeLayerId);
  layers.splice(index, 1);
  activeLayerId = layers[Math.max(0, index - 1)].id;
  renderLayers();
  markDirty();
});

function moveLayer(direction) {
  const index = layers.findIndex(l => l.id === activeLayerId);
  const target = index + direction;

  if (target < 0 || target >= layers.length) return;

  [layers[index], layers[target]] = [layers[target], layers[index]];
  renderLayers();
  markDirty();
}

$("moveLayerUpBtn").addEventListener("click", () => moveLayer(1));
$("moveLayerDownBtn").addEventListener("click", () => moveLayer(-1));

$("layerOpacity").addEventListener("input", e => {
  const layer = activeLayer();
  if (!layer) return;
  layer.opacity = Number(e.target.value) / 100;
  $("layerOpacityValue").textContent = e.target.value + "%";
  updateLayerCanvasStyle(layer);
  markDirty();
});

$("layerBlend").addEventListener("change", e => {
  const layer = activeLayer();
  if (!layer) return;
  layer.blend = e.target.value;
  updateLayerCanvasStyle(layer);
  markDirty();
});

const presets = {
  square: [1000, 1000],
  portrait: [900, 1200],
  landscape: [1200, 800],
  a4: [992, 1403]
};

$("canvasPreset").addEventListener("change", e => {
  const size = presets[e.target.value];
  if (!size) return;
  $("canvasWidth").value = size[0];
  $("canvasHeight").value = size[1];
});

$("resizeBtn").addEventListener("click", () => {
  const newWidth = Number($("canvasWidth").value);
  const newHeight = Number($("canvasHeight").value);

  if (!Number.isInteger(newWidth) || !Number.isInteger(newHeight) ||
      newWidth < 1 || newHeight < 1 ||
      newWidth > MAX_PIXELS || newHeight > MAX_PIXELS ||
      newWidth * newHeight > 8_000_000) {
    return toast("Use dimensions up to 4096 px and 8 million pixels.");
  }

  if (!confirm("Resize the canvas? Existing artwork will be scaled.")) return;

  width = newWidth;
  height = newHeight;

  for (const layer of layers) {
    const old = document.createElement("canvas");
    old.width = layer.canvas.width;
    old.height = layer.canvas.height;
    old.getContext("2d").drawImage(layer.canvas, 0, 0);

    layer.canvas.width = width;
    layer.canvas.height = height;
    layer.ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
    layer.ctx.lineCap = "round";
    layer.ctx.lineJoin = "round";
    layer.ctx.drawImage(old, 0, 0, width, height);
  }

  undoStack = [];
  redoStack = [];
  syncCanvasDimensions();
  renderLayers();
  fitCanvas();
  markDirty();
  toast("Canvas resized.");
});

function compositeCanvas(includeBackground = state.whiteBackground) {
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const ctx = output.getContext("2d");

  if (includeBackground) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  }

  return output;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .trim().slice(0, 100) || "DrawPad-artwork";
}

$("exportBtn").addEventListener("click", () => {
  const canvas = compositeCanvas();
  canvas.toBlob(blob => {
    if (!blob) return toast("PNG export failed.");
    downloadBlob(blob, safeFilename(documentTitle) + ".png");
    toast("PNG exported!");
  }, "image/png");
});

function projectData() {
  return {
    app: "DrawPad",
    version: 1,
    width,
    height,
    title: documentTitle,
    background: state.whiteBackground,
    palette: paletteColors,
    color: state.color,
    layers: layers.map(layer => ({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blend: layer.blend,
      image: layer.canvas.toDataURL("image/png")
    }))
  };
}

$("saveBtn").addEventListener("click", () => {
  try {
    const json = JSON.stringify(projectData());
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, safeFilename(documentTitle) + ".drawpad");
    markSaved();
    toast("Project saved.");
  } catch (error) {
    console.error(error);
    toast("Save failed. Try a smaller canvas.");
  }
});

$("openBtn").addEventListener("click", () => projectFile.click());

projectFile.addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error("Project file exceeds 100 MB.");
    }

    const data = JSON.parse(await file.text());

    if (data.app !== "DrawPad" || data.version !== 1 ||
        !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
        data.width < 1 || data.height < 1 ||
        data.width > MAX_PIXELS || data.height > MAX_PIXELS ||
        data.width * data.height > 8_000_000 ||
        !Array.isArray(data.layers) || !data.layers.length ||
        data.layers.length > 30) {
      throw new Error("Invalid or unsupported DrawPad project.");
    }

    if (dirty && !confirm("Discard your unsaved changes and open this project?")) {
      return;
    }

    width = data.width;
    height = data.height;
    documentTitle = typeof data.title === "string"
      ? data.title.slice(0, 100) : "Untitled artwork";

    layers = [];
    nextLayerId = 1;
    undoStack = [];
    redoStack = [];

    syncCanvasDimensions();

    for (const item of data.layers) {
      if (typeof item.image !== "string" ||
          !item.image.startsWith("data:image/png;base64,")) {
        throw new Error("Invalid layer image.");
      }

      const layer = createCanvasLayer(
        typeof item.name === "string" ? item.name.slice(0, 60) : "Layer"
      );

      layer.visible = item.visible !== false;
      layer.opacity = Number.isFinite(item.opacity)
        ? Math.max(0, Math.min(1, item.opacity)) : 1;

      const validBlends = [
        "source-over", "multiply", "screen", "overlay", "darken", "lighten"
      ];
      layer.blend = validBlends.includes(item.blend) ? item.blend : "source-over";
      layer.canvas.style.display = layer.visible ? "block" : "none";

      await loadLayerImage(layer, item.image);
      layers.push(layer);
    }

    activeLayerId = layers[layers.length - 1].id;
    state.whiteBackground = data.background !== false;
    $("backgroundToggle").checked = state.whiteBackground;

    if (Array.isArray(data.palette)) {
      paletteColors = data.palette.filter(c =>
        typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)
      ).slice(0, 36);
    }

    if (typeof data.color === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(data.color)) {
      setColor(data.color);
    } else {
      renderPalette();
    }

    $("documentName").textContent = documentTitle;
    $("canvasPreset").value = "custom";
    syncCanvasDimensions();
    renderLayers();
    fitCanvas();
    markSaved();
    toast("Project opened!");
  } catch (error) {
    console.error(error);
    toast(error.message || "Could not open project.");
  } finally {
    projectFile.value = "";
  }
});

$("newBtn").addEventListener("click", () => {
  if (dirty && !confirm("Discard unsaved changes and start a new drawing?")) {
    return;
  }

  width = 1000;
  height = 1000;
  documentTitle = "Untitled artwork";
  layers = [];
  undoStack = [];
  redoStack = [];
  nextLayerId = 1;

  addLayer("Background");
  syncCanvasDimensions();
  $("documentName").textContent = documentTitle;
  $("canvasPreset").value = "custom";
  fitCanvas();
  markSaved();
  toast("New canvas created.");
});

document.addEventListener("keydown", event => {
  const tag = event.target.tagName;
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);

  if (event.code === "Space" && !typing) {
    spaceDown = true;
    viewport.style.cursor = "grab";
    event.preventDefault();
  }

  if (typing) return;

  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (mod && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }

  if (mod && key === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if (mod && key === "s") {
    event.preventDefault();
    $("saveBtn").click();
    return;
  }

  if (mod && key === "o") {
    event.preventDefault();
    $("openBtn").click();
    return;
  }

  if (key === "b") setTool("pen");
  else if (key === "e") setTool("eraser");
  else if (key === "g") setTool("fill");
  else if (key === "t") setTool("text");
  else if (key === "i") setTool("eyedropper");
  else if (key === "h") setTool("pan");
  else if (key === "l") setTool("line");
  else if (key === "r") setTool("rect");
  else if (key === "o") setTool("ellipse");
});

document.addEventListener("keyup", event => {
  if (event.code === "Space") {
    spaceDown = false;
    if (!panning) {
      viewport.style.cursor = tool === "pan" ? "grab" : "crosshair";
    }
  }
});

window.addEventListener("blur", () => {
  spaceDown = false;
  if (drawing) {
    drawing = false;
    beforeAction = null;
    activePointer = null;
  }
  panning = false;
});

window.addEventListener("resize", () => {
  // Preserve the current zoom and artwork when the window changes.
  applyTransform();
});

// Start the app.
addLayer("Layer 1");
syncCanvasDimensions();
renderPalette();
renderLayers();
setColor(state.color);

requestAnimationFrame(() => {
  fitCanvas();
  setStatus("Ready to draw");
});
