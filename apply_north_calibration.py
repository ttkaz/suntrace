#!/usr/bin/env python3
"""Apply SunTrace experimental true-north calibration to existing web assets.
Run from anywhere: python apply_north_calibration.py C:\\Users\\float\\project\\suntrace
"""
from pathlib import Path
import sys

def replace_once(s, old, new, name):
    count=s.count(old)
    if count!=1:
        raise RuntimeError(f'{name}: expected one match, got {count}: {old[:80]!r}')
    return s.replace(old,new,1)

def main():
    root=Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd()
    jp=root/'web/js/app.js'; hp=root/'web/index.html'
    js=jp.read_text(encoding='utf-8-sig'); html=hp.read_text(encoding='utf-8-sig')
    if 'function calibrateNorth()' in js:
        raise RuntimeError('True-north patch already applied')
    js=replace_once(js,'let latestSun=null;', '''let latestSun=null;
// Experimental: relative north heading; deviceorientation alpha can still be magnetically corrected.
let northReference=null;''','JS north state')
    js=replace_once(js,'const yaw=diff(bearing(forward)-orient.heading)-Number($(\'yawOffset\').value);', '''const yaw=(northReference===null
    ? diff(bearing(forward)-orient.heading)
    : northReference)-Number($('yawOffset').value);''','JS heading model')
    js=replace_once(js,'function centerSun(){', '''function calibrateNorth(){
  if(!orient){calibrationStatus('真北校正不可：姿勢センサーが未取得です。');return;}
  if(screenAngle()!==0){calibrationStatus('真北校正不可：iPhoneを縦向きにしてください。');return;}
  // Capture uncorrected raw orientation rather than the magnetic heading.
  const raw=w3cRotation(vector(0,0,-1),orient.alpha,orient.beta,orient.gamma);
  if(Math.abs(altitude(raw))>60){calibrationStatus('真北校正不可：カメラをもう少し水平に向けてください。');return;}
  northReference=bearing(raw);
  $('yawOffset').value='0';$('pitchOffset').value='0';
  refreshLabels();
  const b=getBasis(),residual=diff(bearing(b.forward));
  calibrationStatus(`真北基準登録：方位 ${fmt(bearing(b.forward))}、残差 ${fmt(residual)}、仰角 ${fmt(altitude(b.forward))}。東・南・西へ回してから北へ戻し、再現性を確認してください。`);
}
function centerSun(){''','JS north function')
    js=replace_once(js,"  // Start from zero offsets to measure the uncalibrated discrepancy.\n  $('yawOffset').value='0';", "  // Solar calibration restores the existing compass-based heading model.\n  northReference=null;\n  // Start from zero offsets to measure the uncalibrated discrepancy.\n  $('yawOffset').value='0';",'JS solar reset')
    js=replace_once(js,"$('centerSun').addEventListener('click',centerSun);", "$('centerSun').addEventListener('click',centerSun);\n$('calibrateNorth').addEventListener('click',calibrateNorth);",'JS event')
    js=replace_once(js,"$('resetCalibration').addEventListener('click',()=>{for(const id of ['yawOffset','pitchOffset'])", "$('resetCalibration').addEventListener('click',()=>{northReference=null;for(const id of ['yawOffset','pitchOffset'])",'JS reset')
    js=replace_once(js,"  $('cameraAz').textContent=basis?fmt(bearing(basis.forward)):'—';", "  $('cameraAz').textContent=basis?fmt(bearing(basis.forward)):'—';\n  $('headingSource').textContent=northReference===null?'コンパス基準':'真北登録基準';",'JS status')
    # Version in title and visible header may be different; update all matching old text.
    html=html.replace('SunTrace v0.5.1','SunTrace v0.5.3').replace('v=0.5.2','v=0.5.3')
    html=replace_once(html,'<div class="metrics submetrics"><span>カメラ仰角','<p class="minor">方位基準：<b id="headingSource">コンパス基準</b></p>\n<div class="metrics submetrics"><span>カメラ仰角','HTML status')
    html=replace_once(html,'<div class="actions calibrationActions"><button id="centerSun">', '''<p class="minor">【夜間テスト】既知の真北にカメラ中央を合わせて登録 → 東90°・南180°・西270° → 北0°へ戻して方位を確認。再読み込みで基準解除。</p>
<div class="actions calibrationActions"><button id="calibrateNorth">真北方向を登録（夜間OK）</button></div>
<div class="actions calibrationActions"><button id="centerSun">''','HTML button')
    # All-or-nothing writes: validation complete before saving either file.
    jp.write_text(js,encoding='utf-8'); hp.write_text(html,encoding='utf-8')
    print('Patched web/js/app.js and web/index.html (SunTrace v0.5.3 north feasibility).')
    print('Review git diff; then git add web/js/app.js web/index.html && git commit -m "Test true north calibration" && git push')

if __name__=='__main__':
    main()
