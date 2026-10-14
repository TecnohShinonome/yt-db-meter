// YouTube dB Meter Overlay — Peak / VU / LUFS (BS.1770 K-weighting, YouTube -14 LUFS reference)
(() => {
  'use strict';
  if (window.__ytdbm) return;
  window.__ytdbm = true;

  const TARGET = -14;            // YouTube 基準ラウドネス
  const VU_REF = -18;            // 0 VU = -18 dBFS (sine RMS)
  const ABS_GATE_E = Math.pow(10, (-70 + 0.691) / 10);
  const S = { pre: true, num: false, visible: true, posX: 0.02, posY: 0.04 };
  let ctx = null, cur = null, pending = null;
  const graphs = new WeakMap();
  let host, root, canvas, c2d, elStatus, elNums, btnPre, btnPost, btnNum;

  const st = {};
  const L = { sub: [], gate: [], gatePre: [], lastT: 0 };
  function resetMeters() {
    Object.assign(st, {
      peak: [-90, -90], hold: [-90, -90], holdT: [0, 0], clipT: [0, 0], max: [-Infinity, -Infinity],
      vu1: [0, 0], vu2: [0, 0], lastT: ctx ? ctx.currentTime : 0, lastFrame: 0,
    });
  }
  let lastLo = { m: -Infinity, s: -Infinity, i: -Infinity };
  function resetLoudness() {
    L.sub = []; L.gate = []; L.gatePre = []; L.lastT = ctx ? ctx.currentTime : 0;
    lastLo = { m: -Infinity, s: -Infinity, i: -Infinity };
  }
  resetMeters(); resetLoudness();

  const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const lk = e => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);
  const fmt = x => (!Number.isFinite(x) ? '-inf' : (x > 0 ? '+' : '') + x.toFixed(1));
  // 実効音量（hook 済みなら YouTube が設定した仮想値）
  function vol() {
    if (!cur) return 0;
    if (cur.hooked) return cur.vMute ? 0 : cur.vVol;
    return cur.video.muted ? 0 : cur.video.volume;
  }
  // 計測信号 → 表示値の補正 dB（hooked: PRE時は0 / POST時は音量分下げる）
  function offset() {
    const v = vol();
    if (cur && cur.hooked) {
      return S.pre ? 0 : (v > 0 ? 20 * Math.log10(v) : -Infinity);
    }
    return S.pre ? (v > 0 ? -20 * Math.log10(v) : 0) : 0;
  }
  const isAd = () => !!(cur && cur.video.closest('.ad-showing, .ad-interrupting'));

  // ---------- Audio graph ----------
  function build(ac, video) {
    const src = ac.createMediaElementSource(video);
    const out = new GainNode(ac, { gain: video.muted ? 0 : video.volume });  // 音量は自前で掛ける
    src.connect(out); out.connect(ac.destination);
    const up = new GainNode(ac, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    src.connect(up);
    const fft = ac.sampleRate > 50000 ? 32768 : 16384;
    const mk = node => {
      const sp = ac.createChannelSplitter(2); node.connect(sp);
      return [0, 1].map(i => { const a = new AnalyserNode(ac, { fftSize: fft, smoothingTimeConstant: 0 }); sp.connect(a, i); return a; });
    };
    // BS.1770 K-weighting: high shelf (+4dB @1.68kHz) → high pass (38Hz)
    const shelf = new BiquadFilterNode(ac, { type: 'highshelf', frequency: 1681.97, gain: 3.99984 });
    const hp = new BiquadFilterNode(ac, { type: 'highpass', frequency: 38.1355, Q: 0.5003 });
    up.connect(shelf); shelf.connect(hp);
    return { out, raw: mk(up), kw: mk(hp), fft, buf: new Float32Array(fft) };
  }

  async function attach(video) {
    if (cur && cur.video === video) return;
    if (!ctx) ctx = new AudioContext();
    if (ctx.state !== 'running' && navigator.userActivation?.hasBeenActive) {
      await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 300))]);
    }
    // 未起動のまま接続すると無音になるため、ユーザー操作を待つ
    if (ctx.state !== 'running') { waitGesture(video); return; }
    let g = graphs.get(video);
    if (!g) {
      try { g = build(ctx, video); } catch (e) { console.warn('[yt-db-meter]', e); setStatus('接続失敗'); return; }
      graphs.set(video, g);
      video.addEventListener('loadstart', () => { resetMeters(); resetLoudness(); });
      video.addEventListener('seeked', () => { if (video.currentTime < 0.5) { resetMeters(); resetLoudness(); } });
    }
    cur = { video, g, hooked: false, vVol: 1, vMute: false };
    hook(cur);
    pending = null;
    resetMeters(); resetLoudness();
    setStatus('');
  }

  // MAIN world の volhook.js に volume/muted の仮想化を依頼
  function hook(c) {
    const { video, g } = c;
    const apply = () => {
      const a = video.getAttribute('data-ytdbm-vol'); if (!a) return;
      const [v, m] = a.split(',');
      c.hooked = true; c.vVol = +v; c.vMute = m === '1';
      g.out.gain.setTargetAtTime(c.vMute ? 0 : c.vVol, ctx.currentTime, 0.005);
    };
    if (!g.mo) { g.mo = new MutationObserver(apply); g.mo.observe(video, { attributes: true, attributeFilter: ['data-ytdbm-vol'] }); }
    apply();
    if (c.hooked) return;
    video.dispatchEvent(new CustomEvent('ytdbm-hook', { bubbles: true }));
    setTimeout(() => {                      // hook 失敗時は従来方式（POST信号＋計算補正）に戻す
      if (!c.hooked) { g.out.gain.value = 1; setStatus('PRE=計算補正'); }
    }, 800);
  }

  function waitGesture(video) {
    if (pending === video) return;
    pending = video;
    setStatus('▶ ページをクリックで計測開始');
    const go = async () => {
      ['pointerdown', 'keydown'].forEach(t => window.removeEventListener(t, go, true));
      try { await ctx.resume(); } catch {}
      pending = null;
      attach(video);
    };
    ['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, go, true));
  }

  // ---------- UI ----------
  const W = 124, H = 232, TOP = 25, BOT = H - 6;
  function makeUI() {
    host = document.createElement('div');
    host.id = 'ytdbm-host';
    Object.assign(host.style, { position: 'absolute', zIndex: 2000, left: S.posX * 100 + '%', top: S.posY * 100 + '%' });
    ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'contextmenu', 'wheel']
      .forEach(t => host.addEventListener(t, e => e.stopPropagation()));
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
.p{font:11px/1.3 ui-monospace,Menlo,Consolas,monospace;color:#e8e8e8;
   background:linear-gradient(180deg, rgba(14,18,25,.68) 0%, rgba(8,10,16,.76) 100%);
   border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.10);
   border-radius:8px;padding:4px 6px 6px;user-select:none;backdrop-filter:blur(10px) saturate(130%);-webkit-backdrop-filter:blur(10px) saturate(130%);
   transition:background .2s ease, border-color .2s ease}
