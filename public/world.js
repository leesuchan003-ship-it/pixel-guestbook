// 픽셀 웨딩 월드: 잔디/버진로드/아치를 1배율 오프스크린에 그린 뒤
// 화면 캔버스에 확대해 올리고, 이름표와 말풍선만 화면 좌표로 덧그린다.
(function (global) {
  const WORLD_W = 240;
  const AISLE_X = 96;
  const AISLE_W = 48;
  const CX = AISLE_X + AISLE_W / 2;

  const HEAD_ROOM = 128;   // 아치와 신랑신부가 있는 상단 영역
  const FOOT_ROOM = 96;
  const ROW_H = 26;
  const SPRITE_W = 32;
  const SPRITE_H = 52;
  const PER_ROW = 8;

  const ARCH_TOP = 44;
  const ALTAR_Y = 94;      // 신랑신부가 서는 바닥 높이
  const PATH_TOP = 56;

  const LEFT_SLOTS = [0, 22, 44, 66];
  const RIGHT_SLOTS = [138, 160, 182, 204];

  const GRASS = ['#6f9c54', '#7aa75d', '#67934e', '#74a158'];
  const PATH = ['#e6d9bb', '#ded0ae', '#eaddc3'];

  const DEFAULT_COUPLE = {
    left: {
      hairStyle: 'short', outfit: 'suit', skin: '#f0c9a2', hairColor: '#191114',
      topColor: '#22252c', innerColor: '#f6f4ef', bottomColor: '#22252c',
      shoeColor: '#15171b', accentColor: '#8a4a52', accessory: 'none',
    },
    right: {
      hairStyle: 'long', outfit: 'dress', skin: '#f7d7b9', hairColor: '#2b1d17',
      topColor: '#f4f1ea', innerColor: '#ffffff', bottomColor: '#f4f1ea',
      shoeColor: '#e8e4dc', accentColor: '#f2a8bc', accessory: 'bouquet', blush: true,
    },
  };

  function rowsNeeded(n) { return Math.max(3, Math.ceil(n / PER_ROW) + 1); }

  function worldHeight(n, minHeight) {
    return Math.max(HEAD_ROOM + rowsNeeded(n) * ROW_H + FOOT_ROOM, minHeight || 0);
  }

  // 입장 순서로 자리를 정한다. 같은 사람은 항상 같은 자리에 선다.
  function slotFor(index, seedRand, rowGap) {
    const row = Math.floor(index / PER_ROW);
    const col = index % PER_ROW;
    const slots = col < 4 ? LEFT_SLOTS : RIGHT_SLOTS;
    return {
      x: slots[col % 4] + Math.round((seedRand() - 0.5) * 6),
      y: Math.round(HEAD_ROOM + row * rowGap + (seedRand() - 0.5) * 8),
      row,
    };
  }

  // 하객이 적을 때 화면이 휑해 보이지 않도록 줄 간격을 조금 늘린다
  function rowGapFor(count, height) {
    const rows = Math.max(1, Math.ceil(count / PER_ROW));
    const room = (height || 0) - HEAD_ROOM - FOOT_ROOM;
    return Math.max(ROW_H, Math.min(34, room / rows));
  }

  function layout(entries, height) {
    const S = global.PixelSprite;
    const gap = rowGapFor(entries.length, height);
    return entries.map((e, i) => {
      const rand = S.mulberry(S.hashString((e.id || '') + ':pos'));
      const pos = slotFor(i, rand, gap);
      return { entry: e, x: pos.x, y: pos.y, index: i };
    }).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  function drawGrass(ctx, h, rand) {
    ctx.fillStyle = GRASS[0];
    ctx.fillRect(0, 0, WORLD_W, h);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < WORLD_W; x += 2) {
        const r = rand();
        if (r < 0.22) { ctx.fillStyle = GRASS[1]; ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.34) { ctx.fillStyle = GRASS[2]; ctx.fillRect(x, y, 1, 2); }
        else if (r < 0.38) { ctx.fillStyle = GRASS[3]; ctx.fillRect(x, y + 1, 2, 1); }
      }
    }
  }

  function drawPath(ctx, h, rand) {
    ctx.fillStyle = PATH[0];
    ctx.fillRect(AISLE_X, PATH_TOP, AISLE_W, h - PATH_TOP);
    for (let y = PATH_TOP; y < h; y += 2) {
      for (let x = AISLE_X; x < AISLE_X + AISLE_W; x += 2) {
        const r = rand();
        if (r < 0.18) { ctx.fillStyle = PATH[1]; ctx.fillRect(x, y, 2, 1); }
        else if (r < 0.28) { ctx.fillStyle = PATH[2]; ctx.fillRect(x, y + 1, 1, 1); }
      }
    }
    ctx.fillStyle = '#c9b892';
    ctx.fillRect(AISLE_X - 1, PATH_TOP, 1, h - PATH_TOP);
    ctx.fillRect(AISLE_X + AISLE_W, PATH_TOP, 1, h - PATH_TOP);
    ctx.fillStyle = '#d8c6a0';
    for (let y = PATH_TOP + 10; y < h; y += 16) {
      ctx.fillRect(AISLE_X + 3, y, 2, 2);
      ctx.fillRect(AISLE_X + AISLE_W - 5, y, 2, 2);
    }
  }

  function flower(ctx, x, y, petal) {
    ctx.fillStyle = petal;
    ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
    ctx.fillRect(x, y + 2, 1, 1); ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillStyle = '#f2d66a';
    ctx.fillRect(x + 1, y + 1, 1, 1);
  }

  function bush(ctx, x, y, w, h) {
    ctx.fillStyle = '#3f6b39';
    ctx.fillRect(x, y + 1, w, h - 1);
    ctx.fillRect(x + 1, y, w - 2, 1);
    ctx.fillStyle = '#4e7f44';
    ctx.fillRect(x + 1, y + 1, w - 3, 2);
    ctx.fillStyle = '#5e9150';
    ctx.fillRect(x + 2, y + 1, 2, 1);
    ctx.fillRect(x + w - 4, y + 3, 2, 1);
  }

  function drawDecor(ctx, h, rand) {
    const petals = ['#f0f0ee', '#f2a8bc', '#efd28a', '#d9b6e8'];
    for (let y = PATH_TOP + 4; y < h - 8; y += 5) {
      for (const band of [[1, 90], [148, 236]]) {
        if (rand() < 0.5) {
          const x = band[0] + Math.floor(rand() * (band[1] - band[0]));
          flower(ctx, x, y, petals[Math.floor(rand() * petals.length)]);
        }
      }
    }
    for (let y = 60; y < h - 20; y += 38) {
      if (rand() < 0.75) bush(ctx, 1 + Math.floor(rand() * 6), y, 13, 9);
      if (rand() < 0.75) bush(ctx, 224 + Math.floor(rand() * 5), y + 14, 13, 9);
    }
    // 버진로드 양옆 화단
    for (let y = PATH_TOP + 2; y < h; y += 7) {
      flower(ctx, AISLE_X - 5, y, petals[Math.floor(rand() * petals.length)]);
      flower(ctx, AISLE_X + AISLE_W + 2, y + 3, petals[Math.floor(rand() * petals.length)]);
    }
  }

  function drawArch(ctx) {
    const span = 68;
    const x0 = CX - span / 2;
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(x0, ARCH_TOP, 4, ALTAR_Y - ARCH_TOP);
    ctx.fillRect(x0 + span - 4, ARCH_TOP, 4, ALTAR_Y - ARCH_TOP);
    ctx.fillStyle = '#d9d3c6';
    ctx.fillRect(x0 + 3, ARCH_TOP, 1, ALTAR_Y - ARCH_TOP);
    ctx.fillRect(x0 + span - 1, ARCH_TOP, 1, ALTAR_Y - ARCH_TOP);
    for (let i = 0; i <= span; i++) {
      const y = ARCH_TOP - Math.round(Math.sin((i / span) * Math.PI) * 15);
      ctx.fillStyle = '#f4f1ea';
      ctx.fillRect(x0 + i, y, 1, 5);
    }
    const petals = ['#f2a8bc', '#f0f0ee', '#efd28a', '#e8849c'];
    let s = 1337;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i <= span; i += 3) {
      const y = ARCH_TOP - Math.round(Math.sin((i / span) * Math.PI) * 15) - 2;
      ctx.fillStyle = petals[Math.floor(rnd() * petals.length)];
      ctx.fillRect(x0 + i, y, 2, 2);
      if (rnd() < 0.4) { ctx.fillStyle = '#4e7f44'; ctx.fillRect(x0 + i + 1, y + 2, 1, 1); }
    }
    ctx.fillStyle = '#4e7f44';
    ctx.fillRect(x0 - 1, 74, 6, 3);
    ctx.fillRect(x0 + span - 5, 78, 6, 3);
    // 단상
    ctx.fillStyle = '#e0d2b4';
    ctx.fillRect(CX - 30, ALTAR_Y, 60, 6);
    ctx.fillStyle = '#cbbb98';
    ctx.fillRect(CX - 30, ALTAR_Y + 5, 60, 1);
  }

  function renderScene(cache, entries, couple, minHeight) {
    const S = global.PixelSprite;
    const h = Math.round(worldHeight(entries.length, minHeight));
    let cv = cache.canvas;
    if (!cv) { cv = cache.canvas = document.createElement('canvas'); }
    cv.width = WORLD_W; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const rand = S.mulberry(9271);
    drawGrass(ctx, h, rand);
    drawPath(ctx, h, rand);
    drawDecor(ctx, h, rand);
    drawArch(ctx);

    const pair = couple || DEFAULT_COUPLE;
    if (pair.left) S.drawTo(ctx, pair.left, 1, 90, ALTAR_Y - SPRITE_H);
    if (pair.right) S.drawTo(ctx, pair.right, 1, 118, ALTAR_Y - SPRITE_H);

    const placed = layout(entries, h);
    for (const p of placed) S.drawTo(ctx, p.entry.attrs, 1, p.x, p.y);
    cache.placed = placed;
    cache.height = h;
    return cache;
  }

  global.PixelWorld = {
    WORLD_W, SPRITE_W, SPRITE_H, HEAD_ROOM, ROW_H, DEFAULT_COUPLE,
    worldHeight, layout, renderScene,
  };
})(window);
