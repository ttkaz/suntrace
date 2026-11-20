# SunTrace v0.6.3 — 画角ガイド非表示の修正

SafariでSVGの `hidden` プロパティが正しく反映されず、ボタンは進むのに照準が表示されない可能性に対処します。

`apply_fov_guide_fix.py` をSunTraceリポジトリのルートにコピーし、PowerShellで実行してください。

```powershell
python .\apply_fov_guide_fix.py
git diff -- web/js/app.js
git add web/js/app.js
git commit -m "Fix FOV guide visibility on Safari"
git push
```

動作確認：画角測定を開始するとガイド線と左側照準が現れ、左側を登録すると右側に移動すること。ガイドが出なければ次はSafariの表示レイヤーを検証します。

このパッチはカメラや画角算出のロジックには変更を加えません。

## v1.0.0 — 初版リリース

iPhone Safari向けに、実景へ日付別の太陽軌道を重ねて表示・撮影するWebアプリの初版。

### 機能
- GPSと端末姿勢による太陽軌道AR表示
- 日付指定、春分・夏至・秋分・冬至頃の切り替え
- 軌道の時間帯別色分けと1時間ごとの時刻ラベル
- 真北の基準登録、方位・仰角補正
- カメラ別の2点式画角校正と校正値保存
- AR合成PNG保存、3秒・10秒セルフタイマー

### 制約・検証状況
- 太陽軌道の絶対位置精度は実地検証中。日照時間の自動算出は未実装。
- ARと画角校正は縦向き専用。
- 撮影画像の解像度はカメラストリームに依存。
- Safariのカメラでは露出補正APIが利用できない場合がある。
- 権限の再要求はSafariの仕様や設定に依存。

### 今後の改善候補
- 写真の高解像度化
- 撮影時の全画面表示
- 画角校正用ルーペ
- GPSと権限取得の操作改善
- 横向き対応の検討

### 公開ページ
https://ttkaz.github.io/suntrace/
