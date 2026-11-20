'use strict';
const $ = id => document.getElementById(id);
const DEG=Math.PI/180;
const fmt=n=>Number.isFinite(n)?`${n.toFixed(1)}°`:'—';
const wrap=a=>(a%360+360)%360;
const diff=a=>((a+540)%360)-180;
let stream=null, geoPosition=null, orient=null, compassAccuracy=null;
let starting=false,switching=false,attached=false,selectedCameraId='';
let latestSun=null;
let exposureOriginal=null, exposureDimmed=false;
function exposureTrack(){return stream?.getVideoTracks()[0]||null;}
function updateExposureInfo(){
  const track=exposureTrack();
  let c={};try{c=track?.getCapabilities?.()||{};}catch(_e){}
  const range=c.exposureCompensation;
  const available=!!range&&Number.isFinite(range.min)&&Number.isFinite(range.max)&&range.min<0;
  $('dimExposure').disabled=!available;
  $('dimExposure').textContent=exposureDimmed?'露出を元に戻す':'校正用に露出を下げる';
  $('exposureSupport').textContent=!track?'カメラ停止中':available?
    `露出補正対応：${range.min}〜${range.max} EV`:'このカメラ／ブラウザでは露出補正API非対応';
}
async function toggleExposure(){
  const track=exposureTrack();if(!track)return;
  const cap=track.getCapabilities?.().exposureCompensation;
  if(!cap)return;
  try{
    if(!exposureDimmed){
      exposureOriginal=track.getSettings().exposureCompensation;
      const target=Math.max(cap.min,Math.min(cap.max,-2));
      await track.applyConstraints({advanced:[{exposureCompensation:target}]});
      exposureDimmed=true;
      message(`露出補正を${target} EVに設定しました。太陽を長時間直視しないでください。`);
    }else{
      const target=Number.isFinite(exposureOriginal)?exposureOriginal:0;
      await track.applyConstraints({advanced:[{exposureCompensation:target}]});
      exposureDimmed=false;message('露出を元に戻しました。');
    }
  }catch(e){fail('露出変更不可',e);}
  updateExposureInfo();
}
// Experimental: relative north heading; deviceorientation alpha can still be magnetically corrected.
let northReference=null;
function message(s){$('message').textContent=s;}
function fail(prefix,e){message(`${prefix}: ${e?.name||'Error'} / ${e?.message||String(e)}`);}
window.addEventListener('error',e=>message(`JSエラー: ${e.message} (${e.lineno})`));
window.addEventListener('unhandledrejection',e=>fail('非同期エラー',e.reason));
const screenAngle=()=>screen.orientation?.angle??window.orientation??0;
function updateScreen(){$('screen').textContent=`${screenAngle()}°`;drawAR();}
function localDateTimeValue(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function setNow(){setTargetDateTime(new Date());}
function setTargetDateTime(d){
  $('dateTime').value=localDateTimeValue(d);
  $('targetDate').value=$('dateTime').value.slice(0,10);
  updateSun();
}
function selectDay(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;
  const current=$('dateTime').value;
  const time=current&&current.length>=16?current.slice(11,16):'12:00';
  $('dateTime').value=`${value}T${time}`;
  updateSun();
}
function chooseSeason(month,day){
  const current=$('targetDate').value||localDateTimeValue(new Date()).slice(0,10);
  const year=Number(current.slice(0,4));
  selectDay(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
}
function targetLabel(){
  const iso=$('targetDate').value||'';
  const md=iso.slice(5);
  const season={'03-20':'春分頃','06-21':'夏至頃','09-23':'秋分頃','12-22':'冬至頃'}[md];
  return iso+(season?`（${season}）`:'');
}
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
  $('sunAz').textContent=fmt(latestSun?.azimuth);$('sunAlt').textContent=fmt(latestSun?.altitude);$('targetDate').value=$('dateTime').value.slice(0,10);drawAR();
}
let lastDraw=0;
const NS='http://www.w3.org/2000/svg';
function svgEl(tag,attributes){
  const el=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attributes))el.setAttribute(k,String(v));
  return el;
}
function drawAR(){
  const svg=$('arOverlay'),circle=$('sunCircle'),paths=$('pathSegments'),labels=$('hourLabels'),stage=$('stage');
  const w=stage.clientWidth,h=stage.clientHeight;
  if(w<=0||h<=0)return;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  circle.setAttribute('visibility','hidden');paths.replaceChildren();labels.replaceChildren();
  const basis=getBasis(),rect=displayRect();
  $('cameraAz').textContent=basis?fmt(bearing(basis.forward)):'—';
  $('headingSource').textContent=northReference===null?'コンパス基準':'真北登録基準';
  $('cameraAlt').textContent=basis?fmt(altitude(basis.forward)):'—';
  $('imageRect').textContent=rect?`${Math.round(rect.w)}×${Math.round(rect.h)} / x=${Math.round(rect.x)}, y=${Math.round(rect.y)}`:'—';
  if(!basis||!rect||!latestSun){$('viewHint').textContent='GPS・姿勢・カメラ映像の取得待ち（縦向きのみ）';return;}
  const inside=p=>p&&p.x>=rect.x&&p.x<=rect.x+rect.w&&p.y>=rect.y&&p.y<=rect.y+rect.h;
  const p=project(latestSun,basis,rect);
  if(inside(p)&&latestSun.altitude>0){circle.setAttribute('cx',p.x);circle.setAttribute('cy',p.y);circle.setAttribute('visibility','visible');}
  const date=new Date($('dateTime').value);
  if(!Number.isFinite(date.getTime()))return;
  date.setHours(0,0,0,0);
  let prev=null;
  for(let minute=0;minute<=1440;minute+=5){
    const solar=window.SunTraceSolar.position(new Date(date.getTime()+minute*60000),geoPosition.latitude,geoPosition.longitude);
    const point=solar?.altitude>0?project(solar,basis,rect):null;
    const visible=inside(point);
    if(visible&&prev){
      // Hour changes are independent of clipping and cannot connect across gaps.
      const hour=Math.floor((minute-1)/60);
      const segment=svgEl('path',{
        d:`M${prev.x.toFixed(2)} ${prev.y.toFixed(2)} L${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        'stroke-width':3.2,'stroke-linecap':'round',fill:'none'
      });
      segment.style.stroke=hour%2?'#ff9b38':'#ffe16a';
      paths.append(segment);
    }
    // Hour markers at the hour, including a halo around readable text.
    if(minute%60===0&&visible&&minute<1440){
      const hour=minute/60;
      labels.append(svgEl('circle',{cx:point.x,cy:point.y,r:3.6,fill:'#ffffff',stroke:'#684c18','stroke-width':1.4}));
      const anchor=point.x<rect.x+45?'start':point.x>rect.x+rect.w-45?'end':'middle';
      const tx=anchor==='start'?point.x+4:anchor==='end'?point.x-4:point.x;
      const ty=point.y<rect.y+24?point.y+19:point.y-9;
      const t=svgEl('text',{x:tx,y:ty,'text-anchor':anchor,fill:'white','font-size':12,
        'font-weight':'bold',stroke:'#24363c','stroke-width':3.5,'paint-order':'stroke',
        'stroke-linejoin':'round'});
      t.textContent=`${hour}:00`;labels.append(t);
    }
    prev=visible?point:null;
  }
  $('viewHint').textContent=`対象 ${targetLabel()} / 1時間ごとに色分け`;
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
  updateExposureInfo();drawAR();
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
  exposureDimmed=false;exposureOriginal=null;
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
  exposureDimmed=false;exposureOriginal=null;updateExposureInfo();
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

let previewObjectUrl=null;
async function savePhoto(){
  const video=$('camera'),rect=displayRect(),basis=getBasis();
  if(!stream||!rect||!basis||!geoPosition){message('撮影にはカメラ・GPS・姿勢情報が必要です。');return;}
  if(!video.videoWidth||!video.videoHeight){message('カメラ画像の準備中です。');return;}
  drawAR();
  // Save only the actual camera image, not the letterboxed preview stage.
  const stage=$('stage');
  const W=video.videoWidth,H=video.videoHeight;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  // Convert stage coordinates to camera-image coordinates consistently
  // for both the live frame and the SVG sun path / hour labels.
  const sx=W/rect.w,sy=H/rect.h;
  ctx.setTransform(sx,0,0,sy,-rect.x*sx,-rect.y*sy);
  ctx.drawImage(video,rect.x,rect.y,rect.w,rect.h);
  // Native SVG serialisation preserves the exact AR overlay rendering.
  const svgCopy=$('arOverlay').cloneNode(true);
  svgCopy.setAttribute('xmlns',NS);
  svgCopy.setAttribute('width',String(stage.clientWidth));
  svgCopy.setAttribute('height',String(stage.clientHeight));
  const markup=new XMLSerializer().serializeToString(svgCopy);
  const blob=new Blob([markup],{type:'image/svg+xml;charset=utf-8'});
  const svgUrl=URL.createObjectURL(blob);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=svgUrl;});
    ctx.drawImage(img,0,0,stage.clientWidth,stage.clientHeight);
  }catch(e){message('AR合成に失敗しました。画像は保存していません。');return;}
  finally{URL.revokeObjectURL(svgUrl);}
  // Labels use camera pixel coordinates rather than stage coordinates.
  ctx.setTransform(1,0,0,1,0,0);
  // Add the modeled target date and actual capture date, without embedding GPS.
  const label=`対象 ${targetLabel()}`;
  const taken=`撮影 ${localDateTimeValue(new Date()).replace('T',' ')}`;
  const fs=Math.max(14,Math.round(W/30)),small=Math.max(11,Math.round(fs*.8));
  const pad=Math.max(7,Math.round(W*.018)),gap=Math.max(5,Math.round(fs*.4));
  ctx.font=`bold ${fs}px -apple-system, sans-serif`;
  const titleWidth=ctx.measureText(label).width;
  ctx.font=`${small}px -apple-system, sans-serif`;
  const takenWidth=ctx.measureText(taken).width;
  const boxWidth=Math.min(W-2*pad,Math.max(titleWidth,takenWidth)+3*pad);
  const boxHeight=fs+small+gap+2*pad;
  ctx.fillStyle='rgba(8,28,35,.84)';ctx.fillRect(pad,pad,boxWidth,boxHeight);
  ctx.fillStyle='#fff';ctx.font=`bold ${fs}px -apple-system, sans-serif`;
  ctx.fillText(label,pad*2,pad*2+fs,boxWidth-2*pad);
  ctx.font=`${small}px -apple-system, sans-serif`;ctx.fillStyle='#e3e9eb';
  ctx.fillText(taken,pad*2,pad*2+fs+gap+small,boxWidth-2*pad);
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!png){message('PNG生成に失敗しました。');return;}
  if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl=URL.createObjectURL(png);
  $('photoPreview').src=previewObjectUrl;
  const filename=`SunTrace_${$('targetDate').value}_${localDateTimeValue(new Date()).slice(0,10)}.png`;
  $('photoDownload').href=previewObjectUrl;$('photoDownload').download=filename;
  $('photoResult').hidden=false;
  message('画像を生成しました。共有するか、画像を長押しして「写真に保存」を選んでください。');
  const file=new File([png],filename,{type:'image/png'});
  try{
    if(navigator.canShare?.({files:[file]})){
      await navigator.share({files:[file],title:`SunTrace ${targetLabel()}`});
    }
  }catch(e){if(e.name!=='AbortError')fail('共有',e);}
}
$('start').addEventListener('click',start);$('stop').addEventListener('click',stop);$('locate').addEventListener('click',locate);
$('cameraSelect').addEventListener('change',e=>{for(const id of ['yawOffset','pitchOffset'])$(id).value='0';refreshLabels();openCamera(e.target.value);});
$('refreshCameras').addEventListener('click',refreshCameras);$('now').addEventListener('click',setNow);
$('targetDate').addEventListener('change',e=>selectDay(e.target.value));
for(const b of document.querySelectorAll('[data-season]'))b.addEventListener('click',()=>{
  const [m,d]=b.dataset.season.split('-').map(Number);chooseSeason(m,d);
});
$('savePhoto').addEventListener('click',savePhoto);
$('dimExposure').addEventListener('click',toggleExposure);
$('dateTime').addEventListener('change',updateSun);
for(const id of ['yawOffset','pitchOffset','fovVertical'])$(id).addEventListener('input',refreshLabels);
$('centerSun').addEventListener('click',centerSun);
$('calibrateNorth').addEventListener('click',calibrateNorth);
$('resetCalibration').addEventListener('click',()=>{northReference=null;for(const id of ['yawOffset','pitchOffset'])$(id).value='0';$('fovVertical').value='55';refreshLabels();calibrationStatus('補正をリセットしました。');});
window.addEventListener('orientationchange',updateScreen);window.addEventListener('resize',drawAR);
$('camera').addEventListener('loadedmetadata',videoInfo);
updateScreen();setNow();refreshLabels();
