/* Standalone visual review. Original assets are composed unchanged; no network writes or app state. */
const ids = ['character', 'report', 'question'];
const names = { character: '캐릭터 중심', report: '보고서 중심', question: '질문 중심' };
const defaults = ['오래 일했는데,', '내 강점은', '뭘까?'];
const fields = ['line1', 'line2', 'line3'].map(id => document.getElementById(id));
const status = document.getElementById('text-status');
const downloadStatus = document.getElementById('download-status');
const storageKey = 'myin-thumbnail-design-v1';
let selected = 'character';
let ready = false;
let valid = false;
let characterImage, reportImage, characterBounds;

function text(ctx, value, x, y, size, color = '#1E2430', weight = 750) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px Pretendard, sans-serif`;
  ctx.fillText(value, x, y);
}
function rounded(ctx, x, y, w, h, r, fill) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
}
function pill(ctx, value, x, y, color, background) {
  ctx.font = '600 23px Pretendard, sans-serif';
  const width = ctx.measureText(value).width + 38;
  rounded(ctx, x, y, width, 46, 23, background);
  text(ctx, value, x + 19, y + 31, 23, color, 600);
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('원본 이미지를 불러오지 못했습니다. 페이지를 새로고침해 주세요.'));
    image.src = url;
  });
}
function alphaBounds(image) {
  const helper = document.createElement('canvas');
  helper.width = image.width; helper.height = image.height;
  const ctx = helper.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, helper.width, helper.height);
  let left = image.width, top = image.height, right = 0, bottom = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (data[(y * image.width + x) * 4 + 3] > 0) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
function mascot(ctx, x, y, height) {
  const b = characterBounds;
  ctx.drawImage(characterImage, b.x, b.y, b.w, b.h, x, y, height * b.w / b.h, height);
}
function report(ctx, x, y, width, angle = 0) {
  // Crop only unused bottom statistic; keep every displayed pixel from the public sample.
  const sourceHeight = 1205;
  const height = width * sourceHeight / reportImage.width;
  ctx.save(); ctx.translate(x + width / 2, y + height / 2); ctx.rotate(angle * Math.PI / 180);
  ctx.shadowColor = '#1E243025'; ctx.shadowBlur = 32; ctx.shadowOffsetY = 10;
  rounded(ctx, -width / 2, -height / 2, width, height, 16, '#FFFFFF');
  ctx.shadowColor = 'transparent';
  ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, 16); ctx.clip();
  ctx.drawImage(reportImage, 0, 0, reportImage.width, sourceHeight, -width / 2, -height / 2, width, height);
  ctx.restore();
}
function fontSize(ctx, lines) {
  let size = 100;
  while (size >= 60) {
    ctx.font = `800 ${size}px Pretendard, sans-serif`;
    if (lines.every(line => ctx.measureText(line).width <= 920)) return size;
    size--;
  }
  return null;
}
function render(id, lines) {
  const canvas = document.getElementById(id), ctx = canvas.getContext('2d');
  const blue = id === 'question', ink = blue ? '#FFFFFF' : '#1E2430';
  ctx.clearRect(0, 0, 1080, 1350);
  ctx.fillStyle = blue ? '#2F65D9' : id === 'character' ? '#EEF4FF' : '#FFFFFF';
  ctx.fillRect(0, 0, 1080, 1350);
  if (id === 'report') { ctx.fillStyle = '#2F65D9'; ctx.fillRect(0, 0, 18, 1350); }
  text(ctx, 'MYIN', 80, 116, 45, blue ? '#FFFFFF' : '#2F65D9', 850);
  ctx.textAlign = 'right'; text(ctx, '나를 이해하는 질문', 1000, 110, 24, blue ? '#DCE7FF' : '#5B6472', 500); ctx.textAlign = 'left';
  const size = fontSize(ctx, lines);
  const fitted = size ?? 60;
  lines.forEach((line, i) => text(ctx, line, 80, 274 + i * 120, fitted, i === 1 && !blue ? '#2F65D9' : ink, 800));
  if (id === 'character') {
    ctx.fillStyle = '#DCE7FF'; ctx.beginPath(); ctx.arc(342, 947, 286, 0, Math.PI * 2); ctx.fill();
    report(ctx, 554, 642, 405, 5);
    pill(ctx, '공개 견본', 744, 600, '#2556BF', '#FFFFFF');
    mascot(ctx, 87, 621, 595);
  } else if (id === 'report') {
    rounded(ctx, 80, 565, 920, 657, 28, '#F6F8FC');
    report(ctx, 236, 588, 450);
    mascot(ctx, 708, 853, 350);
    pill(ctx, '공개 견본', 756, 596, '#2556BF', '#DCE7FF');
  } else {
    report(ctx, 87, 672, 385, -3);
    pill(ctx, '공개 견본', 96, 608, '#2556BF', '#FFFFFF');
    mascot(ctx, 540, 622, 594);
  }
  ctx.strokeStyle = blue ? '#FFFFFF50' : '#1E243024'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, 1250); ctx.lineTo(1000, 1250); ctx.stroke();
  text(ctx, '나를 이해하는 다음 장', 80, 1300, 30, ink, 600);
  ctx.textAlign = 'right'; text(ctx, 'MYIN', 1000, 1299, 23, blue ? '#DCE7FF' : '#5B6472', 650); ctx.textAlign = 'left';
  canvas.setAttribute('aria-label', `${names[id]} 썸네일: ${lines.join(' ')}. 마이인 원본 캐릭터와 공개 보고서 견본.`);
  return size;
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({ lines: fields.map(field => field.value), selected })); } catch { /* Usable without persistence. */ }
}
function renderAll() {
  if (!ready) return;
  const lines = fields.map(field => field.value.trim());
  const sizes = ids.map(id => render(id, lines));
  valid = lines.every(Boolean) && sizes.every(Boolean);
  status.classList.toggle('error', !valid);
  status.textContent = !lines.every(Boolean) ? '세 줄의 제목을 모두 입력해 주세요.' : !sizes.every(Boolean) ? '제목이 너무 깁니다. 각 줄을 조금 줄여 주세요.' : sizes[0] < 80 ? '글자가 작아졌어요. 한 줄을 더 짧게 쓰면 피드에서 잘 읽힙니다.' : '제목이 적용됐습니다. 글자 크기는 줄 길이에 맞춰 조절됩니다.';
  document.querySelectorAll('[data-download], #download-selected').forEach(button => { button.disabled = !valid; });
  persist();
}
function select(id) {
  if (!ids.includes(id)) return;
  selected = id;
  document.querySelectorAll('[data-select]').forEach(button => {
    const active = button.dataset.select === id;
    button.setAttribute('aria-pressed', String(active)); button.textContent = active ? '선택됨' : '이 디자인 선택';
  });
  document.querySelectorAll('[data-design]').forEach(card => card.classList.toggle('selected', card.dataset.design === id));
  document.getElementById('selection-name').textContent = `${names[id]} 디자인`;
  persist();
}
async function download(id) {
  if (!ready || !valid) return;
  try {
    const blob = await new Promise((resolve, reject) => document.getElementById(id).toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG를 만들지 못했습니다. 다시 시도해 주세요.')), 'image/png'));
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `myin-thumbnail-${id}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    downloadStatus.textContent = `${names[id]} PNG 다운로드를 시작했습니다. (1080 × 1350 px)`;
  } catch (error) { downloadStatus.textContent = error.message; }
}
fields.forEach(field => field.addEventListener('input', renderAll));
document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => select(button.dataset.select)));
document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', () => download(button.dataset.download)));
document.getElementById('download-selected').addEventListener('click', () => download(selected));
document.getElementById('reset').addEventListener('click', () => { fields.forEach((field, i) => { field.value = defaults[i]; }); renderAll(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('.gallery').classList.toggle('feed', button.dataset.view === 'feed');
  document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
async function init() {
  try {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved?.lines) && saved.lines.length === 3 && saved.lines.every(line => typeof line === 'string' && line.length <= 20)) fields.forEach((field, i) => { field.value = saved.lines[i]; });
      if (ids.includes(saved?.selected)) selected = saved.selected;
    } catch { /* Ignore invalid or unavailable browser storage. */ }
    [characterImage, reportImage] = await Promise.all([loadImage('./assets/character.png'), loadImage('./assets/report-sample.jpg')]);
    await document.fonts.load('800 100px Pretendard'); await document.fonts.load('500 24px Pretendard'); await document.fonts.ready;
    characterBounds = alphaBounds(characterImage); ready = true; select(selected); renderAll();
    document.body.dataset.ready = 'true';
  } catch (error) { status.textContent = error.message; status.classList.add('error'); }
}
init();
