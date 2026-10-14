# YouTube dB Meter Overlay

YouTube / YouTube Studio の動画プレーヤーに **Peak / VU / LUFS** メーターを重ねて表示する Chrome 拡張（Manifest V3）。

## 機能
- **PK/VU**：太バー＝サンプルピーク (dBFS) / 中央の細バー＝VU (0 VU = −18 dBFS, 300 ms 弾道) / 横線＝ピークホールド
- **LUFS**：BS.1770 K-weighting。バー＝Short-term (3 s)、白線＝Momentary (400 ms)、▶＝Integrated（ゲーティングあり）、赤線＝YouTube 基準 −14 LUFS
- **PRE / POST**：PRE は YouTube の音量スライダー・ラウドネスノーマライズ・ミュート前の信号を計測（`volhook.js` で `volume`/`muted` を仮想化し、音量は Web Audio の GainNode で適用）
- 広告再生中・一時停止中は Integrated に加算しない
- ドラッグで移動、全画面でも表示。ツールバーアイコン / `Alt+Shift+M` で表示切替

## [ダウンロード](https://github.com/TecnohShinonome/yt-db-meter/archive/refs/heads/main.zip)

## インストール
1. `chrome://extensions` → デベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択
3. YouTube のタブを再読み込みし、ページを一度クリック（AudioContext 起動のため）

## 目安
- **ピーク値：**0dBFS未満（左側のカラーのゲージ。てっぺん張り付きは割れています）
- **トーク中：**-14 LUFS(Youtube基準、右側のゲージの白線）
- **BGMだけ（しゃべっている間）**	-28〜-32 LUFS　※諸説あります
- **BGMだけ（OPなど）**	-18〜-22LUFS　※諸説あります

## 注意
- K-weighting は BiquadFilter による近似（1 kHz で約 0.2 dB の誤差）。厳密な納品チェックには専用メーターを使用してください。
- True Peak ではなくサンプルピークです。
