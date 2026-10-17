# YouTube dB Meter Overlay

YouTube / YouTube Music / YouTube Studio の動画プレーヤーに **Peak / VU / LUFS** メーターを重ねて表示する Chrome 拡張（Manifest V3）。

## 機能
- **PK/VU**：LEDセグメントラダー表示。太バー＝サンプルピーク (dBFS) / 中央の細バー＝VU (0 VU = −18 dBFS, 300 ms 弾道) / 横線＝ピークホールド / 上部 L・R バッジ＝クリップ警告インジケーター（-0.1 dBFS以上で赤色点灯）
- **LUFS**：BS.1770 K-weighting。LEDセグメントバー＝Short-term (3 s)、ネオンシアン線＝Momentary (400 ms)、ゴールド▶＝Integrated（ゲーティングあり）、赤線＝YouTube 基準 −14 LUFS
- **PRE / POST 切替**：原音信号（PRE：YouTube音量スライダー影響なし）とリスニング音量（POST）をワンクリックで切替可能
- **NUM（数値表示）**：Peak Max (L/R)、LUFS (M/S/I)、および YouTube -14 基準との差分数値をオン/オフ表示
- **LEDセグメントラダー**：Peak / VU / LUFS のプロ用ハードウェア調メーターバー、クリップ警告（-0.1 dBFS以上で赤点灯）
- **すりガラス透過**：背後の動画を邪魔しない上品なグラスモーフィズムデザイン
- 広告再生中・一時停止中は Integrated に加算しない
- ドラッグで移動、全画面でも表示。ツールバーアイコン / `Alt+Shift+M` で表示切替

## ダウンロード 
- [Github](https://github.com/TecnohShinonome/yt-db-meter/archive/refs/heads/main.zip)
- [Chrome Webストア](https://chromewebstore.google.com/detail/db-meter-overlay-for-yout/gpncigfnmiafcbdjlggkdegplhmpkpgl)

## インストール
1. `chrome://extensions` → デベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択
3. YouTube のタブを再読み込みし、ページを一度クリック（AudioContext 起動のため）

## 目安
- **ピーク値：** 0dBFS未満（左側のカラーのゲージ。てっぺん張り付きは割れています）
- **トーク中：** -14 LUFS(Youtube基準、右側のゲージの白線）
- **BGMだけ（しゃべっている間）**	-28〜-32 LUFS　※諸説あります
- **BGMだけ（OPなど）**	-18〜-22LUFS　※諸説あります

## 注意
- K-weighting は BiquadFilter による近似（1 kHz で約 0.2 dB の誤差）。厳密な納品チェックには専用メーターを使用してください。
- True Peak ではなくサンプルピークです。
