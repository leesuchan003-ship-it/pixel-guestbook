(function () {
  const S = window.PixelSprite;
  const P = window.PhotoAnalyzer;
  const World = window.PixelWorld;

  const HAIR_LABELS = {
    short: '짧은머리', sideSwept: '옆가르마', middlePart: '가운데가르마', buzz: '스포츠머리',
    curly: '곱슬머리', medium: '단발', bob: '보브컷', long: '긴생머리',
    ponytail: '포니테일', bun: '올림머리', halfUp: '반묶음', wavyLong: '웨이브',
  };
  const OUTFIT_LABELS = {
    suit: '정장', jacket: '재킷', shirt: '셔츠', knit: '니트',
    hoodie: '후드', coat: '코트', dress: '원피스', blouse: '블라우스',
  };
  const ACC_LABELS = {
    none: '없음', glasses: '안경', sunglasses: '선글라스', cap: '모자', earring: '귀걸이', bouquet: '꽃다발',
  };
  const CLOTH_COLORS = ['#1b1d22', '#2b3038', '#39404d', '#4a5568', '#7a8496', '#c8ccd4', '#f0eee8',
    '#8a3b46', '#a8546b', '#3b5a4a', '#2f4a6b', '#7a5a33', '#c9a063', '#5b4a6b'];

  const MOVE_SPEED = 46; // 조이스틱으로 걸을 때 초당 월드 픽셀

  const state = {
    entries: [],
    config: { title: '단 한 번뿐인 결혼식', gallery: [] },
    cache: {},                 // 배경 오프스크린 캔버스 + height
    homes: new Map(),          // id -> {x,y} 제자리(고정) 좌표
    spriteCache: new Map(),    // id -> 빌드된 픽셀 그리드 (매 프레임 재계산 방지)
    camera: { y: 0 },
    zoom: 1,
    offsetX: 0,
    bubbles: new Map(),        // entryId -> 만료 timestamp (탭으로 강제 표시)
    myId: localStorage.getItem('pg_my_id') || null,
    myPos: null,               // 내 캐릭터의 실제 좌표(조이스틱으로 이동)
    joyVec: { x: 0, y: 0 },
    adminKey: sessionStorage.getItem('pg_admin') || null,
    draft: null,
    candidates: [],
    picked: -1,
    analysis: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#world');
  const ctx = canvas.getContext('2d');

  /* ---------------- 스프라이트 캐시 / 배치 ---------------- */

  function ensureGrid(entry) {
    if (entry.attrs.__grid) return;
    let g = state.spriteCache.get(entry.id);
    if (!g) {
      g = S.buildGrid(entry.attrs);
      state.spriteCache.set(entry.id, g);
    }
    entry.attrs.__grid = g;
  }

  function rebuildHomes() {
    state.homes = new Map();
    World.layout(state.entries).forEach((p) => state.homes.set(p.id, { x: p.x, y: p.y }));
    if (state.myId && state.homes.has(state.myId) && !state.myPos) {
      state.myPos = Object.assign({}, state.homes.get(state.myId));
    }
  }

  function clampMyPos(pos) {
    const maxY = (state.cache.height || 400) - 30;
    return {
      x: Math.max(2, Math.min(World.WORLD_W - World.SPRITE_W - 2, pos.x)),
      y: Math.max(World.ALTAR_Y - 10, Math.min(maxY, pos.y)),
    };
  }

  // 지금 이 순간(now)의 실제 화면 좌표. 내 캐릭터는 조이스틱 위치, 나머지는 제자리 서성임.
  function currentPos(id, home, now) {
    if (id === state.myId && state.myPos) return state.myPos;
    const w = World.wanderOffset(id, now);
    return { x: home.x + w.dx, y: home.y + w.dy };
  }

  function visibleSprites(now) {
    const out = [];
    for (const entry of state.entries) {
      const home = state.homes.get(entry.id);
      if (!home) continue;
      const pos = currentPos(entry.id, home, now);
      out.push({ entry, x: pos.x, y: pos.y });
    }
    out.sort((a, b) => (a.y - b.y));
    return out;
  }

  /* ---------------- 월드 렌더링 ---------------- */

  let needsDraw = true;
  let sceneDirty = true;

  function markDirty(scene) {
    if (scene) sceneDirty = true;
    needsDraw = true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    markDirty(true);
  }

  function viewMetrics() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const zoom = Math.max(1, Math.min(cssW / World.WORLD_W, 3));
    return { cssW, cssH, zoom, offsetX: Math.round((cssW - World.WORLD_W * zoom) / 2) };
  }

  function maxCameraY(zoom, cssH) {
    return Math.max(0, (state.cache.height || 0) - cssH / zoom);
  }

  function worldToScreen(x, y, zoom, offsetX) {
    return { sx: offsetX + x * zoom, sy: (y - state.camera.y) * zoom };
  }

  function draw() {
    const { cssW, cssH, zoom, offsetX } = viewMetrics();
    const viewH = cssH / zoom;
    if (sceneDirty) {
      World.renderBackground(state.cache, state.entries.length, viewH);
      sceneDirty = false;
    }
    state.zoom = zoom; state.offsetX = offsetX;
    state.camera.y = Math.max(0, Math.min(state.camera.y, maxCameraY(zoom, cssH)));

    ctx.fillStyle = '#4d7a3d';
    ctx.fillRect(0, 0, cssW, cssH);
    const scene = state.cache.canvas;
    if (scene) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scene, 0, state.camera.y, World.WORLD_W, viewH,
        offsetX, 0, World.WORLD_W * zoom, viewH * zoom);
    }

    const now = Date.now();
    drawCouple(now, zoom, offsetX, cssH);
    const sprites = visibleSprites(now);
    state.lastSprites = sprites;
    drawSprites(sprites, zoom, offsetX, cssH);
    drawLabels(sprites, zoom, offsetX, cssH);
    drawBubbles(sprites, now, zoom, offsetX, cssH);
  }

  function drawCouple(now, zoom, offsetX, cssH) {
    for (const c of World.couplePositions(state.config.couple, now)) {
      const { sx, sy } = worldToScreen(c.x, c.y, zoom, offsetX);
      if (sy < -SPRITE_MARGIN(zoom) || sy > cssH + SPRITE_MARGIN(zoom)) continue;
      S.drawTo(ctx, c.attrs, zoom, Math.round(sx), Math.round(sy));
    }
  }

  function SPRITE_MARGIN(zoom) { return World.SPRITE_H * zoom + 20; }

  function drawSprites(sprites, zoom, offsetX, cssH) {
    const margin = SPRITE_MARGIN(zoom);
    for (const p of sprites) {
      const { sx, sy } = worldToScreen(p.x, p.y, zoom, offsetX);
      if (sy < -margin || sy > cssH + margin) continue;
      ensureGrid(p.entry);
      S.drawTo(ctx, p.entry.attrs, zoom, Math.round(sx), Math.round(sy));
    }
  }

  function drawLabels(sprites, zoom, offsetX, cssH) {
    const nameSize = Math.max(10, Math.round(8.5 * zoom));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${nameSize}px "Galmuri11", "Apple SD Gothic Neo", system-ui, sans-serif`;
    ctx.lineWidth = Math.max(3, nameSize * 0.36);
    ctx.lineJoin = 'round';

    const drawn = [];
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const p of sprites) {
      const base = worldToScreen(p.x + World.SPRITE_W / 2, p.y + World.SPRITE_H + 8, zoom, offsetX);
      if (base.sy < -40 || base.sy > cssH + 60) continue;
      const name = p.entry.name || '';
      const w = ctx.measureText(name).width + 4;
      let sy = base.sy;
      for (let tries = 0; tries < 3; tries++) {
        const box = { x: base.sx - w / 2, y: sy - nameSize, w, h: nameSize + 2 };
        if (!drawn.some((d) => overlaps(box, d))) { drawn.push(box); break; }
        sy += nameSize + 2;
      }
      ctx.strokeStyle = 'rgba(12,16,10,0.85)';
      ctx.strokeText(name, base.sx, sy);
      ctx.fillStyle = p.entry.id === state.myId ? '#ffe9a8' : '#ffffff';
      ctx.fillText(name, base.sx, sy);
    }
  }

  const MAX_AUTO_BUBBLES = 2; // 한 화면에 자동 말풍선이 한꺼번에 여러 개 뜨지 않도록 제한

  function drawBubbles(sprites, now, zoom, offsetX, cssH) {
    for (const [id, until] of state.bubbles) {
      if (until < now) state.bubbles.delete(id);
    }
    const shown = new Set();
    const toDraw = [];
    const autoCandidates = [];
    for (const p of sprites) {
      const msg = (p.entry.message || '').trim();
      if (!msg) continue;
      const forced = (state.bubbles.get(p.entry.id) || 0) > now;
      if (forced) {
        toDraw.push({ p, msg });
        shown.add(p.entry.id);
        continue;
      }
      const sy = worldToScreen(p.x, p.y, zoom, offsetX).sy;
      if (sy > cssH + 60 || sy < -60) continue;
      const win = World.bubbleWindow(p.entry.id, now);
      if (win.active) autoCandidates.push({ p, msg, phase: win.phase });
    }
    // phase가 작을수록 "방금 시작한" 말풍선이라 이걸 우선 보여준다
    autoCandidates.sort((a, b) => a.phase - b.phase);
    for (const c of autoCandidates) {
      if (toDraw.length >= MAX_AUTO_BUBBLES + shown.size) break;
      if (shown.has(c.p.entry.id)) continue;
      toDraw.push(c);
    }

    const placed = [];
    for (const c of toDraw) drawBubble(c.p, c.msg, zoom, offsetX, cssH, placed);
  }

  function wrapText(text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of text) {
      if (ch === '\n') { lines.push(line); line = ''; continue; }
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = ch; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function drawBubble(p, msg, zoom, offsetX, cssH, placed) {
    const size = Math.max(11, Math.round(9 * zoom));
    ctx.font = `${size}px "Galmuri11", "Apple SD Gothic Neo", system-ui, sans-serif`;
    const maxW = Math.min(150 * zoom, window.innerWidth - 40);
    const lines = wrapText(msg, maxW - 16);
    const lineH = size * 1.45;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
    const h = lines.length * lineH + 12;

    const anchor = worldToScreen(p.x + World.SPRITE_W / 2, p.y - 4, zoom, offsetX);
    if (anchor.sy < -80 || anchor.sy > cssH + 80) return;
    let bx = anchor.sx - w / 2;
    bx = Math.max(8, Math.min(bx, window.innerWidth - w - 8));
    let by = anchor.sy - h - 6;

    // 다른 말풍선과 겹치면 위로 밀어 올린다 (여러 개가 한 화면에 뜰 때 대비)
    if (placed) {
      const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      let box = { x: bx, y: by, w, h };
      for (let tries = 0; tries < 6 && placed.some((d) => overlaps(box, d)); tries++) {
        by -= h + 8;
        box = { x: bx, y: by, w, h };
      }
      placed.push(box);
    }

    ctx.fillStyle = 'rgba(10,12,14,0.92)';
    ctx.strokeStyle = '#f2f0ea';
    ctx.lineWidth = 2;
    roundRect(bx, by, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(anchor.sx - 5, by + h - 1);
    ctx.lineTo(anchor.sx + 5, by + h - 1);
    ctx.lineTo(anchor.sx, by + h + 7);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,12,14,0.92)';
    ctx.fill();

    ctx.fillStyle = '#f2f0ea';
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 10 + lineH * (i + 0.72)));
    ctx.textAlign = 'center';
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loop() {
    if (needsDraw) { needsDraw = false; draw(); }
    requestAnimationFrame(loop);
  }

  // 하객이 제자리에서 서성이는 걸 계속 보여주려면 매 프레임 다시 그려야 한다.
  // 배터리를 아끼려고 화면이 안 보일 땐 멈추고, 그 외엔 draw()를 계속 요청한다.
  function ambientTick() {
    if (!document.hidden) markDirty(false);
  }
  setInterval(ambientTick, 90);

  /* ---------------- 카메라 조작 (화면을 끌면 카메라가 움직인다) ---------------- */

  let drag = null;
  let velocity = 0;

  canvas.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, x: e.clientX, startY: e.clientY, startX: e.clientX, moved: 0, t: Date.now() };
    velocity = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dy) + Math.abs(e.clientX - drag.x);
    state.camera.y -= dy / state.zoom;
    velocity = -dy / state.zoom;
    drag.y = e.clientY; drag.x = e.clientX;
    markDirty();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasTap = drag.moved < 8 && Date.now() - drag.t < 400;
    drag = null;
    if (wasTap) handleTap(e.clientX, e.clientY);
    else glide();
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  function glide() {
    if (Math.abs(velocity) < 0.5) return;
    let v = velocity;
    const step = () => {
      v *= 0.92;
      state.camera.y += v;
      markDirty();
      if (Math.abs(v) > 0.4 && !drag) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.camera.y += e.deltaY / state.zoom;
    markDirty();
  }, { passive: false });

  function handleTap(clientX, clientY) {
    const wx = (clientX - state.offsetX) / state.zoom;
    const wy = clientY / state.zoom + state.camera.y;
    const sprites = state.lastSprites || [];
    for (let i = sprites.length - 1; i >= 0; i--) {
      const p = sprites[i];
      if (wx >= p.x && wx <= p.x + World.SPRITE_W && wy >= p.y && wy <= p.y + World.SPRITE_H) {
        if ((p.entry.message || '').trim()) {
          state.bubbles.set(p.entry.id, Date.now() + 6000);
        }
        markDirty();
        hideHint();
        return;
      }
    }
  }

  function focusEntry(id) {
    const home = state.homes.get(id);
    if (!home) return;
    const target = home.y - (window.innerHeight / state.zoom) * 0.45;
    state.camera.y = Math.max(0, target);
    state.bubbles.set(id, Date.now() + 8000);
    markDirty();
  }

  function hideHint() {
    const h = $('#tapHint');
    if (h && !h.classList.contains('gone')) h.classList.add('gone');
  }
  setTimeout(hideHint, 7000);

  /* ---------------- 내 캐릭터 조이스틱 ---------------- */

  const joy = $('#joystick');
  const joyThumb = $('#joystickThumb');
  const JOY_R = 32;
  let joyPointerId = null;
  let lastTick = performance.now();

  function updateJoyVisibility() {
    joy.hidden = !state.myId;
    $('#findMe').hidden = !state.myId;
  }

  function setJoyVec(clientX, clientY) {
    const rect = joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_R) { dx = (dx / dist) * JOY_R; dy = (dy / dist) * JOY_R; }
    joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;
    state.joyVec = { x: dx / JOY_R, y: dy / JOY_R };
  }

  function resetJoy() {
    joyPointerId = null;
    state.joyVec = { x: 0, y: 0 };
    joyThumb.style.transform = 'translate(0,0)';
  }

  joy.addEventListener('pointerdown', (e) => {
    joyPointerId = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    setJoyVec(e.clientX, e.clientY);
    e.preventDefault();
  });
  joy.addEventListener('pointermove', (e) => {
    if (joyPointerId !== e.pointerId) return;
    setJoyVec(e.clientX, e.clientY);
  });
  joy.addEventListener('pointerup', (e) => { if (joyPointerId === e.pointerId) resetJoy(); });
  joy.addEventListener('pointercancel', () => resetJoy());

  $('#findMe').addEventListener('click', () => {
    if (state.myId) focusEntry(state.myId);
  });

  // 조이스틱을 미는 동안 내 캐릭터 좌표를 실제로 전진시킨다 (카메라 드래그와는 별개 동작).
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    if (state.myId && (state.joyVec.x || state.joyVec.y) && state.myPos) {
      state.myPos = clampMyPos({
        x: state.myPos.x + state.joyVec.x * MOVE_SPEED * dt,
        y: state.myPos.y + state.joyVec.y * MOVE_SPEED * dt,
      });
      markDirty();
    }
  }, 60);

  /* ---------------- 데이터 ---------------- */

  async function api(path, opts) {
    const o = Object.assign({ headers: {} }, opts || {});
    if (o.body && typeof o.body !== 'string') {
      o.body = JSON.stringify(o.body);
      o.headers['Content-Type'] = 'application/json';
    }
    if (state.adminKey) o.headers['X-Admin-Key'] = state.adminKey;
    const res = await fetch(path, o);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || '요청에 실패했어요 (' + res.status + ')');
    return data;
  }

  function applyState(data) {
    state.config = Object.assign(state.config, data.config || {});
    const prevIds = state.entries.map((e) => e.id).join(',');
    state.entries = data.entries || [];
    const changed = prevIds !== state.entries.map((e) => e.id).join(',');
    $('#bannerText').textContent = state.config.title || '단 한 번뿐인 결혼식';
    document.title = state.config.title || '픽셀 방명록';
    $('#counter').innerHTML = '하객 <b>' + state.entries.length + '</b>명';
    rebuildHomes();
    updateJoyVisibility();
    markDirty(changed);
    return changed;
  }

  async function refresh() {
    try {
      applyState(await api('/api/state'));
    } catch (e) { /* 네트워크가 잠깐 끊겨도 화면은 유지 */ }
  }

  setInterval(() => {
    if (document.hidden) return;
    if (document.querySelector('.modal:not([hidden])')) return;
    refresh();
  }, 8000);

  /* ---------------- 모달 ---------------- */

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  function closeModals() {
    document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModals();
    const m = e.target.classList && e.target.classList.contains('modal') ? e.target : null;
    if (m) closeModals();
  });

  const fab = $('#fab');
  const sheet = $('#sheet');
  fab.addEventListener('click', () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    fab.classList.toggle('open', open);
  });
  $('#sheetClose').addEventListener('click', () => { sheet.hidden = true; fab.classList.remove('open'); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) { sheet.hidden = true; fab.classList.remove('open'); } });

  document.querySelectorAll('.sheet-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sheet.hidden = true;
      fab.classList.remove('open');
      const which = btn.dataset.open;
      if (which === 'create') startCreate();
      else if (which === 'list') openList();
      else if (which === 'gallery') openGallery();
    });
  });

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------------- 캐릭터 만들기 ---------------- */

  function showStep(name) {
    document.querySelectorAll('#createModal .step').forEach((s) => {
      s.hidden = s.dataset.step !== name;
    });
  }

  function startCreate() {
    state.analysis = null;
    state.candidates = [];
    state.picked = -1;
    $('#photoInput').value = '';
    $('#nameInput').value = '';
    $('#msgInput').value = '';
    showStep('upload');
    openModal('createModal');
  }

  $('#photoInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    showStep('loading');
    $('#loadingMsg').textContent = '사진을 분석하고 있어요…';
    try {
      // 분석이 순식간에 끝나 화면이 튀지 않도록 최소 시간을 준다
      const [analysis] = await Promise.all([P.analyzeFile(file), wait(700)]);
      state.analysis = analysis;
      if (!analysis.detected) toast('얼굴을 찾지 못해 옷 색 위주로 만들었어요');
      buildCandidates();
      showStep('pick');
    } catch (err) {
      toast('사진을 읽지 못했어요. 다른 사진을 시도해 주세요');
      showStep('upload');
    }
  });

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  $('#skipPhoto').addEventListener('click', () => {
    state.analysis = { detected: false, skin: S.SKINS[1], hairColor: S.HAIR_COLORS[1], topColor: '#2b3038', longHair: false };
    buildCandidates();
    showStep('pick');
  });

  function buildCandidates() {
    const base = state.analysis;
    const seed = Date.now() + ':' + Math.random();
    state.candidates = [0, 1, 2, 3].map((i) => P.attrsFromAnalysis(base, seed + ':' + i));
    state.picked = -1;
    renderCandidates();
    $('#pickNext').disabled = true;
  }

  function renderCandidates() {
    const box = $('#candidates');
    box.innerHTML = '';
    state.candidates.forEach((attrs, i) => {
      const d = document.createElement('div');
      d.className = 'cand' + (state.picked === i ? ' sel' : '');
      d.appendChild(S.toCanvas(attrs, 3));
      d.addEventListener('click', () => {
        state.picked = i;
        renderCandidates();
        $('#pickNext').disabled = false;
      });
      box.appendChild(d);
    });
  }

  $('#regenerate').addEventListener('click', buildCandidates);

  $('#toCustom').addEventListener('click', () => {
    state.draft = S.normalize(state.candidates[Math.max(0, state.picked)] || state.candidates[0]);
    openCustom();
  });

  $('#pickNext').addEventListener('click', () => {
    if (state.picked < 0) return;
    state.draft = S.normalize(state.candidates[state.picked]);
    showInfo();
  });

  function openCustom() {
    buildCustomControls();
    drawPreview($('#customPreview'), state.draft, 3);
    showStep('custom');
  }

  $('#customNext').addEventListener('click', showInfo);

  function drawPreview(cv, attrs, scale) {
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, cv.width, cv.height);
    const w = S.W * scale, h = S.H * scale;
    S.drawTo(c, attrs, scale, Math.round((cv.width - w) / 2), Math.round((cv.height - h) / 2));
  }

  function buildCustomControls() {
    const box = $('#customControls');
    box.innerHTML = '';
    const update = () => {
      drawPreview($('#customPreview'), state.draft, 3);
    };

    box.appendChild(stepperCtrl('헤어스타일', S.HAIR_STYLES, HAIR_LABELS, 'hairStyle', update));
    box.appendChild(swatchCtrl('머리 색', S.HAIR_COLORS, 'hairColor', update));
    box.appendChild(swatchCtrl('피부 톤', S.SKINS, 'skin', update));
    box.appendChild(stepperCtrl('의상', S.OUTFITS, OUTFIT_LABELS, 'outfit', update));
    box.appendChild(swatchCtrl('상의 색', CLOTH_COLORS, 'topColor', update));
    box.appendChild(swatchCtrl('하의 색', CLOTH_COLORS, 'bottomColor', update));
    box.appendChild(stepperCtrl('액세서리', S.ACCESSORIES, ACC_LABELS, 'accessory', update));
  }

  function stepperCtrl(label, options, labels, key, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const head = document.createElement('div');
    head.className = 'ctrl-head';
    const title = document.createElement('span');
    title.textContent = label;
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const prev = document.createElement('button'); prev.textContent = '◀';
    const val = document.createElement('div'); val.className = 'val';
    const next = document.createElement('button'); next.textContent = '▶';
    const sync = () => { val.textContent = labels[state.draft[key]] || state.draft[key]; };
    const move = (dir) => {
      const i = options.indexOf(state.draft[key]);
      state.draft[key] = options[(i + dir + options.length) % options.length];
      sync(); onChange();
    };
    prev.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    sync();
    stepper.append(prev, val, next);
    head.append(title, stepper);
    wrap.appendChild(head);
    return wrap;
  }

  function swatchCtrl(label, colors, key, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    const head = document.createElement('div');
    head.className = 'ctrl-head';
    const title = document.createElement('span');
    title.textContent = label;
    head.appendChild(title);
    const row = document.createElement('div');
    row.className = 'swatches';
    // 사진에서 뽑힌 색이 팔레트에 없으면 맨 앞에 끼워 선택 상태가 보이게 한다
    const current = String(state.draft[key] || '').toLowerCase();
    if (current && !colors.some((c) => c.toLowerCase() === current)) colors = [current].concat(colors);
    const sync = () => {
      row.querySelectorAll('.sw').forEach((b) => {
        b.classList.toggle('sel', b.dataset.color.toLowerCase() === String(state.draft[key]).toLowerCase());
      });
    };
    colors.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'sw';
      b.dataset.color = c;
      b.style.background = c;
      b.addEventListener('click', () => {
        state.draft[key] = c;
        if (key === 'topColor') state.draft.innerColor = S.luma(c) < 0.4 ? '#f0f0ee' : S.shade(c, 0.45);
        sync(); onChange();
      });
      row.appendChild(b);
    });
    wrap.append(head, row);
    sync();
    return wrap;
  }

  function showInfo() {
    drawPreview($('#infoPreview'), state.draft, 3);
    $('#infoError').hidden = true;
    showStep('info');
    setTimeout(() => $('#nameInput').focus(), 100);
  }

  $('#submitEntry').addEventListener('click', async () => {
    const name = $('#nameInput').value.trim();
    const message = $('#msgInput').value.trim();
    const err = $('#infoError');
    if (!name) {
      err.textContent = '이름을 입력해 주세요';
      err.hidden = false;
      return;
    }
    const btn = $('#submitEntry');
    btn.disabled = true;
    btn.textContent = '등록 중…';
    try {
      const created = await api('/api/entries', { method: 'POST', body: { name, message, attrs: state.draft } });
      state.myId = created.id;
      state.myPos = null; // rebuildHomes에서 새 자리로 다시 잡는다
      localStorage.setItem('pg_my_id', created.id);
      await refresh();
      if (message) state.bubbles.set(created.id, Date.now() + 5000);
      drawPreview($('#donePreview'), state.draft, 3);
      showStep('done');
      focusEntry(created.id);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '방명록에 남기기';
    }
  });

  /* ---------------- 방명록 목록 ---------------- */

  function formatTime(ts) {
    const d = new Date(ts);
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  function entryRow(e, opts) {
    const row = document.createElement('div');
    row.className = 'entry';
    row.appendChild(S.toCanvas(e.attrs, 1.1));
    const body = document.createElement('div');
    body.className = 'entry-body';
    const n = document.createElement('div');
    n.className = 'entry-name';
    n.textContent = e.name + (e.id === state.myId ? ' (나)' : '');
    const m = document.createElement('div');
    m.className = 'entry-msg';
    m.textContent = e.message || '';
    const t = document.createElement('div');
    t.className = 'entry-time';
    t.textContent = formatTime(e.createdAt);
    body.append(n, m, t);
    row.appendChild(body);
    if (opts && opts.admin) {
      const del = document.createElement('button');
      del.className = 'entry-del';
      del.textContent = '삭제';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`'${e.name}' 방명록을 삭제할까요?`)) return;
        try {
          await api('/api/entries/' + encodeURIComponent(e.id), { method: 'DELETE' });
          await refresh();
          renderAdminEntries();
          toast('삭제했어요');
        } catch (err) { toast(err.message); }
      });
      row.appendChild(del);
    } else {
      row.addEventListener('click', () => {
        closeModals();
        focusEntry(e.id);
      });
    }
    return row;
  }

  function openList() {
    const box = $('#entries');
    box.innerHTML = '';
    const list = state.entries.slice().reverse();
    $('#listCount').textContent = list.length ? `${list.length}명이 축하를 남겼어요` : '아직 방명록이 없어요';
    list.forEach((e) => box.appendChild(entryRow(e)));
    openModal('listModal');
  }

  /* ---------------- 갤러리 ---------------- */

  function openGallery() {
    renderGallery();
    openModal('galleryModal');
  }

  function renderGallery() {
    const box = $('#gallery');
    box.innerHTML = '';
    const items = state.config.gallery || [];
    $('#galleryEmpty').hidden = items.length > 0;
    items.forEach((g) => {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = g.url;
      img.alt = '웨딩 사진';
      img.loading = 'lazy';
      fig.appendChild(img);
      if (state.adminKey) {
        const del = document.createElement('button');
        del.className = 'entry-del';
        del.textContent = '삭제';
        del.addEventListener('click', async () => {
          if (!confirm('이 사진을 삭제할까요?')) return;
          try {
            await api('/api/gallery/' + encodeURIComponent(g.id), { method: 'DELETE' });
            await refresh();
            renderGallery();
          } catch (e) { toast(e.message); }
        });
        fig.appendChild(del);
      }
      box.appendChild(fig);
    });
  }

  /* ---------------- 관리자 ---------------- */

  function openAdmin() {
    $('#adminError').hidden = true;
    const logged = !!state.adminKey;
    $('#adminLogin').hidden = logged;
    $('#adminPanel').hidden = !logged;
    if (logged) {
      $('#cfgTitle').value = state.config.title || '';
      renderAdminEntries();
    }
    openModal('adminModal');
  }

  function renderAdminEntries() {
    const box = $('#adminEntries');
    box.innerHTML = '';
    state.entries.slice().reverse().forEach((e) => box.appendChild(entryRow(e, { admin: true })));
  }

  $('#adminLoginBtn').addEventListener('click', async () => {
    const key = $('#adminKey').value;
    if (!key) return;
    state.adminKey = key;
    try {
      await api('/api/admin/check');
      sessionStorage.setItem('pg_admin', key);
      $('#adminKey').value = '';
      openAdmin();
      toast('관리자로 로그인했어요');
    } catch (e) {
      state.adminKey = null;
      $('#adminError').textContent = '비밀번호가 맞지 않아요';
      $('#adminError').hidden = false;
    }
  });

  $('#adminLogout').addEventListener('click', () => {
    state.adminKey = null;
    sessionStorage.removeItem('pg_admin');
    closeModals();
    toast('로그아웃했어요');
  });

  $('#saveConfig').addEventListener('click', async () => {
    const btn = $('#saveConfig');
    btn.disabled = true;
    try {
      await api('/api/config', { method: 'PUT', body: { title: $('#cfgTitle').value.trim() } });
      const files = Array.from($('#galleryInput').files || []);
      for (const f of files) {
        const dataUrl = await downscaleToDataUrl(f, 1280, 0.82);
        await api('/api/gallery', { method: 'POST', body: { dataUrl } });
      }
      $('#galleryInput').value = '';
      await refresh();
      renderGallery();
      toast('저장했어요');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  async function downscaleToDataUrl(file, maxSide, quality) {
    const bmp = await P.loadBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return cv.toDataURL('image/jpeg', quality);
  }

  // 배너를 길게 누르면 관리자 화면
  let pressTimer = null;
  const banner = $('#banner');
  const startPress = () => { pressTimer = setTimeout(openAdmin, 900); };
  const endPress = () => clearTimeout(pressTimer);
  banner.addEventListener('pointerdown', startPress);
  banner.addEventListener('pointerup', endPress);
  banner.addEventListener('pointerleave', endPress);

  /* ---------------- 시작 ---------------- */

  window.addEventListener('resize', resize);
  resize();
  loop();

  refresh().then(() => {
    if (new URLSearchParams(location.search).has('admin')) openAdmin();
    if (state.myId) focusEntry(state.myId);
  });
})();
