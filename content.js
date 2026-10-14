// YouTube dB Meter Overlay — Peak / VU / LUFS (BS.1770 K-weighting, YouTube -14 LUFS reference)
(() => {
  'use strict';
  if (window.__ytdbm) return;
  window.__ytdbm = true;

  const TARGET = -14;            // YouTube 基準ラウドネス
  const VU_REF = -18;            // 0 VU = -18 dBFS (sine RMS)
  const ABS_GATE_E = Math.pow(10, (-70 + 0.691) / 10);
  const S = { visible: true, pre: true, posX: 0.02, posY: 0.04 };   // pre: 音量フェーダー前で計測

  let ctx = null, cur = null, pending = null;
  const graphs = new WeakMap();
  let host, root, canvas, c2d, elStatus, elNums, btnPre, btnPost;
  function updMode() { if (!btnPre) return; btnPre.classList.toggle('on', S.pre); btnPost.classList.toggle('on', !S.pre); }

  const st = {};
  const L = { sub: [], gate: [], gatePre: [], lastT: 0 };
  function resetMeters() {
    Object.assign(st, {
      peak: [-90, -90], hold: [-90, -90], holdT: [0, 0], max: [-Infinity, -Infinity],
      vu1: [0, 0], vu2: [0, 0], lastT: ctx ? ctx.currentTime : 0, lastFrame: 0,
    });
  }
  function resetLoudness() { L.sub = []; L.gate = []; L.gatePre = []; L.lastT = ctx ? ctx.currentTime : 0; }
  resetMeters(); resetLoudness();

  const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const lk = e => (e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity);
  const fmt = v => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
  // 実効音量（hook 済みなら YouTube が設定した仮想値）
  function vol() {
    if (!cur) return 0;
    if (cur.hooked) return cur.vMute ? 0 : cur.vVol;
    return cur.video.muted ? 0 : cur.video.volume;
  }
  // 計測信号 → 表示値の補正 dB。hooked: 信号はPRE / 未hook: 信号はPOST
  function offset() {
    const v = vol();
    if (cur?.hooked) return S.pre ? 0 : (v > 0 ? 20 * Math.log10(v) : -Infinity);
    return S.pre && v > 0 ? -20 * Math.log10(v) : 0;
  }
  const isAd = () => !!(cur && cur.video.closest('.ad-showing'));

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
  const W = 124, H = 232, TOP = 18, BOT = H - 6;
  function makeUI() {
    host = document.createElement('div');
    host.id = 'ytdbm-host';
    Object.assign(host.style, { position: 'absolute', zIndex: 2000, left: S.posX * 100 + '%', top: S.posY * 100 + '%' });
    ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'contextmenu', 'wheel']
      .forEach(t => host.addEventListener(t, e => e.stopPropagation()));
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
<style>
.p{font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e8e8e8;background:rgba(12,12,16,.82);
   border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:4px 6px 6px;user-select:none;opacity:.88;
   backdrop-filter:blur(4px)}
.p:hover{opacity:1}
.hd{display:flex;gap:4px;align-items:center;cursor:move;margin-bottom:2px}
.t{font-weight:700;white-space:nowrap;flex:1}
.st{color:#ffcf5a;font-size:10px}.st:empty{display:none}
button{font:10px ui-monospace,Menlo,monospace;color:#ddd;background:#2a2a32;border:1px solid #444;border-radius:4px;padding:0 4px;cursor:pointer}
button:hover{background:#3a3a46}
button.on{background:#2f7fe0;border-color:#5aa2ff;color:#fff;font-weight:700}
.seg{display:flex}.seg button:first-child{border-radius:4px 0 0 4px}.seg button:last-child{border-radius:0 4px 4px 0;border-left:0}
canvas{display:block;width:${W}px;height:${H}px}
</style>
<div class="p">
  <div class="hd"><span class="t">dB</span>
    <span class="seg"><button class="pre" title="音量フェーダー前の信号">PRE</button><button class="post" title="YouTube音量/ノーマライズ適用後の信号">POST</button></span>
    <button class="rst" title="最大値・Integratedをリセット">RST</button>
    <button class="x" title="隠す（ツールバーアイコン / Alt+Shift+M で再表示）">×</button></div>
  <div class="st"></div>
  <canvas></canvas>
</div>`;
    canvas = root.querySelector('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    c2d = canvas.getContext('2d'); c2d.scale(dpr, dpr);
    elStatus = root.querySelector('.st'); elNums = root.querySelector('.n');
    btnPre = root.querySelector('.pre'); btnPost = root.querySelector('.post');
    const setMode = p => { if (S.pre !== p) { S.pre = p; resetMeters(); save(); } updMode(); };
    btnPre.onclick = () => setMode(true); btnPost.onclick = () => setMode(false);
    updMode();
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
      const upf = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', upf); save(); };
      hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', upf);
    });
    applyVis();
  }
  function setStatus(s) { if (elStatus) elStatus.textContent = s; }
  function applyVis() { if (host) host.style.display = S.visible ? '' : 'none'; }
  function mount(video) {
    const player = video.closest('#movie_player, .html5-video-player') || video.parentElement;
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
  function vbar(x, w, y, color) { c2d.fillStyle = '#26262c'; c2d.fillRect(x, TOP, w, BOT - TOP); c2d.fillStyle = color; c2d.fillRect(x, y, w, BOT - y); }
  function scale(x, ticks, f, fmtT = String, right = false, col = '#999') {   // right=true: 目盛りの右側に数値
    c2d.fillStyle = col; c2d.font = '8px ui-monospace,Menlo,monospace'; c2d.textAlign = right ? 'left' : 'right'; c2d.textBaseline = 'middle';
    for (const t of ticks) {
      const y = f(t); c2d.fillRect(right ? x : x - 2, Math.round(y), 2, 1);
      c2d.fillText(fmtT(t), right ? x + 3 : x - 3, Math.min(BOT - 3, Math.max(TOP + 3, y)));
    }
  }
  function label(x, s) { c2d.fillStyle = '#bbb'; c2d.font = 'bold 9px ui-monospace,Menlo,monospace'; c2d.textAlign = 'center'; c2d.textBaseline = 'alphabetic'; c2d.fillText(s, x, 10); }
  function grad(f, stops) {
    const g = c2d.createLinearGradient(0, BOT, 0, TOP), span = BOT - TOP;
    stops.forEach(([d, c], i) => { const p = (BOT - f(d)) / span; if (i) g.addColorStop(p, stops[i - 1][1]); g.addColorStop(p, c); });
    g.addColorStop(1, stops[stops.length - 1][1]); return g;
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
      if (!video.paused && !isAd()) st.max[ch] = Math.max(st.max[ch], p);
      const avg = (sa / n) * 1.1107;                                          // 平均値応答 → サイン波RMS校正
      st.vu1[ch] += (avg - st.vu1[ch]) * a; st.vu2[ch] += (st.vu1[ch] - st.vu2[ch]) * a;
    }
    draw(off);
  }

  function draw(off) {
    c2d.clearRect(0, 0, W, H);
    // PEAK + VU 兼用：太バー=Peak(dBFS) / 中央の細バー=VU / 横線=Peak hold
    const yp = yf(-60, 0);
    label(34, 'PK/VU');
    scale(19, [-60, -48, -36, -24, -18, -12, -6, -3, 0], yp);                                 // 左: dBFS
    scale(48, [-20, -10, -5, 0, 3], d => yp(d + VU_REF), d => (d > 0 ? '+' + d : d), true, '#e9d9a8'); // 右: VU
    const gp = grad(yp, [[-60, '#3ccf6a'], [-18, '#e8d03a'], [-6, '#ff4a3a']]);
    for (let ch = 0; ch < 2; ch++) {
      const x = 21 + ch * 14;
      vbar(x, 12, yp(st.peak[ch]), gp);
      c2d.globalAlpha = 0.85; c2d.fillStyle = '#16161a'; c2d.fillRect(x + 4, TOP, 4, BOT - TOP); c2d.globalAlpha = 1;
      const yvu = yp(db(st.vu2[ch]) + off);
      c2d.fillStyle = '#fff4d6'; c2d.fillRect(x + 4, yvu, 4, BOT - yvu);
      c2d.fillStyle = st.hold[ch] > -1 ? '#ff4a3a' : '#fff'; c2d.fillRect(x, yp(st.hold[ch]) - 1, 12, 2);
    }
    c2d.fillStyle = 'rgba(255,90,58,.8)'; c2d.fillRect(20, yp(VU_REF), 29, 1);              // 0 VU 線

    // LUFS (S=バー, M=白線, I=▶, -14=赤線)
    const yl = yf(-36, 0), lo = loud();
    const LX = 97;
    label(LX + 6, 'LUFS');
    scale(LX - 2, [-36, -30, -24, -20, -14, -9, -6, 0], yl);
    vbar(LX, 14, yl(lo.s), lo.s > TARGET + 1 ? '#ff8a5a' : lo.s >= TARGET - 2 ? '#3ccf6a' : '#4f8fe0');
    c2d.fillStyle = '#fff'; if (Number.isFinite(lo.m)) c2d.fillRect(LX, yl(lo.m) - 1, 14, 2);
    c2d.fillStyle = '#ff3b6b'; c2d.fillRect(LX - 3, yl(TARGET) - 1, 20, 2);
    if (Number.isFinite(lo.i)) {
      const y = yl(lo.i); c2d.fillStyle = '#ffd84a';
      c2d.beginPath(); c2d.moveTo(W - 1, y - 4); c2d.lineTo(W - 1, y + 4); c2d.lineTo(W - 6, y); c2d.fill();
    }
  }

  // ---------- 100ms tick: LUFS ----------
  let lastLo = { m: -Infinity, s: -Infinity, i: -Infinity };
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
    if (last4.length === 4 && last4.every(b => b.active)) {   // 400ms ブロック / 75% オーバーラップ
      L.gate.push(mean(last4, 'post'));
      const p = mean(last4, 'pre'); if (Number.isFinite(p)) L.gatePre.push(p);
    }
    const k = S.pre ? 'pre' : 'post';
    lastLo = { m: lk(mean(last4, k)), s: lk(mean(L.sub, k)), i: integ(S.pre ? L.gatePre : L.gate) };
    if (S.visible && elNums) {
      const d = lastLo.i - TARGET;
      const cls = !Number.isFinite(d) ? '' : d > 1 ? 'hi' : d < -1 ? 'lo' : 'ok';
      const note = isAd() ? '  [AD]' : (S.pre && vol() === 0 ? '  [MUTED]' : '');
      elNums.innerHTML =
        `Peak max  L <b>${fmt(st.max[0])}</b>  R <b>${fmt(st.max[1])}</b> dBFS\n` +
        `M <b>${fmt(lastLo.m)}</b>  S <b>${fmt(lastLo.s)}</b>  I <b>${fmt(lastLo.i)}</b> LUFS\n` +
        `vs YouTube -14: <b class="${cls}">${Number.isFinite(d) ? (d > 0 ? '+' : '') + d.toFixed(1) + ' LU' : '--'}</b>` +
        `${cls === 'hi' ? ' (YouTube側で下げられる)' : ''}${note}`;
    }
  }

  // ---------- settings & boot ----------
  function save() { try { chrome.storage.local.set({ ...S }); } catch {} }
  chrome.storage.local.get(S, v => {
    Object.assign(S, v);
    applyVis();
    if (host) { host.style.left = S.posX * 100 + '%'; host.style.top = S.posY * 100 + '%'; }
    updMode();
  });
  chrome.storage.onChanged.addListener(ch => { if (ch.visible) { S.visible = ch.visible.newValue; applyVis(); } });

  setInterval(() => {
    const v = findVideo();
    if (!v) return;
    mount(v);
    if ((!cur || cur.video !== v) && pending !== v) attach(v);
  }, 1000);
  setInterval(tick, 100);
  requestAnimationFrame(frame);
})();
