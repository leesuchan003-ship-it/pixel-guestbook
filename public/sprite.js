// 파라메트릭 픽셀 캐릭터 렌더러. 32x52 그리드에 부위별로 픽셀을 찍고 외곽선을 입힌다.
(function (global) {
  const W = 32;
  const H = 52;

  const HEAD_ROWS = [
    [6, 13, 18], [7, 12, 19], [8, 11, 20], [9, 11, 20], [10, 11, 20],
    [11, 11, 20], [12, 11, 20], [13, 11, 20], [14, 11, 20], [15, 11, 20],
    [16, 12, 19], [17, 13, 18], [18, 14, 17],
  ];

  const HAIR_STYLES = ['short', 'sideSwept', 'middlePart', 'buzz', 'curly', 'medium', 'bob', 'long', 'ponytail', 'bun', 'halfUp', 'wavyLong'];
  const OUTFITS = ['suit', 'jacket', 'shirt', 'knit', 'hoodie', 'coat', 'dress', 'blouse'];
  const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'cap', 'earring', 'bouquet'];

  const SKINS = ['#f7d7b9', '#f0c9a2', '#e3b189', '#d29a73', '#b87b54', '#8d5a3b'];
  const HAIR_COLORS = ['#191114', '#2b1d17', '#41291c', '#6b4429', '#9a6b3f', '#c9a063', '#e3c98f', '#7a3b2e', '#4a4f5c', '#b0b4bd', '#6b3f7a', '#a83b52'];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }

  function shade(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    if (amount >= 0) return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
    const k = 1 + amount;
    return rgbToHex(r * k, g * k, b * k);
  }

  function luma(hex) {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // 색이 배경과 붙어 보이지 않도록 어두운 색은 살짝 띄운 외곽선을 쓴다.
  function outlineFor(hex) {
    return luma(hex) < 0.22 ? shade(hex, 0.22) : shade(hex, -0.55);
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  class Grid {
    constructor() { this.cells = new Array(W * H).fill(null); }
    set(x, y, color) {
      if (x < 0 || y < 0 || x >= W || y >= H || !color) return;
      this.cells[y * W + x] = color;
    }
    get(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      return this.cells[y * W + x];
    }
    rect(x, y, w, h, color) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
    }
    row(y, x0, x1, color) { this.rect(x0, y, x1 - x0 + 1, 1, color); }
    // 이미 칠해진 곳에만 덧칠 (그림자, 하이라이트용)
    shadeOver(x, y, color) { if (this.get(x, y)) this.set(x, y, color); }
  }

  function drawHead(g, c) {
    const mid = shade(c.skin, -0.12);
    const dark = shade(c.skin, -0.26);
    for (const [y, x0, x1] of HEAD_ROWS) {
      g.row(y, x0, x1, c.skin);
      g.set(x1, y, mid);
      g.set(x1 - 1, y, y > 8 && y < 16 ? mid : c.skin);
    }
    // 귀
    g.rect(10, 11, 1, 3, c.skin);
    g.rect(21, 11, 1, 3, mid);
    g.set(10, 12, dark);
    g.set(21, 12, dark);
    // 목 + 그림자
    g.rect(14, 19, 4, 2, shade(c.skin, -0.18));
    g.row(19, 14, 17, dark);
  }

  function drawFace(g, c) {
    const browColor = shade(c.hairColor, -0.1);
    g.row(10, 13, 14, browColor);
    g.row(10, 17, 18, browColor);
    // 눈 (흰자 1px + 동공)
    g.rect(13, 12, 1, 2, '#3a2a24');
    g.rect(18, 12, 1, 2, '#3a2a24');
    g.set(14, 12, shade(c.skin, -0.2));
    g.set(17, 12, shade(c.skin, -0.2));
    // 코 그림자, 입
    g.set(16, 14, shade(c.skin, -0.22));
    g.row(16, 15, 16, shade(c.skin, -0.42));
    if (c.blush) {
      g.set(12, 14, shade('#e08a86', -0.05));
      g.set(19, 14, shade('#e08a86', -0.05));
    }
  }

  function drawHairBack(g, c) {
    const hc = c.hairColor;
    const dk = shade(hc, -0.25);
    const s = c.hairStyle;
    if (s === 'long' || s === 'wavyLong') {
      const bottom = s === 'wavyLong' ? 36 : 33;
      for (let y = 8; y <= bottom; y++) {
        const wave = s === 'wavyLong' ? (y > 26 ? Math.round(Math.sin(y * 0.9) ) : 0) : 0;
        g.row(y, 9 + wave, 22 + wave, y % 5 === 4 ? dk : hc);
      }
      g.row(bottom + 1, 11, 20, dk);
    } else if (s === 'bob') {
      for (let y = 8; y <= 22; y++) g.row(y, 9, 22, y % 5 === 4 ? dk : hc);
      g.row(23, 10, 21, dk);
    } else if (s === 'medium' || s === 'halfUp') {
      for (let y = 8; y <= 20; y++) g.row(y, 10, 21, y % 5 === 4 ? dk : hc);
    } else if (s === 'ponytail') {
      for (let y = 10; y <= 30; y++) g.rect(22, y, 3, 1, y % 4 === 3 ? dk : hc);
      g.rect(21, 12, 2, 3, hc);
      g.rect(22, 31, 2, 1, dk);
    } else if (s === 'bun') {
      g.rect(13, 1, 6, 4, hc);
      g.rect(13, 1, 6, 1, dk);
      g.rect(14, 5, 4, 1, dk);
    } else if (s === 'curly') {
      for (let y = 6; y <= 19; y++) g.row(y, 9, 22, y % 3 === 2 ? dk : hc);
    }
  }

  function drawHairFront(g, c) {
    const hc = c.hairColor;
    const hi = shade(hc, 0.16);
    const dk = shade(hc, -0.25);
    const s = c.hairStyle;
    const rand = mulberry(c.seed || 7);

    const cap = (bottom) => {
      g.row(4, 13, 18, hc);
      g.row(5, 12, 19, hc);
      for (let y = 6; y <= bottom; y++) g.row(y, 10, 21, hc);
      g.row(4, 15, 16, hi);
      g.set(12, 6, hi); g.set(13, 5, hi);
    };

    if (s === 'buzz') {
      g.row(5, 13, 18, hc);
      for (let y = 6; y <= 8; y++) g.row(y, 11, 20, y === 8 ? dk : hc);
      g.row(9, 11, 12, dk); g.row(9, 19, 20, dk);
    } else if (s === 'short') {
      cap(9);
      g.row(10, 10, 12, hc); g.row(10, 19, 21, hc);
      g.row(11, 10, 11, hc); g.row(11, 20, 21, hc);
      g.row(9, 11, 20, dk);
    } else if (s === 'sideSwept') {
      cap(8);
      g.row(9, 10, 17, hc);
      g.row(10, 10, 14, hc);
      g.row(11, 10, 11, hc);
      g.row(9, 18, 21, hc);
      g.row(10, 20, 21, hc);
      g.set(15, 9, hi); g.set(16, 8, hi);
    } else if (s === 'middlePart') {
      cap(8);
      g.row(9, 10, 14, hc); g.row(9, 17, 21, hc);
      g.row(10, 10, 12, hc); g.row(10, 19, 21, hc);
      g.row(11, 10, 11, hc); g.row(11, 20, 21, hc);
      g.set(15, 6, hi); g.set(16, 6, hi);
    } else if (s === 'curly') {
      cap(9);
      // 머리 윤곽을 들쭉날쭉하게 깎아 곱슬 느낌을 낸다
      for (let x = 9; x <= 22; x++) {
        const top = 2 + Math.floor(rand() * 3);
        for (let y = top; y <= 9; y++) g.set(x, y, (x + y) % 3 === 0 ? hi : hc);
        if (rand() < 0.4) g.set(x, top - 1, hc);
      }
      for (let y = 10; y <= 14; y++) {
        const w = rand() < 0.5 ? 3 : 2;
        g.row(y, 9, 8 + w, (y % 3 === 0) ? hi : hc);
        g.row(y, 23 - w, 22, (y % 3 === 1) ? dk : hc);
      }
      g.set(10, 15, hc); g.set(21, 15, dk);
    } else if (s === 'medium' || s === 'bob' || s === 'long' || s === 'wavyLong') {
      cap(9);
      g.row(10, 9, 13, hc); g.row(10, 18, 22, hc);
      g.row(11, 9, 11, hc); g.row(11, 20, 22, hc);
      for (let y = 12; y <= (s === 'medium' ? 17 : 20); y++) { g.row(y, 9, 10, hc); g.row(y, 21, 22, hc); }
      g.set(13, 5, hi); g.set(14, 4, hi);
      g.row(9, 12, 19, dk);
    } else if (s === 'ponytail' || s === 'halfUp' || s === 'bun') {
      cap(9);
      g.row(10, 10, 12, hc); g.row(10, 19, 21, hc);
      g.row(11, 10, 11, hc); g.row(11, 20, 21, hc);
      if (s === 'halfUp') { for (let y = 12; y <= 16; y++) { g.set(10, y, hc); g.set(21, y, hc); } }
      g.set(14, 4, hi); g.set(15, 4, hi);
      g.row(9, 12, 19, dk);
    }
  }

  function legsAndShoes(g, c) {
    const bottom = c.bottomColor;
    const bdark = shade(bottom, -0.2);
    const shoe = c.shoeColor;
    if (c.outfit === 'dress' || c.bottom === 'skirt') {
      // 치마: 허리에서 무릎까지 퍼지는 실루엣
      const skirtColor = c.outfit === 'dress' ? c.topColor : bottom;
      for (let y = 33; y <= 43; y++) {
        const spread = Math.floor((y - 33) / 2);
        g.row(y, 10 - spread, 21 + spread, y % 4 === 3 ? shade(skirtColor, -0.14) : skirtColor);
      }
      g.row(44, 7, 24, shade(skirtColor, -0.3));
      g.rect(12, 45, 3, 4, c.skin);
      g.rect(17, 45, 3, 4, c.skin);
      g.rect(17, 45, 3, 4, shade(c.skin, -0.1));
      g.rect(12, 49, 4, 2, shoe);
      g.rect(16, 49, 4, 2, shade(shoe, -0.12));
      return;
    }
    g.rect(11, 35, 10, 4, bottom);       // 골반
    g.rect(11, 39, 4, 10, bottom);       // 왼다리
    g.rect(17, 39, 4, 10, shade(bottom, -0.1));
    g.rect(15, 35, 2, 14, bdark);        // 가랑이 라인
    g.rect(11, 49, 5, 2, shoe);
    g.rect(16, 49, 5, 2, shade(shoe, -0.12));
    g.row(48, 11, 14, shade(bottom, -0.18));
    g.row(48, 17, 20, shade(bottom, -0.18));
  }

  function torso(g, c) {
    const top = c.topColor;
    const tdark = shade(top, -0.18);
    const inner = c.innerColor;
    const o = c.outfit;

    g.row(21, 11, 20, top);
    for (let y = 22; y <= 34; y++) g.row(y, 10, 21, top);
    g.rect(20, 22, 2, 13, tdark);

    if (o === 'suit' || o === 'jacket' || o === 'coat') {
      g.rect(14, 21, 4, 2, inner);                 // 셔츠 깃
      for (let y = 23; y <= 33; y++) g.rect(15, y, 2, 1, inner);
      // 라펠
      for (let i = 0; i < 5; i++) {
        g.set(14 - i + 4, 22 + i, tdark);
        g.set(17 + i - 4, 22 + i, tdark);
      }
      g.rect(13, 22, 2, 2, tdark);
      g.rect(17, 22, 2, 2, tdark);
      if (o === 'suit') {
        g.rect(15, 23, 2, 8, c.accentColor);       // 넥타이
        g.rect(15, 31, 2, 1, shade(c.accentColor, -0.3));
      }
      if (o === 'coat') {
        for (let y = 35; y <= 42; y++) g.row(y, 10, 21, y % 4 === 3 ? tdark : top);
        g.row(43, 10, 21, shade(top, -0.35));
        g.rect(15, 35, 2, 8, tdark);
      }
      g.set(13, 27, shade(top, 0.25));             // 단추
    } else if (o === 'knit') {
      for (let y = 23; y <= 34; y += 3) g.row(y, 10, 21, tdark);
      g.row(21, 13, 18, shade(top, 0.15));
      g.row(22, 13, 18, shade(top, 0.15));
    } else if (o === 'hoodie') {
      g.rect(12, 20, 8, 3, shade(top, -0.25));     // 후드
      g.row(21, 13, 18, shade(top, -0.25));
      g.rect(14, 23, 1, 4, shade(top, 0.3));       // 끈
      g.rect(17, 23, 1, 4, shade(top, 0.3));
      g.rect(12, 29, 8, 4, tdark);                 // 주머니
    } else if (o === 'blouse' || o === 'shirt') {
      g.rect(14, 21, 4, 2, shade(top, 0.2));
      g.rect(13, 22, 2, 2, tdark);
      g.rect(17, 22, 2, 2, tdark);
      if (o === 'blouse') for (let y = 24; y <= 32; y += 3) g.set(16, y, tdark);
    } else if (o === 'dress') {
      g.rect(14, 21, 4, 1, shade(top, 0.2));
      for (let y = 24; y <= 32; y += 4) g.row(y, 10, 21, tdark);
    }
  }

  function arms(g, c) {
    const top = c.topColor;
    const sleeve = c.outfit === 'dress' || c.outfit === 'blouse' ? shade(top, 0.05) : top;
    const sdark = shade(sleeve, -0.2);
    const short = c.outfit === 'shirt' || c.outfit === 'blouse';
    const sleeveEnd = short ? 28 : 34;
    for (let y = 22; y <= sleeveEnd; y++) {
      g.row(y, 8, 9, sleeve);
      g.row(y, 22, 23, sdark);
    }
    const handTop = sleeveEnd + 1;
    for (let y = handTop; y <= 36; y++) {
      g.row(y, 8, 9, c.skin);
      g.row(y, 22, 23, shade(c.skin, -0.12));
    }
    g.rect(8, 37, 2, 2, c.skin);
    g.rect(22, 37, 2, 2, shade(c.skin, -0.12));
  }

  function accessories(g, c) {
    const a = c.accessory;
    if (a === 'glasses') {
      // 렌즈 안은 비워두고 테두리만: 채우면 눈이 가려져 인형처럼 보인다
      const frame = '#40444f';
      g.row(11, 12, 15, frame); g.row(11, 17, 20, frame);
      g.row(14, 12, 15, frame); g.row(14, 17, 20, frame);
      for (let y = 12; y <= 13; y++) { g.set(12, y, frame); g.set(15, y, frame); g.set(17, y, frame); g.set(20, y, frame); }
      g.set(16, 12, frame);
      g.set(11, 12, frame); g.set(21, 12, frame);
      g.set(14, 12, shade(c.skin, 0.28));
      g.set(19, 12, shade(c.skin, 0.28));
    } else if (a === 'sunglasses') {
      const lens = c.accentColor || '#2f6b4f';
      g.rect(12, 11, 4, 4, lens);
      g.rect(17, 11, 4, 4, shade(lens, -0.15));
      g.rect(12, 11, 2, 1, shade(lens, 0.45));
      g.rect(17, 11, 2, 1, shade(lens, 0.3));
      g.row(10, 11, 21, '#22252c');
      g.set(16, 12, '#22252c');
      g.set(11, 11, '#22252c'); g.set(21, 11, '#22252c');
    } else if (a === 'cap') {
      const capC = c.accentColor || '#2b3550';
      g.rect(10, 4, 12, 4, capC);
      g.row(3, 13, 18, capC);
      g.rect(9, 8, 14, 2, shade(capC, -0.2));  // 챙
      g.row(4, 15, 17, shade(capC, 0.2));
    } else if (a === 'earring') {
      g.set(10, 14, '#e8c96a');
      g.set(21, 14, '#e8c96a');
    } else if (a === 'bouquet') {
      g.rect(6, 33, 5, 5, '#5a8f4a');
      g.set(7, 33, '#e9748a'); g.set(9, 34, '#f2b8c6');
      g.set(6, 35, '#f5e08a'); g.set(9, 37, '#e9748a');
      g.set(8, 36, '#f2b8c6'); g.set(7, 37, '#ffffff');
      g.rect(8, 38, 1, 3, '#4a7a3c');
    }
  }

  function addOutline(g) {
    const out = new Grid();
    out.cells = g.cells.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g.get(x, y)) continue;
        const n = g.get(x, y - 1) || g.get(x, y + 1) || g.get(x - 1, y) || g.get(x + 1, y);
        if (n) out.set(x, y, outlineFor(n));
      }
    }
    return out;
  }

  function buildGrid(attrs) {
    const c = normalize(attrs);
    const g = new Grid();
    drawHairBack(g, c);
    legsAndShoes(g, c);
    torso(g, c);
    arms(g, c);
    drawHead(g, c);
    drawFace(g, c);
    drawHairFront(g, c);
    accessories(g, c);
    return addOutline(g);
  }

  function normalize(a) {
    const c = Object.assign({
      skin: SKINS[1],
      hairColor: HAIR_COLORS[1],
      hairStyle: 'short',
      outfit: 'jacket',
      topColor: '#2b3038',
      innerColor: '#f2f2f2',
      bottomColor: '#2f3440',
      shoeColor: '#1d1f24',
      accentColor: '#8a4a52',
      accessory: 'none',
      blush: false,
      seed: 1,
    }, a || {});
    if (!HAIR_STYLES.includes(c.hairStyle)) c.hairStyle = 'short';
    if (!OUTFITS.includes(c.outfit)) c.outfit = 'jacket';
    if (!ACCESSORIES.includes(c.accessory)) c.accessory = 'none';
    return c;
  }

  // 그리드를 캔버스 컨텍스트에 배율만큼 확대해 찍는다. crop 지정 시 해당 영역만.
  function drawTo(ctx, attrs, scale, originX, originY, crop) {
    const g = attrs && attrs.__grid ? attrs.__grid : buildGrid(attrs);
    const y0 = crop ? crop.y : 0;
    const y1 = crop ? crop.y + crop.h : H;
    const x0 = crop ? crop.x : 0;
    const x1 = crop ? crop.x + crop.w : W;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const col = g.get(x, y);
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(originX + (x - x0) * scale, originY + (y - y0) * scale, scale, scale);
      }
    }
  }

  function toCanvas(attrs, scale, crop) {
    const w = (crop ? crop.w : W) * scale;
    const h = (crop ? crop.h : H) * scale;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawTo(ctx, attrs, scale, 0, 0, crop);
    return cv;
  }

  function toDataURL(attrs, scale, crop) {
    return toCanvas(attrs, scale, crop).toDataURL('image/png');
  }

  function randomAttrs(seedStr) {
    const rand = mulberry(hashString(String(seedStr || Math.random())));
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    return normalize({
      skin: pick(SKINS),
      hairColor: pick(HAIR_COLORS),
      hairStyle: pick(HAIR_STYLES),
      outfit: pick(OUTFITS),
      topColor: pick(['#2b3038', '#1b1d22', '#4a5568', '#7a8496', '#c8ccd4', '#8a3b46', '#3b5a4a', '#e8e4dc']),
      bottomColor: pick(['#2f3440', '#1b1d22', '#465063', '#8a8f9c', '#d8d4cc']),
      accessory: pick(ACCESSORIES),
      seed: Math.floor(rand() * 10000),
    });
  }

  global.PixelSprite = {
    W, H, HAIR_STYLES, OUTFITS, ACCESSORIES, SKINS, HAIR_COLORS,
    buildGrid, normalize, drawTo, toCanvas, toDataURL, randomAttrs,
    shade, hashString, mulberry, luma,
  };
})(window);
