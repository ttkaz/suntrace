'use strict';
const $ = id => document.getElementById(id);
const DEG=Math.PI/180;
const fmt=n=>Number.isFinite(n)?`${n.toFixed(1)}°`:'—';
const wrap=a=>(a%360+360)%360;
const diff=a=>((a+540)%360)-180;
let stream=null, geoPosition=null, orient=null, compassAccuracy=null;
let starting=false,switching=false,attached=false,selectedCameraId='';
let latestSun=null;
// Experimental: relative north heading; deviceorientation alpha can still be magnetically corrected.
let northReference=null;
function message(s){$('message').textContent=s;}
function fail(prefix,e){message(`${prefix}: ${e?.name||'Error'} / ${e?.message||String(e)}`);}
window.addEventListener('error',e=>message(`JSエラー: ${e.message} (${e.lineno})`));
window.addEventListener('unhandledrejection',e=>fail('非同期エラー',e.reason));
const screenAngle=()=>screen.orientation?.angle??window.orientation??0;
function updateScreen(){$('screen').textContent=`${screenAngle()}°`;drawAR();}
function setNow(){const d=new Date();$('dateTime').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);updateSun();}
function vector(x,y,z){return {x,y,z};}
function dot(a,b){return a.x*b.x+a.y*b.y+a.z*b.z;}
function rotZ(v,t){let c=Math.cos(t),s=Math.sin(t);return vector(v.x*c-v.y*s,v.x*s+v.y*c,v.z);}
function rotX(v,t){let c=Math.cos(t),s=Math.sin(t);return vector(v.x,v.y*c-v.z*s,v.y*s+v.z*c);}
function rotY(v,t){let c=Math.cos(t),s=Math.sin(t);return vector(v.x*c+v.z*s,v.y,-v.x*s+v.z*c);}
function w3cRotation(v,a,b,g){return rotZ(rotX(rotY(v,g*DEG),b*DEG),a*DEG);}
function bearing(v){return wrap(Math.atan2(v.x,v.y)/DEG);}
function altitude(v){return Math.asin(Math.max(-1,Math.min(1,v.z)))/DEG;}
function getBasis(){
  if(!orient||screenAngle()!==0)return null;
  // W3C intrinsic Z-X'-Y'' rotation. Camera looks through device BACK (-z).
  let forward=w3cRotation(vector(0,0,-1),orient.alpha,orient.beta,orient.gamma);
  let right=w3cRotation(vector(1,0,0),orient.alpha,orient.beta,orient.gamma);
  let up=w3cRotation(vector(0,1,0),orient.alpha,orient.beta,orient.gamma);
  // iOS compass heading is treated as the portrait back-camera bearing; this
  // assumption MUST be checked and corrected with on-site calibration.
  const yaw=(northReference===null
    ? diff(bearing(forward)-orient.heading)
    : northReference)-Number($('yawOffset').value);
  forward=rotZ(forward,yaw*DEG);right=rotZ(right,yaw*DEG);up=rotZ(up,yaw*DEG);
  // Pitch around camera-right axis, preserving an orthonormal screen basis.
  const p=Number($('pitchOffset').value)*DEG, c=Math.cos(p),s=Math.sin(p);
  return {forward:vector(forward.x*c+up.x*s,forward.y*c+up.y*s,forward.z*c+up.z*s),
    up:vector(up.x*c-forward.x*s,up.y*c-forward.y*s,up.z*c-forward.z*s),right};
}
function displayRect(){
  const stage=$('stage'), video=$('camera');
  const w=stage.clientWidth,h=stage.clientHeight;
  const vw=video.videoWidth,vh=video.videoHeight;
  if(!vw||!vh)return null;
  const factor=Math.min(w/vw,h/vh),iw=vw*factor,ih=vh*factor;
  return {x:(w-iw)/2,y:(h-ih)/2,w:iw,h:ih};
}
function sunVec(sun){return vector(Math.sin(sun.azimuth*DEG)*Math.cos(sun.altitude*DEG),Math.cos(sun.azimuth*DEG)*Math.cos(sun.altitude*DEG),Math.sin(sun.altitude*DEG));}
function project(sun,basis,rect){
  if(!sun||!basis||!rect)return null;
  const v=sunVec(sun),z=dot(v,basis.forward);
  if(z<=0.0001)return null;
  const vfov=Number($('fovVertical').value)*DEG;
  const focal=(rect.h/2)/Math.tan(vfov/2);
  const x=rect.x+rect.w/2+focal*dot(v,basis.right)/z;
  const y=rect.y+rect.h/2-focal*dot(v,basis.up)/z;
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
function updateSun(){
  latestSun=geoPosition?window.SunTraceSolar?.position(new Date($('dateTime').value),geoPosition.latitude,geoPosition.longitude):null;
  $('sunAz').textContent=fmt(latestSun?.azimuth);$('sunAlt').textContent=fmt(latestSun?.altitude);drawAR();
}
let lastDraw=0;
function drawAR(){
  const svg=$('arOverlay'),circle=$('sunCircle'),paths=$('pathSegments'),stage=$('stage');
  const w=stage.clientWidth,h=stage.clientHeight;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);circle.setAttribute('visibility','hidden');paths.replaceChildren();
  const basis=getBasis(),rect=displayRect();
  $('cameraAz').textContent=basis?fmt(bearing(basis.forward)):'—';
  $('headingSource').textContent=northReference===null?'コンパス基準':'真北登録基準';
  $('cameraAlt').textContent=basis?fmt(altitude(basis.forward)):'—';
  $('imageRect').textContent=rect?`${Math.round(rect.w)}×${Math.round(rect.h)} / x=${Math.round(rect.x)}, y=${Math.round(rect.y)}`:'—';
  if(!basis||!rect||!latestSun){$('viewHint').textContent='GPS・姿勢・カメラ映像の取得待ち（縦向きのみ）';return;}
  const inside=p=>p&&p.x>=rect.x&&p.x<=rect.x+rect.w&&p.y>=rect.y&&p.y<=rect.y+rect.h;
  const p=project(latestSun,basis,rect);
  if(inside(p)&&latestSun.altitude>0){circle.setAttribute('cx',p.x);circle.setAttribute('cy',p.y);circle.setAttribute('visibility','visible');}
  // Draw day path in short segments; avoid connecting over outside-frame gaps.
  const date=new Date($('dateTime').value);if(!Number.isFinite(date.getTime()))return;
  date.setHours(0,0,0,0);
  let line=[];
  const flush=()=>{if(line.length>1){let path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',line.map((v,i)=>`${i?'L':'M'}${v.x.toFixed(1)} ${v.y.toFixed(1)}`).join(' '));paths.append(path);}line=[];};
  for(let minutes=0;minutes<=1440;minutes+=5){
    const solar=window.SunTraceSolar.position(new Date(date.getTime()+minutes*60000),geoPosition.latitude,geoPosition.longitude);
    const point=solar?.altitude>0?project(solar,basis,rect):null;
    if(inside(point))line.push(point);else flush();
  }
  flush();
  $('viewHint').textContent=p&&inside(p)?'☀ 現在選択した日時の太陽位置（未校正）':'太陽は画面外 / 黄線は1日の軌道（未校正）';
}
function onOrientation(e){
  if(![e.alpha,e.beta,e.gamma,e.webkitCompassHeading].every(Number.isFinite)){
    $('status').textContent='姿勢値不足';return;
  }
  orient={alpha:e.alpha,beta:e.beta,gamma:e.gamma,heading:e.webkitCompassHeading};
  compassAccuracy=e.webkitCompassAccuracy;
  $('accuracy').textContent=fmt(compassAccuracy);
  $('orientationInfo').textContent=`α ${fmt(e.alpha)} / β ${fmt(e.beta)} / γ ${fmt(e.gamma)} / compass ${fmt(e.webkitCompassHeading)}`;
  $('status').textContent='センサー受信中';
  // 5-minute solar path sampled only on modest frequency to reduce CPU/battery.
  if(performance.now()-lastDraw>140){lastDraw=performance.now();drawAR();}
}
function videoInfo(){
  const track=stream?.getVideoTracks()[0];if(!track){$('cameraInfo').textContent='カメラ停止中';return;}
  const s=track.getSettings(),cap=track.getCapabilities?.()||{};
  $('trackLabel').textContent=track.label||'名称なし';
  $('resolution').textContent=`${s.width||'?'} × ${s.height||'?'} px`;
  $('zoomInfo').textContent=`${s.zoom??'不明'} / ${cap.zoom?`${cap.zoom.min}〜${cap.zoom.max}`:'非公開'}`;
  $('cameraInfo').textContent=`${track.label||'カメラ'} / ${s.width||'?'}×${s.height||'?'} / zoom=${s.zoom??'?'}（切り抜きなし）`;
  drawAR();
}
async function refreshCameras(){
  try{
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const select=$('cameraSelect'),active=stream?.getVideoTracks()[0]?.getSettings().deviceId;
    select.replaceChildren();for(let i=0;i<devices.length;i++)select.add(new Option(devices[i].label||`カメラ ${i+1}`,devices[i].deviceId));
    const selected=devices.find(d=>d.deviceId===active)||devices.find(d=>d.deviceId===selectedCameraId);
    if(selected)select.value=selected.deviceId;
    selectedCameraId=select.value;select.disabled=!stream||!devices.length;$('refreshCameras').disabled=!stream;videoInfo();
  }catch(e){fail('カメラ一覧取得',e);}
}
async function openCamera(deviceId){
  if(switching)return;switching=true;$('cameraSelect').disabled=true;
  stream?.getTracks().forEach(t=>t.stop());stream=null;$('camera').srcObject=null;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}});
    $('camera').srcObject=stream;await $('camera').play();
    message('カメラ起動成功。通常広角を選び、方位・高度の動作を確認してください。');
  }catch(e){fail('カメラ起動失敗',e);}
  finally{switching=false;await refreshCameras();videoInfo();}
}
async function start(){
  if(starting)return;starting=true;$('start').disabled=true;$('status').textContent='権限確認中';
  let perm;try{perm=(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function')?DeviceOrientationEvent.requestPermission():Promise.resolve('granted');}catch(e){perm=Promise.reject(e);}
  const result=await perm.catch(e=>`error: ${e.message}`);
  if(result==='granted'&&!attached){window.addEventListener('deviceorientation',onOrientation);attached=true;}
  if(result!=='granted')message(`姿勢センサーの権限: ${result}`);
  await openCamera('');$('stop').disabled=!stream;$('start').disabled=!!stream;starting=false;
  if(result==='granted')setTimeout(()=>{if(!orient)message('姿勢データが届いていません。Safariの権限を確認してください。');},3500);
}
function stop(){
  if(attached){window.removeEventListener('deviceorientation',onOrientation);attached=false;}
  stream?.getTracks().forEach(t=>t.stop());stream=null;$('camera').srcObject=null;orient=null;
  $('start').disabled=false;$('stop').disabled=true;$('cameraSelect').disabled=true;$('refreshCameras').disabled=true;
  $('status').textContent='停止';videoInfo();message('停止しました。');
}
function locate(){
  if(!navigator.geolocation){message('GPS API非対応');return;}
  $('locate').disabled=true;message('GPS取得中…');
  navigator.geolocation.getCurrentPosition(p=>{
    geoPosition={latitude:p.coords.latitude,longitude:p.coords.longitude};
    $('coords').textContent=`${geoPosition.latitude.toFixed(5)}, ${geoPosition.longitude.toFixed(5)}`;
    $('gpsAccuracy').textContent=`±${Math.round(p.coords.accuracy)}m`;
    $('locate').disabled=false;message('GPS取得成功。太陽のAR仮表示を開始しました。');updateSun();
  },e=>{$('locate').disabled=false;message(`GPSエラー (${e.code}): ${e.message}`);},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
function refreshLabels(){for(const [key,output] of [['yawOffset','yawValue'],['pitchOffset','pitchValue'],['fovVertical','fovValue']])$(output).textContent=`${$(key).value}°`;drawAR();}
function calibrationStatus(text){
  $('calibrationResult').textContent=text;
  message(text);
}
function calibrateNorth(){
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
function centerSun(){
  if(!orient){calibrationStatus('校正不可：姿勢センサーが未取得です。');return;}
  if(!geoPosition||!latestSun){calibrationStatus('校正不可：GPSと太陽位置が未取得です。');return;}
  if(!getBasis()){calibrationStatus('校正不可：iPhoneを縦向きにしてください。');return;}
  const date=new Date($('dateTime').value);
  if(!Number.isFinite(date.getTime())){calibrationStatus('校正不可：予測日時が無効です。');return;}
  const ageMinutes=Math.abs(Date.now()-date.getTime())/60000;
  if(ageMinutes>10){calibrationStatus(`校正不可：予測日時が現在から${ageMinutes.toFixed(1)}分ずれています。「現在」を押してください。`);return;}
  if(latestSun.altitude<=0){calibrationStatus('校正不可：現在の太陽が地平線の下です。');return;}
  // Solar calibration restores the existing compass-based heading model.
  northReference=null;
  // Start from zero offsets to measure the uncalibrated discrepancy.
  $('yawOffset').value='0';$('pitchOffset').value='0';
  const base=getBasis();
  if(!base){calibrationStatus('校正不可：姿勢を計算できません。');return;}
  const beforeAz=diff(latestSun.azimuth-bearing(base.forward));
  const beforeAlt=latestSun.altitude-altitude(base.forward);
  const yaw=Number((Math.round(beforeAz*2)/2).toFixed(1));
  // Rotation around screen-right can affect both elevation and azimuth when
  // device roll is present. This is a one-point approximation, not a full solve.
  const pitch=Number((Math.round(beforeAlt*2)/2).toFixed(1));
  // Never let HTML range controls silently clamp a requested calibration.
  const yawRange=$('yawOffset'), pitchRange=$('pitchOffset');
  if(yaw<Number(yawRange.min)||yaw>Number(yawRange.max)||pitch<Number(pitchRange.min)||pitch>Number(pitchRange.max)){
    refreshLabels();
    calibrationStatus(`校正失敗：必要補正 方位 ${fmt(beforeAz)} / 仰角 ${fmt(beforeAlt)} がスライダー範囲外です。`);
    return;
  }
  yawRange.value=String(yaw);pitchRange.value=String(pitch);
  refreshLabels();
  const corrected=getBasis();
  const afterAz=diff(latestSun.azimuth-bearing(corrected.forward));
  const afterAlt=latestSun.altitude-altitude(corrected.forward);
  calibrationStatus(`校正実行：補正前 方位差 ${fmt(beforeAz)} / 高度差 ${fmt(beforeAlt)} → 補正後 方位差 ${fmt(afterAz)} / 高度差 ${fmt(afterAlt)}。方位・高度の残差が大きければ姿勢モデルの追加修正が必要です。`);
}
$('start').addEventListener('click',start);$('stop').addEventListener('click',stop);$('locate').addEventListener('click',locate);
$('cameraSelect').addEventListener('change',e=>{for(const id of ['yawOffset','pitchOffset'])$(id).value='0';refreshLabels();openCamera(e.target.value);});
$('refreshCameras').addEventListener('click',refreshCameras);$('now').addEventListener('click',setNow);
$('dateTime').addEventListener('change',updateSun);
for(const id of ['yawOffset','pitchOffset','fovVertical'])$(id).addEventListener('input',refreshLabels);
$('centerSun').addEventListener('click',centerSun);
$('calibrateNorth').addEventListener('click',calibrateNorth);
$('resetCalibration').addEventListener('click',()=>{northReference=null;for(const id of ['yawOffset','pitchOffset'])$(id).value='0';$('fovVertical').value='55';refreshLabels();calibrationStatus('補正をリセットしました。');});
window.addEventListener('orientationchange',updateScreen);window.addEventListener('resize',drawAR);
$('camera').addEventListener('loadedmetadata',videoInfo);
updateScreen();setNow();refreshLabels();
