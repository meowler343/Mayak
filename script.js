const $ = (selector) => document.querySelector(selector);
const canvas = $('#editorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
const stage = $('#canvasStage');
const fileInput = $('#fileInput');
const emptyState = $('#emptyState');
const properties = $('#propertiesPanel');
const appMode = new URLSearchParams(window.location.search).get('app') === '1';
if (appMode) $('#downloadAppButton').hidden = true;

const defaults = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0 };
let image = null;
let imageUrl = '';
let adjustments = { ...defaults };
let rotation = 0;
let flipped = false;
let zoom = 1;
let textLayers = [];
let undoStack = [];
let redoStack = [];
let activePreset = 'original';
let activeTextIndex = -1;
let draggingText = -1;
let compareMode = false;
let cropStart = null;
let toastTimer;
const presets = {
  original: { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0 },
  film: { brightness: 104, contrast: 92, saturation: 78, warmth: 14, blur: 0 },
  mono: { brightness: 102, contrast: 112, saturation: 0, warmth: 0, blur: 0 },
  warm: { brightness: 105, contrast: 103, saturation: 112, warmth: 25, blur: 0 },
  fade: { brightness: 110, contrast: 82, saturation: 76, warmth: 7, blur: 0 },
  dream: { brightness: 108, contrast: 88, saturation: 118, warmth: 10, blur: 1 }
};

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function saveUndo() {
  if (!image) return;
  undoStack.push(captureState());
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function captureState() {
  return { image, adjustments: { ...adjustments }, rotation, flipped, activePreset,
    textLayers: textLayers.map((layer) => ({ ...layer })) };
}

function restoreState(state) {
  image = state.image; adjustments = { ...state.adjustments };
  rotation = state.rotation; flipped = state.flipped; activePreset = state.activePreset || 'original';
  textLayers = state.textLayers.map((layer) => ({ ...layer })); activeTextIndex = -1; $('#editTextControls').hidden = true;
  updateOutputs(); updatePresetButtons();
  $('#sideImageSize').textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
  render();
}

function updateHistoryButtons() {
  $('#undoButton').disabled = undoStack.length === 0;
  $('#redoButton').disabled = redoStack.length === 0;
}

function updateSliderTrack(input) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  const percent = ((value - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right,var(--lime) ${percent}%,#494b49 ${percent}%)`;
}

function updateOutputs() {
  Object.entries(adjustments).forEach(([key, value]) => {
    const input = $(`#${key}`);
    input.value = value;
    updateSliderTrack(input);
    const output = $(`#${key}Value`);
    output.textContent = key === 'blur' ? `${value}px` : key === 'warmth' ? (value > 0 ? `+${value}` : value) : `${value}%`;
  });
}

function setCanvasSize() {
  if (!image) return;
  const sideways = Math.abs(rotation % 180) === 90;
  canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
  canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
  $('#imageDimensions').textContent = `${canvas.width} × ${canvas.height} px`;
}

function fitCanvas() {
  if (!image) return;
  const availableWidth = Math.max(stage.clientWidth - 64, 100);
  const availableHeight = Math.max(stage.clientHeight - 64, 100);
  const fit = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
  const scale = fit * zoom;
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
  $('#zoomValue').textContent = `${Math.round(zoom * 100)}%`;
}

function render() {
  if (!image) return;
  setCanvasSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipped ? -1 : 1, 1);
  const warmth = Math.max(0, adjustments.warmth) / 100;
  const presetFilter = { original: '', film: ' sepia(10%)', mono: ' grayscale(100%)', warm: ' sepia(15%)', fade: ' contrast(88%)', dream: ' saturate(120%)' }[activePreset] || '';
  ctx.filter = compareMode ? 'none' : `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%) sepia(${warmth}) blur(${adjustments.blur}px)${presetFilter}`;
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.restore();

  if (!compareMode && adjustments.warmth < 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(90,150,255,${Math.abs(adjustments.warmth) / 260})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  if (!compareMode) textLayers.forEach((layer) => {
    ctx.save();
    ctx.fillStyle = layer.color;
    const textSize = layer.size * canvas.width / 1000;
    ctx.font = `700 ${textSize}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = Math.max(2, textSize / 12);
    ctx.fillText(layer.text, layer.x * canvas.width, layer.y * canvas.height, canvas.width * .86);
    ctx.restore();
  });
  fitCanvas();
  updateLayerList();
}

function updateLayerList() {
  const layerContainer = $('#textLayers');
  layerContainer.replaceChildren();
  textLayers.forEach((layer, index) => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    const eye = document.createElement('span'); eye.className = 'layer-eye'; eye.textContent = '◉';
    const thumb = document.createElement('span'); thumb.className = 'layer-thumb'; thumb.textContent = 'T';
    const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = layer.text;
    const remove = document.createElement('button'); remove.className = 'layer-lock'; remove.type = 'button'; remove.title = 'Удалить слой'; remove.textContent = '×';
    row.classList.toggle('selected', index === activeTextIndex);
    row.addEventListener('click', () => selectTextLayer(index));
    remove.addEventListener('click', (event) => { event.stopPropagation(); saveUndo(); textLayers.splice(index, 1); activeTextIndex = -1; $('#editTextControls').hidden = true; render(); });
    row.append(eye, thumb, name, remove);
    layerContainer.append(row);
  });
}

function openImage(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Выберите файл изображения.'); return; }
  if (file.size > 20 * 1024 * 1024) { showToast('Файл больше 20 МБ. Выберите изображение поменьше.'); return; }
  const nextUrl = URL.createObjectURL(file);
  const nextImage = new Image();
  nextImage.onload = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = nextUrl;
    image = nextImage;
    adjustments = { ...defaults };
    rotation = 0; flipped = false; zoom = 1; textLayers = []; undoStack = []; redoStack = [];
    activePreset = 'original'; activeTextIndex = -1; $('#editTextControls').hidden = true;
    emptyState.hidden = true;
    canvas.style.display = 'block';
    $('#documentName').textContent = file.name;
    $('#sideImageName').textContent = file.name;
    $('#sideImageSize').textContent = `${Math.round(nextImage.naturalWidth)} × ${Math.round(nextImage.naturalHeight)} px`;
    $('#layerName').textContent = file.name;
    $('#miniPreview').replaceChildren();
    const thumbnail = document.createElement('img'); thumbnail.src = nextUrl; thumbnail.alt = '';
    $('#miniPreview').append(thumbnail);
    $('#exportButton').disabled = false;
    $('#compareButton').disabled = false;
    $('#resetButton').disabled = false;
    $('#addTextButton').disabled = false;
    $('#canvasHint').textContent = 'Настройте фото и сохраните результат';
    updateOutputs(); updatePresetButtons(); updateHistoryButtons();
    render();
    showToast('Изображение открыто');
    properties.classList.remove('open');
  };
  nextImage.onerror = () => { URL.revokeObjectURL(nextUrl); showToast('Не удалось открыть это изображение.'); };
  nextImage.src = nextUrl;
}

function resetAdjustments() {
  if (!image) return;
  saveUndo();
  adjustments = { ...defaults };
  activePreset = 'original'; updatePresetButtons();
  updateOutputs();
  render();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(captureState());
  restoreState(undoStack.pop()); updateHistoryButtons(); showToast('Действие отменено');
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(captureState());
  restoreState(redoStack.pop()); updateHistoryButtons(); showToast('Действие возвращено');
}

function exportImage() {
  if (!image) return;
  const format = $('#exportFormat').value;
  const scale = Number($('#exportScale').value);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));
  const outCtx = output.getContext('2d');
  if (format === 'image/jpeg') { outCtx.fillStyle = '#fff'; outCtx.fillRect(0, 0, output.width, output.height); }
  outCtx.drawImage(canvas, 0, 0, output.width, output.height);
  output.toBlob((blob) => {
    if (!blob) { showToast('Не удалось сохранить изображение.'); return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const base = ($('#documentName').textContent || 'mayak').replace(/\.[^.]+$/, '');
    const extension = format === 'image/jpeg' ? 'jpg' : 'png';
    link.download = `${base}-mayak.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(`Готово — скачан файл ${extension.toUpperCase()}`);
  }, format, Number($('#exportQuality').value) / 100);
}

function updatePresetButtons() {
  document.querySelectorAll('.preset').forEach((button) => button.classList.toggle('active', button.dataset.preset === activePreset));
}

function applyPreset(name) {
  if (!image) return showToast('Сначала откройте изображение.');
  saveUndo(); activePreset = name; adjustments = { ...presets[name] };
  updateOutputs(); updatePresetButtons(); render();
}

function selectTextLayer(index) {
  activeTextIndex = index;
  $('#editTextControls').hidden = index < 0;
  if (index < 0) return;
  const layer = textLayers[index];
  $('#editTextInput').value = layer.text; $('#editTextSize').value = String(layer.size); $('#editTextColor').value = layer.color;
  document.querySelectorAll('#textLayers .layer-row').forEach((row, rowIndex) => row.classList.toggle('selected', rowIndex === index));
}

function activateTool(tool) {
  if (tool === 'crop' && !image) { showToast('Сначала откройте изображение.'); return; }
  document.querySelectorAll('.tool[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  const names = { move: ['↖', 'Перемещение'], text: ['T', 'Текст'], crop: ['⌗', 'Обрезка'] };
  $('#toolIndicator').textContent = names[tool][0];
  $('#toolName').textContent = names[tool][1];
  canvas.dataset.tool = tool;
  canvas.style.cursor = tool === 'text' ? 'text' : tool === 'crop' ? 'crosshair' : 'default';
  if (tool === 'text') { $('#textInput').focus(); properties.classList.add('open'); }
  if (tool === 'crop') beginCrop();
  else $('#cropOverlay').hidden = true;
}

function beginCrop() {
  const rect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const overlay = $('#cropOverlay');
  const box = $('#cropBox');
  const insetX = rect.width * .08, insetY = rect.height * .08;
  const left = rect.left - stageRect.left + insetX;
  const top = rect.top - stageRect.top + insetY;
  box.style.left = `${left}px`; box.style.top = `${top}px`;
  box.style.width = `${rect.width - insetX * 2}px`; box.style.height = `${rect.height - insetY * 2}px`;
  $('#cropBox').nextElementSibling.style.left = `${left + (rect.width - insetX * 2) / 2}px`;
  $('#cropBox').nextElementSibling.style.top = `${top + rect.height - insetY * 2 + 9}px`;
  overlay.hidden = false;
  $('#cropRatio').value = 'free';
}

function applyCropRatio() {
  const ratioValue = $('#cropRatio').value;
  if (ratioValue === 'free' || !image) return;
  const [rw, rh] = ratioValue.split(':').map(Number);
  const ratio = rw / rh;
  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const maxWidth = canvasRect.width * .84, maxHeight = canvasRect.height * .84;
  let width = Math.min(maxWidth, maxHeight * ratio), height = width / ratio;
  if (height > maxHeight) { height = maxHeight; width = height * ratio; }
  const left = canvasRect.left - stageRect.left + (canvasRect.width - width) / 2;
  const top = canvasRect.top - stageRect.top + (canvasRect.height - height) / 2;
  $('#cropBox').style.left = `${left}px`; $('#cropBox').style.top = `${top}px`;
  $('#cropBox').style.width = `${width}px`; $('#cropBox').style.height = `${height}px`;
  $('#cropBox').nextElementSibling.style.left = `${left + width / 2}px`;
  $('#cropBox').nextElementSibling.style.top = `${top + height + 9}px`;
}

function applyCrop() {
  const boxRect = $('#cropBox').getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const sx = Math.max(0, Math.round((boxRect.left - canvasRect.left) * canvas.width / canvasRect.width));
  const sy = Math.max(0, Math.round((boxRect.top - canvasRect.top) * canvas.height / canvasRect.height));
  const sw = Math.min(canvas.width - sx, Math.round(boxRect.width * canvas.width / canvasRect.width));
  const sh = Math.min(canvas.height - sy, Math.round(boxRect.height * canvas.height / canvasRect.height));
  if (sw < 2 || sh < 2) { showToast('Выделите область для обрезки.'); return; }
  const cropped = document.createElement('canvas'); cropped.width = sw; cropped.height = sh;
  cropped.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedImage = new Image();
  croppedImage.onload = () => {
    saveUndo();
    image = croppedImage;
    rotation = 0; flipped = false; textLayers = [];
    adjustments = { ...defaults }; activePreset = 'original'; activeTextIndex = -1;
    updateOutputs(); updatePresetButtons(); render();
    $('#cropOverlay').hidden = true;
    activateTool('move');
    showToast('Обрезка применена');
  };
  croppedImage.src = cropped.toDataURL('image/png');
}

$('#openButton').addEventListener('click', () => fileInput.click());
$('#openRailButton').addEventListener('click', () => fileInput.click());
$('#replaceButton').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => { openImage(event.target.files[0]); event.target.value = ''; });
$('#exportButton').addEventListener('click', exportImage);
$('#undoButton').addEventListener('click', undo);
$('#redoButton').addEventListener('click', redo);
$('#resetButton').addEventListener('click', resetAdjustments);
$('#resetAdjustments').addEventListener('click', resetAdjustments);
$('#rotateButton').addEventListener('click', () => { if (!image) return showToast('Сначала откройте изображение.'); saveUndo(); rotation = (rotation + 90) % 360; render(); });
$('#flipButton').addEventListener('click', () => { if (!image) return showToast('Сначала откройте изображение.'); saveUndo(); flipped = !flipped; render(); });
$('#zoomIn').addEventListener('click', () => { zoom = Math.min(zoom + .1, 2); fitCanvas(); });
$('#zoomOut').addEventListener('click', () => { zoom = Math.max(zoom - .1, .2); fitCanvas(); });
$('#fitButton').addEventListener('click', () => { zoom = 1; fitCanvas(); });
$('#panelToggle').addEventListener('click', () => properties.classList.toggle('open'));
$('#panelClose').addEventListener('click', () => properties.classList.remove('open'));
document.querySelectorAll('.tool[data-tool]').forEach((button) => button.addEventListener('click', () => activateTool(button.dataset.tool)));
document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
$('#cropRatio').addEventListener('change', applyCropRatio);

$('#compareButton').addEventListener('pointerdown', () => { if (image) { compareMode = true; render(); } });
['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => $('#compareButton').addEventListener(type, () => { compareMode = false; render(); }));

$('#saveTextButton').addEventListener('click', () => {
  if (activeTextIndex < 0) return;
  saveUndo();
  const layer = textLayers[activeTextIndex];
  layer.text = $('#editTextInput').value.trim() || layer.text;
  layer.size = Number($('#editTextSize').value); layer.color = $('#editTextColor').value;
  render(); selectTextLayer(activeTextIndex); showToast('Текстовый слой обновлён');
});

$('#exportQuality').addEventListener('input', (event) => { $('#qualityValue').textContent = `${event.target.value}%`; });

canvas.addEventListener('pointerdown', (event) => {
  if (!image || canvas.dataset.tool === 'text' || canvas.dataset.tool === 'crop') return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
  const index = textLayers.findIndex((layer) => {
    const textSize = layer.size * canvas.width / 1000;
    ctx.font = `700 ${textSize}px Manrope, sans-serif`;
    const halfWidth = Math.max(ctx.measureText(layer.text).width / (2 * canvas.width), .04);
    const halfHeight = textSize / canvas.height;
    return Math.abs(x - layer.x) < halfWidth && Math.abs(y - layer.y) < halfHeight;
  });
  if (index < 0) { selectTextLayer(-1); return; }
  saveUndo(); selectTextLayer(index); draggingText = index; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (draggingText < 0) return;
  const rect = canvas.getBoundingClientRect();
  textLayers[draggingText].x = Math.max(.03, Math.min(.97, (event.clientX - rect.left) / rect.width));
  textLayers[draggingText].y = Math.max(.03, Math.min(.97, (event.clientY - rect.top) / rect.height));
  render();
});
canvas.addEventListener('pointerup', () => { draggingText = -1; });

['brightness', 'contrast', 'saturation', 'warmth', 'blur'].forEach((key) => {
  const input = $(`#${key}`);
  input.addEventListener('pointerdown', saveUndo);
  input.addEventListener('keydown', (event) => { if (event.key.startsWith('Arrow')) saveUndo(); });
  input.addEventListener('input', () => { adjustments[key] = Number(input.value); updateOutputs(); render(); });
  updateSliderTrack(input);
});

$('#addTextButton').addEventListener('click', () => {
  const text = $('#textInput').value.trim();
  if (!image) return showToast('Сначала откройте изображение.');
  if (!text) { $('#textInput').focus(); showToast('Введите текст для слоя.'); return; }
  saveUndo();
  textLayers.push({ text, size: Number($('#textSize').value), color: $('#textColor').value, x: .5, y: .82 });
  render();
  $('#textInput').value = '';
  showToast('Текстовый слой добавлен');
});
$('#addTextLayer').addEventListener('click', () => activateTool('text'));
$('#textInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#addTextButton').click(); });
$('#cancelCrop').addEventListener('click', () => { $('#cropOverlay').hidden = true; activateTool('move'); });
$('#applyCrop').addEventListener('click', applyCrop);

$('#cropBox').addEventListener('pointerdown', (event) => {
  if (event.target.closest('.crop-actions')) return;
  const box = $('#cropBox');
  const rect = box.getBoundingClientRect();
  cropStart = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, corner: event.target.dataset.corner || '' };
  box.setPointerCapture(event.pointerId);
});
$('#cropBox').addEventListener('pointermove', (event) => {
  if (!cropStart) return;
  const stageRect = stage.getBoundingClientRect();
  const dx = event.clientX - cropStart.x, dy = event.clientY - cropStart.y;
  const bounds = canvas.getBoundingClientRect();
  let left = cropStart.left, top = cropStart.top, width = cropStart.width, height = cropStart.height;
  if (!cropStart.corner) {
    left = Math.max(bounds.left, Math.min(cropStart.left + dx, bounds.right - width));
    top = Math.max(bounds.top, Math.min(cropStart.top + dy, bounds.bottom - height));
  } else {
    const west = cropStart.corner.includes('w'), north = cropStart.corner.includes('n');
    if (west) { left = Math.max(bounds.left, Math.min(cropStart.left + dx, cropStart.left + cropStart.width - 36)); width = cropStart.left + cropStart.width - left; }
    else width = Math.max(36, Math.min(cropStart.width + dx, bounds.right - cropStart.left));
    if (north) { top = Math.max(bounds.top, Math.min(cropStart.top + dy, cropStart.top + cropStart.height - 36)); height = cropStart.top + cropStart.height - top; }
    else height = Math.max(36, Math.min(cropStart.height + dy, bounds.bottom - cropStart.top));
  }
  const box = $('#cropBox');
  box.style.left = `${left - stageRect.left}px`; box.style.top = `${top - stageRect.top}px`;
  box.style.width = `${width}px`; box.style.height = `${height}px`;
  box.nextElementSibling.style.left = `${left - stageRect.left + width / 2}px`;
  box.nextElementSibling.style.top = `${top - stageRect.top + height + 9}px`;
});
$('#cropBox').addEventListener('pointerup', () => { cropStart = null; });

['dragenter', 'dragover'].forEach((type) => stage.addEventListener(type, (event) => { event.preventDefault(); stage.classList.add('drag-active'); }));
['dragleave', 'drop'].forEach((type) => stage.addEventListener(type, (event) => { event.preventDefault(); stage.classList.remove('drag-active'); }));
stage.addEventListener('drop', (event) => openImage(event.dataTransfer.files[0]));
window.addEventListener('resize', fitCanvas);
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); fileInput.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportImage(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  if (event.key === 'Delete' && activeTextIndex >= 0 && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { saveUndo(); textLayers.splice(activeTextIndex, 1); activeTextIndex = -1; $('#editTextControls').hidden = true; render(); }
  if (!event.ctrlKey && !event.metaKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    const shortcuts = { v: 'move', t: 'text', c: 'crop' };
    if (shortcuts[event.key.toLowerCase()]) activateTool(shortcuts[event.key.toLowerCase()]);
  }
  if (event.key === 'Escape') { $('#cropOverlay').hidden = true; activateTool('move'); }
});