.p:hover{background:linear-gradient(180deg, rgba(14,18,25,.82) 0%, rgba(8,10,16,.88) 100%);border-color:rgba(255,255,255,.20)}
.hd{display:flex;gap:3px;align-items:center;cursor:move;margin-bottom:3px;padding:1px 0 3px;border-bottom:1px solid rgba(255,255,255,.08)}
.seg{display:inline-flex}
.seg button:first-child{border-radius:3px 0 0 3px}
.seg button:last-child{border-radius:0 3px 3px 0;border-left:0}
button{font:8.5px ui-monospace,Menlo,Consolas,monospace;font-weight:700;letter-spacing:0.3px;color:#8f96a3;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:3px;padding:1px 4px;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:all .12s ease}
button:hover{background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.28)}
button.on{color:#fff;background:#2563eb;border-color:#3b82f6;box-shadow:0 0 6px rgba(37,99,235,.45)}
.btn-num.on{color:#00e5a3;background:rgba(0,229,163,.16);border-color:rgba(0,229,163,.45);box-shadow:0 0 6px rgba(0,229,163,.3)}
.acts{display:flex;gap:3px;align-items:center;margin-left:auto}
.st{color:#ffcf5a;font-size:10px;margin-bottom:2px}.st:empty{display:none}
.n{font:8.5px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#cbd2e1;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.08);border-radius:4px;padding:3px 5px;margin-top:4px;white-space:pre-wrap}
.n:empty{display:none}
.n b{color:#fff;font-weight:700}
.n .hi{color:#ff4a5a}
.n .lo{color:#4aa3ff}
.n .ok{color:#00e5a3}
canvas{display:block;width:${W}px;height:${H}px}
</style>
<div class="p">
  <div class="hd">
    <span class="seg">
      <button class="pre" title="音量フェーダー前（原音）信号を計測">PRE</button>
      <button class="post" title="YouTube音量/ノーマライズ適用後の信号を計測">POST</button>
    </span>
    <button class="btn-num" title="数値表示のオン/オフ">NUM</button>
    <div class="acts">
      <button class="rst" title="最大値・Integratedをリセット">RST</button>
      <button class="x" title="隠す（ツールバーアイコン / Alt+Shift+M で再表示）">×</button>
    </div>
  </div>
  <div class="st"></div>
  <canvas></canvas>
  <div class="n"></div>
</div>`;
    canvas = root.querySelector('canvas');
    c2d = canvas.getContext('2d');
    ensureDpr();
    elStatus = root.querySelector('.st');
    elNums = root.querySelector('.n');
    btnPre = root.querySelector('.pre');
    btnPost = root.querySelector('.post');
    btnNum = root.querySelector('.btn-num');

    btnPre.onclick = () => { S.pre = true; updMode(); lastLo.i = integ(L.gatePre); save(); };
    btnPost.onclick = () => { S.pre = false; updMode(); lastLo.i = integ(L.gate); save(); };
    btnNum.onclick = () => { S.num = !S.num; applyNum(); save(); };
    root.querySelector('.rst').onclick = () => { resetMeters(); resetLoudness(); };
    root.querySelector('.x').onclick = () => { S.visible = false; applyVis(); save(); };

    // drag
    const hd = root.querySelector('.hd');
    hd.addEventListener('pointerdown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const par = host.parentElement; if (!par) return;
      hd.setPointerCapture(e.pointerId);
      const pr = par.getBoundingClientRect(), hr = host.getBoundingClientRect();
      const dx = e.clientX - hr.left, dy = e.clientY - hr.top;
      const mv = ev => {
        const x = Math.min(Math.max(ev.clientX - dx - pr.left, 0), pr.width - hr.width);
        const y = Math.min(Math.max(ev.clientY - dy - pr.top, 0), pr.height - hr.height);
        S.posX = x / pr.width; S.posY = y / pr.height;
        host.style.left = S.posX * 100 + '%'; host.style.top = S.posY * 100 + '%';
      };
      const upf = () => {
        hd.removeEventListener('pointermove', mv);
        hd.removeEventListener('pointerup', upf);
        hd.removeEventListener('pointercancel', upf);
        save();
      };
      hd.addEventListener('pointermove', mv);
      hd.addEventListener('pointerup', upf);
      hd.addEventListener('pointercancel', upf);
    });
    applyVis();
    applyNum();
    updMode();
  }
  function setStatus(s) { if (elStatus) elStatus.textContent = s; }
  function applyVis() { if (host) host.style.display = S.visible ? '' : 'none'; }
  function applyNum() {
    if (!root) return;
    if (elNums) elNums.style.display = S.num ? '' : 'none';
    if (btnNum) btnNum.classList.toggle('on', !!S.num);
  }
  function updMode() {
    if (!root) return;
    if (btnPre && btnPost) {
      btnPre.classList.toggle('on', S.pre);
      btnPost.classList.toggle('on', !S.pre);
    }
  }
  function save() { try { chrome.storage.local.set({ ...S }); } catch {} }
  function mount(video) {
    const player = video.closest('#movie_player, .html5-video-player, ytmusic-player, #player') || video.parentElement;
    if (!player) return;
    if (!host) makeUI();
    if (host.parentElement !== player) {
      if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
      player.appendChild(host);
    }
    // 小さいプレーヤー（Studio のプレビュー等）では縮小して収める
    const ph = player.clientHeight, hh = host.offsetHeight;
    const sc = ph && hh ? Math.min(1, Math.max(0.5, (ph - 8) / hh)) : 1;
    host.style.transformOrigin = '0 0'; host.style.transform = sc < 1 ? `scale(${sc})` : '';
  }
  // 表示中で一番大きい video を対象にする（youtube.com / Studio 共通）
  function findVideo() {
    const main = document.querySelector('video.html5-main-video');
    if (main && main.offsetWidth) return main;
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const a = v.offsetWidth * v.offsetHeight;
      if (a > area) { area = a; best = v; }
    }
    return best || main;
  }

  // ---------- drawing helpers (vertical) ----------
  const yf = (min, max) => d => BOT - (Math.min(max, Math.max(min, d)) - min) / (max - min) * (BOT - TOP);

  function drawLedBar(x, w, yTop, colorFill) {
    // 1. Recessed dark trough background with inset 1px border
    c2d.fillStyle = 'rgba(0, 0, 0, 0.4)';
    c2d.fillRect(x, TOP, w, BOT - TOP);
    c2d.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c2d.lineWidth = 1;
    c2d.strokeRect(x - 0.5, TOP - 0.5, w + 1, BOT - TOP + 1);

    // 2. Unlit LED segment rungs
    c2d.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (let sy = TOP; sy < BOT; sy += 3) c2d.fillRect(x, sy, w, 2);

    // 3. Lit LED segments up to yTop
    if (yTop < BOT) {
      c2d.save();
      c2d.beginPath();
      c2d.rect(x, yTop, w, BOT - yTop);
      c2d.clip();
      c2d.fillStyle = colorFill;
      c2d.fillRect(x, yTop, w, BOT - yTop);
      // Dark segment separator slits (1px every 3px)
      c2d.fillStyle = 'rgba(10, 12, 16, 0.88)';
      for (let sy = TOP + 2; sy < BOT; sy += 3) c2d.fillRect(x, sy, w, 1);
      c2d.restore();
    }
  }

  function scale(x, majorTicks, minorTicks, f, fmtT = String, right = false, col = '#7e8796') {
    if (minorTicks) {
      c2d.fillStyle = 'rgba(255, 255, 255, 0.14)';
      for (const t of minorTicks) {
        const y = Math.round(f(t));
        if (y >= TOP && y <= BOT) c2d.fillRect(right ? x : x - 1, y, 1, 1);
      }
    }
    c2d.font = 'bold 8px ui-monospace,Menlo,Consolas,monospace';
    c2d.textAlign = right ? 'left' : 'right';
    c2d.textBaseline = 'middle';
    for (const t of majorTicks) {
      const y = Math.round(f(t));
      if (y < TOP || y > BOT) continue;
      const is0 = (t === 0), isVu = (t === VU_REF), isTgt = (t === TARGET);
      c2d.fillStyle = is0 ? '#ff5252' : isVu ? '#f5b82e' : isTgt ? '#ff3366' : col;
      c2d.fillRect(right ? x : x - 2, y, 2, 1);
      c2d.fillText(fmtT(t), right ? x + 3 : x - 3, Math.min(BOT - 3, Math.max(TOP + 3, y)));
    }
  }

  function label(x, s) {
    c2d.fillStyle = '#8f98a8';
    c2d.font = 'bold 8.5px ui-monospace,Menlo,Consolas,monospace';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'alphabetic';
    c2d.fillText(s, x, 9);
  }

  // ---------- per-frame: Peak / VU ----------
  function frame() {
    requestAnimationFrame(frame);
    if (!cur || !S.visible || document.hidden) return;
    const { g, video } = cur, sr = ctx.sampleRate, now = ctx.currentTime, t = performance.now();
    const dt = Math.max(1 / sr, now - st.lastT); st.lastT = now;
    const fdt = st.lastFrame ? Math.min(0.2, (t - st.lastFrame) / 1000) : 0; st.lastFrame = t;
    const n = Math.min(g.fft, Math.max(128, Math.round(dt * sr)));
    const off = offset(), a = 1 - Math.exp(-fdt / 0.045);   // VU: 2次臨界制動 ≈ 300ms で99%
    for (let ch = 0; ch < 2; ch++) {
      g.raw[ch].getFloatTimeDomainData(g.buf);
      let pk = 0, sa = 0;
      for (let i = g.fft - n; i < g.fft; i++) { const s = Math.abs(g.buf[i]); sa += s; if (s > pk) pk = s; }
      const p = db(pk) + off;
      st.peak[ch] = Math.max(p, st.peak[ch] - 24 * fdt);                     // 落下 24 dB/s
      if (p >= st.hold[ch]) { st.hold[ch] = p; st.holdT[ch] = t; }
      else if (t - st.holdT[ch] > 1500) st.hold[ch] = Math.max(p, st.hold[ch] - 30 * fdt);
      if (!video.paused && !isAd()) {
        st.max[ch] = Math.max(st.max[ch], p);
        if (p >= -0.1) st.clipT[ch] = t;
      }
      const avg = (sa / n) * 1.1107;                                          // 平均値応答 → サイン波RMS校正
      st.vu1[ch] += (avg - st.vu1[ch]) * a; st.vu2[ch] += (st.vu1[ch] - st.vu2[ch]) * a;
    }
    draw(off);
  }

  let lastDpr = 0;
  function ensureDpr() {
    if (!canvas || !c2d) return;
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      c2d.scale(dpr, dpr);
    }
  }

  function draw(off) {
    ensureDpr();
    c2d.clearRect(0, 0, W, H);
    const t = performance.now();
    const yp = yf(-60, 0), yl = yf(-36, 0);

    // --- Headers ---
    label(34, 'PK / VU');
    label(104, 'LUFS');

    // --- Scales ---
    scale(19, [-60, -48, -36, -24, -18, -12, -6, -3, 0], [-54, -42, -30, -15, -9, -1], yp);
    scale(48, [-20, -10, -5, 0, 3], [-15, -7, -3, -1, 1, 2], d => yp(d + VU_REF), d => (d > 0 ? '+' + d : d), true, '#e2cb92');
    const LX = 97;
    scale(LX - 2, [-36, -30, -24, -20, -14, -9, -6, 0], [-33, -27, -18, -16, -12, -3], yl);

    // --- Gradients ---
    const spanP = BOT - TOP;
    const pkGrad = c2d.createLinearGradient(0, BOT, 0, TOP);
    const pVu = (BOT - yp(VU_REF)) / spanP;
    const pWarn = (BOT - yp(-6)) / spanP;
    pkGrad.addColorStop(0, '#00b84c');
    pkGrad.addColorStop(Math.max(0, pVu - 0.05), '#2ae574');
    pkGrad.addColorStop(pVu, '#f5b82e');
    pkGrad.addColorStop(pWarn, '#ff7a18');
    pkGrad.addColorStop(0.96, '#ff263e');
    pkGrad.addColorStop(1, '#ff0d30');

    const vuGrad = c2d.createLinearGradient(0, BOT, 0, TOP);
    vuGrad.addColorStop(0, '#ffd84a');
    vuGrad.addColorStop(pVu, '#ffe066');
    vuGrad.addColorStop(1, '#ff3a2a');

    // --- PK / VU Channels (L=0, R=1) ---
    for (let ch = 0; ch < 2; ch++) {
      const x = 21 + ch * 14;

      // Channel / CLIP badge above bar (y: 12..21)
      const isClipped = (t - st.clipT[ch] < 2000);
      c2d.fillStyle = isClipped ? '#ff1744' : 'rgba(255, 255, 255, 0.06)';
      c2d.fillRect(x, 12, 12, 9);
      c2d.strokeStyle = isClipped ? '#ff5252' : 'rgba(255, 255, 255, 0.10)';
      c2d.lineWidth = 1;
      c2d.strokeRect(x - 0.5, 11.5, 13, 10);
      c2d.font = 'bold 7.5px ui-monospace,Menlo,Consolas,monospace';
      c2d.textAlign = 'center';
      c2d.textBaseline = 'middle';
      c2d.fillStyle = isClipped ? '#ffffff' : '#8a94a6';
      c2d.fillText(ch === 0 ? 'L' : 'R', x + 6, 16.5);

      // Main Peak LED bar
      drawLedBar(x, 12, yp(st.peak[ch]), pkGrad);

      // Center VU meter needle bar
      const yvu = Math.round(yp(db(st.vu2[ch]) + off));
      c2d.fillStyle = 'rgba(0, 0, 0, 0.45)';
      c2d.fillRect(x + 4, TOP, 4, BOT - TOP);
      if (yvu < BOT) {
        c2d.fillStyle = vuGrad;
        c2d.fillRect(x + 4, yvu, 4, BOT - yvu);
        c2d.fillStyle = 'rgba(6, 8, 12, 0.85)';
        for (let sy = TOP + 2; sy < BOT; sy += 3) c2d.fillRect(x + 4, sy, 4, 1);
      }

      // Peak Hold indicator line
      const yh = Math.round(yp(st.hold[ch]));
      if (yh >= TOP && yh <= BOT) {
        const isHot = st.hold[ch] > -1;
        c2d.fillStyle = isHot ? '#ff2a4b' : '#ffffff';
        c2d.fillRect(x, yh - 1, 12, 2);
        c2d.fillStyle = isHot ? 'rgba(255, 42, 75, 0.45)' : 'rgba(255, 255, 255, 0.3)';
        c2d.fillRect(x - 1, yh - 2, 14, 4);
      }
    }

    // 0 VU reference line across PK/VU
    const y0vu = Math.round(yp(VU_REF));
    c2d.fillStyle = 'rgba(245, 184, 46, 0.85)';
    c2d.fillRect(19, y0vu, 30, 1);

    // --- LUFS Channel ---
    const lo = loud();
    // LUFS Channel badge
    c2d.fillStyle = 'rgba(255, 255, 255, 0.06)';
    c2d.fillRect(LX, 12, 14, 9);
    c2d.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    c2d.lineWidth = 1;
    c2d.strokeRect(LX - 0.5, 11.5, 15, 10);
    c2d.font = 'bold 7px ui-monospace,Menlo,Consolas,monospace';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    c2d.fillStyle = '#5cd9ff';
    c2d.fillText('SHORT', LX + 7, 16.5);

    // LUFS gradient
    const spanL = BOT - TOP;
    const pTarget = (BOT - yl(TARGET)) / spanL;
    const lufsGrad = c2d.createLinearGradient(0, BOT, 0, TOP);
    lufsGrad.addColorStop(0, '#1a56b8');
    lufsGrad.addColorStop(0.35, '#00b0ff');
    lufsGrad.addColorStop(Math.max(0, pTarget - 0.08), '#00e5a3');
    lufsGrad.addColorStop(pTarget, '#2de672');
    lufsGrad.addColorStop(Math.min(1, pTarget + 0.08), '#ffaa00');
    lufsGrad.addColorStop(1, '#ff2448');

    // LUFS LED bar
    drawLedBar(LX, 14, yl(lo.s), lufsGrad);

    // Momentary line (M) - Neon cyan
    if (Number.isFinite(lo.m)) {
      const ym = Math.round(yl(lo.m));
      if (ym >= TOP && ym <= BOT) {
        c2d.fillStyle = '#00f0ff';
        c2d.fillRect(LX - 1, ym - 1, 16, 2);
        c2d.fillStyle = 'rgba(0, 240, 255, 0.35)';
        c2d.fillRect(LX - 2, ym - 2, 18, 4);
      }
    }

    // YouTube Target -14 line
    const yTgt = Math.round(yl(TARGET));
    c2d.fillStyle = '#ff2a6d';
    c2d.fillRect(LX - 3, yTgt, 20, 1.5);
    c2d.fillStyle = 'rgba(255, 42, 109, 0.3)';
    c2d.fillRect(LX - 4, yTgt - 1, 22, 3.5);

    // Integrated marker (I) - Gold triangular pointer
    if (Number.isFinite(lo.i)) {
      const yi = Math.round(yl(lo.i));
      if (yi >= TOP && yi <= BOT) {
        c2d.fillStyle = '#ffd700';
        c2d.beginPath();
        c2d.moveTo(W - 2, yi - 4);
        c2d.lineTo(W - 2, yi + 4);
        c2d.lineTo(W - 8, yi);
        c2d.closePath();
        c2d.fill();
        c2d.strokeStyle = '#221a00';
        c2d.lineWidth = 1;
        c2d.stroke();
      }
    }
  }

  // ---------- 100ms tick: LUFS ----------
  let tickCount = 0;
  function loud() { return lastLo; }

  function integ(arr) {
    let s = 0, n = 0;
    for (const e of arr) if (e > ABS_GATE_E) { s += e; n++; }
    if (!n) return -Infinity;
    const rel = Math.pow(10, (lk(s / n) - 10 + 0.691) / 10);
    s = 0; n = 0;
    for (const e of arr) if (e > ABS_GATE_E && e > rel) { s += e; n++; }
    return n ? lk(s / n) : -Infinity;
  }

  function tick() {
    if (!cur) return;
    const { g, video } = cur, sr = ctx.sampleRate, now = ctx.currentTime;
    const dt = now - L.lastT; L.lastT = now;
    if (dt <= 0) return;
    const n = Math.min(g.fft, Math.max(1, Math.round(dt * sr)));
    let e = 0;
    for (let ch = 0; ch < 2; ch++) {                    // L/R 重み G=1.0
      g.kw[ch].getFloatTimeDomainData(g.buf);
      let ss = 0; for (let i = g.fft - n; i < g.fft; i++) ss += g.buf[i] * g.buf[i];
      e += ss / n;
    }
    const v2 = vol() ** 2;
    const active = !video.paused && !video.ended && !video.seeking && !isAd();
    const pre = cur.hooked ? e : (v2 > 0 ? e / v2 : NaN), post = cur.hooked ? e * v2 : e;
    L.sub.push({ pre, post, active }); if (L.sub.length > 30) L.sub.shift();

    const last4 = L.sub.slice(-4);
    const mean = (arr, k) => arr.reduce((s, b) => s + b[k], 0) / arr.length;
    if (last4.length === 4 && last4.every(b => b.active)) {
      L.gate.push(mean(last4, 'post'));
      const p = mean(last4, 'pre'); if (Number.isFinite(p)) L.gatePre.push(p);
    }
    const k = S.pre ? 'pre' : 'post';
    const m = lk(mean(last4, k)), s = lk(mean(L.sub, k));
    tickCount++;
    if (tickCount % 5 === 0 || !Number.isFinite(lastLo.i)) {
      lastLo.i = integ(S.pre ? L.gatePre : L.gate);
    }
    lastLo.m = m; lastLo.s = s;
    if (S.visible && S.num && elNums) {
      const d = lastLo.i - TARGET;
      const cls = !Number.isFinite(d) ? '' : d > 1 ? 'hi' : d < -1 ? 'lo' : 'ok';
      const note = isAd() ? '  [AD]' : (S.pre && vol() === 0 ? '  [MUTED]' : '');
      elNums.innerHTML =
        `Peak max  L <b>${fmt(st.max[0])}</b>  R <b>${fmt(st.max[1])}</b> dBFS\n` +
        `M <b>${fmt(lastLo.m)}</b>  S <b>${fmt(lastLo.s)}</b>  I <b>${fmt(lastLo.i)}</b> LUFS\n` +
        `vs YouTube -14: <b class="${cls}">${Number.isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) + ' LU' : '--'}</b>` +
        `${cls === 'hi' ? ' (YouTube側で減衰)' : ''}${note}`;
    }
  }

  // ---------- settings & boot ----------
  chrome.storage.local.get(S, v => {
    Object.assign(S, v);
    applyVis();
    applyNum();
    updMode();
    if (host) { host.style.left = S.posX * 100 + '%'; host.style.top = S.posY * 100 + '%'; }
  });
  chrome.storage.onChanged.addListener(ch => {
    if (ch.visible) { S.visible = ch.visible.newValue; applyVis(); }
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.action === 'toggle') {
      S.visible = !S.visible;
      applyVis();
      save();
    }
  });

  setInterval(() => {
    const v = findVideo();
    if (!v) return;
    mount(v);
    if ((!cur || cur.video !== v) && pending !== v) attach(v);
  }, 1000);
  setInterval(tick, 100);
  requestAnimationFrame(frame);
})();
