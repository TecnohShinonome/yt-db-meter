// MAIN world: video の volume / muted を仮想化する。
// 実要素は volume=1, muted=false に固定し、ページ（YouTube）が設定した値は
// data-ytdbm-vol 属性で isolated 側へ渡す → isolated 側の GainNode で音量を掛ける。
// これにより MediaElementSource から「音量フェーダー前」の信号が取れる。
(() => {
  const P = HTMLMediaElement.prototype;
  const dV = Object.getOwnPropertyDescriptor(P, 'volume');
  const dM = Object.getOwnPropertyDescriptor(P, 'muted');
  document.addEventListener('ytdbm-hook', e => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement) || v.__ytdbmHooked) return;
    v.__ytdbmHooked = true;
    let vol = dV.get.call(v), mut = dM.get.call(v);
    const pub = () => v.setAttribute('data-ytdbm-vol', `${vol},${mut ? 1 : 0}`);
    pub();
    dV.set.call(v, 1);
    dM.set.call(v, false);
    const changed = () => { pub(); v.dispatchEvent(new Event('volumechange')); };
    Object.defineProperty(v, 'volume', {
      configurable: true,
      get: () => vol,
      set: x => {
        x = Number(x);
        if (!(x >= 0 && x <= 1)) return dV.set.call(v, x);   // 範囲外はネイティブと同じ例外を出す
        if (x !== vol) { vol = x; changed(); }
      },
    });
    Object.defineProperty(v, 'muted', {
      configurable: true,
      get: () => mut,
      set: x => { x = !!x; if (x !== mut) { mut = x; changed(); } },
    });
  }, true);
})();
