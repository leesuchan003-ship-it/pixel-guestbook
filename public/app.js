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

  const state = {
    entries: [],
    config: { title: '단 한 번뿐인 결혼식', gallery: [] },
    cache: {},
    camera: { y: 0 },
    zoom: 1,
    offsetX: 0,
    bubbles: new Map(),   // entryId -> 만료 timestamp (0 = 항상 표시)
    myId: localStorage.getItem('pg_my_id') || null,
    adminKey: sessionStorage.getItem('pg_admin') || null,
    draft: null,
    candidates: [],
    picked: -1,
    analysis: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#world');
  const ctx = canvas.getContext('2d');

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

  function draw() {
    const { cssW, cssH, zoom, offsetX } = viewMetrics();
    const viewH = cssH / zoom;
    if (sceneDirty) {
      World.renderScene(state.cache, state.entries, state.config.couple, viewH);
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
    drawLabels(zoom, offsetX, cssH);
  }

  function worldToScreen(x, y, zoom, offsetX) {
    return { sx: offsetX + x * zoom, sy: (y - state.camera.y) * zoom };
  }

  function drawLabels(zoom, offsetX, cssH) {
    const placed = state.cache.placed || [];
    const nameSize = Math.max(10, Math.round(8.5 * zoom));
    const now = Date.now();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${nameSize}px "Galmuri11", "Apple SD Gothic Neo", system-ui, sans-serif`;
    ctx.lineWidth = Math.max(3, nameSize * 0.36);
    ctx.lineJoin = 'round';

    const drawn = [];
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const p of placed) {
      const base = worldToScreen(p.x + World.SPRITE_W / 2, p.y + World.SPRITE_H + 8, zoom, offsetX);
      if (base.sy < -40 || base.sy > cssH + 60) continue;
      const name = p.entry.name || '';
      const w = ctx.measureText(name).width + 4;
      // 이름표가 겹치면 조금씩 아래로 밀어 읽을 수 있게 한다
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

    for (const p of placed) {
      const until = state.bubbles.get(p.entry.id);
      if (until === undefined) continue;
      if (until !== 0 && until < now) { state.bubbles.delete(p.entry.id); continue; }
      const msg = (p.entry.message || '').trim();
      if (!msg) continue;
      drawBubble(p, msg, zoom, offsetX, cssH);
    }
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

  function drawBubble(p, msg, zoom, offsetX, cssH) {
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
    const by = anchor.sy - h - 6;

    ctx.fillStyle = 'rgba(10,12,14,0.92)';
    ctx.strokeStyle = '#f2f0ea';
    ctx.lineWidth = 2;
    roundRect(bx, by, w, h, 8);
    ctx.fill();
    ctx.stroke();
    // 꼬리
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

  /* ---------------- 카메라 조작 ---------------- */

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
    const placed = state.cache.placed || [];
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i];
      if (wx >= p.x && wx <= p.x + World.SPRITE_W && wy >= p.y && wy <= p.y + World.SPRITE_H) {
        if ((p.entry.message || '').trim()) {
          state.bubbles.set(p.entry.id, Date.now() + 6000);
          setTimeout(markDirty, 6100);
        }
        markDirty();
        hideHint();
        return;
      }
    }
  }

  function focusEntry(id) {
    const placed = state.cache.placed || [];
    const p = placed.find((q) => q.entry.id === id);
    if (!p) return;
    const target = p.y - (window.innerHeight / state.zoom) * 0.45;
    state.camera.y = Math.max(0, target);
    state.bubbles.set(id, Date.now() + 8000);
    setTimeout(markDirty, 8100);
    markDirty();
  }

  function hideHint() {
    const h = $('#tapHint');
    if (h && !h.classList.contains('gone')) h.classList.add('gone');
  }
  setTimeout(hideHint, 7000);

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
    // 최근 하객 둘은 말풍선을 계속 띄워두고, 눌러서 띄운 말풍선은 남겨둔다
    const now = Date.now();
    for (const [id, until] of state.bubbles) {
      if (until === 0 || until < now) state.bubbles.delete(id);
    }
    state.entries.slice(-2).forEach((e) => state.bubbles.set(e.id, 0));
    if (state.myId) state.bubbles.set(state.myId, 0);
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
      localStorage.setItem('pg_my_id', created.id);
      await refresh();
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
