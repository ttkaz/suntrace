 'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? `${n.toFixed(1)}°` : '—';
let stream = null, geoPosition = null, heading = null, beta = null;
let selectedCameraId = '', starting = false, switching = false, attached = false, orientationReceived = false;
function message(s) { $('message').textContent = s; }
function reportError(prefix, e) { message(`${prefix}: ${e?.name || 'Error'} / ${e?.message || String(e)}`); }
window.addEventListener('error', e => message(`JSエラー: ${e.message} (行 ${e.lineno})`));
window.addEventListener('unhandledrejection', e => reportError('非同期エラー', e.reason));
function screenAngle() { return screen.orientation?.angle ?? window.orientation ?? 0; }
function updateScreen() { $('screen').textContent = `${screenAngle()}°`; }
function now() {
  const d = new Date();
  $('dateTime').value = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  updateSun();
}
function angleDifference(a) { return ((a+540)%360)-180; }
function updateSun() {
  const sun = geoPosition ? window.SunTraceSolar?.position(new Date($('dateTime').value),geoPosition.latitude,geoPosition.longitude) : null;
  $('sunAz').textContent = fmt(sun?.azimuth); $('sunAlt').textContent = fmt(sun?.altitude);
  // v0.4 is for field-of-view comparison: marker stays hidden until calibrated.
  $('sunMarker').hidden = true;
}
function onOrientation(e) {
  orientationReceived = true; $('status').textContent = 'センサー受信中';
  heading = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : null;
  beta = Number.isFinite(e.beta) ? e.beta : null;
  $('heading').textContent=fmt(heading); $('accuracy').textContent=fmt(e.webkitCompassAccuracy);
  $('beta').textContent=fmt(beta); $('other').textContent=`${fmt(e.alpha)} / ${fmt(e.gamma)}`;
}
function updateVideoInfo(requested = null) {
  const video=$('camera'), track=stream?.getVideoTracks()[0];
  if (!track) { $('cameraInfo').textContent='カメラ停止中'; return; }
  const settings=track.getSettings(), caps=track.getCapabilities?.() || {};
  $('trackLabel').textContent=track.label || '名称なし';
  if (requested!==null) $('requestedId').textContent=requested || 'デフォルト指定';
  $('actualId').textContent=settings.deviceId || 'API非公開';
  $('resolution').textContent=`${settings.width ?? '?'} × ${settings.height ?? '?'} px`;
  $('zoomInfo').textContent=`${settings.zoom ?? '不明'} / ${caps.zoom ? `${caps.zoom.min}〜${caps.zoom.max}` : '非公開'}`;
  $('videoInfo').textContent=`${video.videoWidth || '?'}×${video.videoHeight || '?'} / ${Math.round(video.clientWidth)}×${Math.round(video.clientHeight)}`;
  $('cameraInfo').textContent=`${track.label || '背面カメラ'}：映像は切り抜かず全体表示中（object-fit: contain）`;
}
async function refreshCameras() {
  try {
    const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
    const select=$('cameraSelect'), current=stream?.getVideoTracks()[0]?.getSettings().deviceId;
    select.replaceChildren();
    for (const [i,d] of devices.entries()) select.add(new Option(d.label || `カメラ ${i+1}`,d.deviceId));
    const matched=devices.find(d=>d.deviceId===current) || devices.find(d=>d.deviceId===selectedCameraId);
    if (matched) select.value=matched.deviceId;
    selectedCameraId=select.value;
    select.disabled=!stream || !devices.length;
    $('refreshCameras').disabled=!stream;
    updateVideoInfo();
    if (!devices.length) message('Safariからカメラ一覧を取得できませんでした。');
  } catch(e) { reportError('一覧取得失敗',e); }
}
async function openCamera(deviceId) {
  if (switching) return;
  switching=true; $('cameraSelect').disabled=true;
  const previous=stream;
  previous?.getTracks().forEach(t=>t.stop());
  stream=null; $('camera').srcObject=null;
  try {
    // Select exactly the requested device; no requested zoom, no crop constraints.
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:'environment'}}});
    $('camera').srcObject=stream;
    await $('camera').play();
    updateVideoInfo(deviceId);
    message('カメラ切替成功。同じ被写体・同じ位置で画角を比較してください。');
  } catch(e) {
    reportError('切替失敗',e);
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
      $('camera').srcObject=stream; await $('camera').play();
      updateVideoInfo('再起動: デフォルト');
      message(`指定カメラは起動できませんでした（${e.name}）。デフォルトに戻しました。`);
    } catch(e2) { reportError('カメラ復旧失敗',e2); }
  } finally {
    switching=false;
    await refreshCameras();
    updateVideoInfo();
  }
}
async function start() {
  if (starting) return;
  starting=true; $('start').disabled=true; $('status').textContent='起動中';
  let permission;
  try {
    permission=typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function' ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
  } catch(e) { permission=Promise.reject(e); }
  const result=await permission.catch(e=>`error: ${e.message}`);
  if (result==='granted' && !attached) { window.addEventListener('deviceorientation',onOrientation); attached=true; }
  if (result!=='granted') message(`姿勢センサーの権限: ${result}`);
  try {
    await openCamera('');
    $('stop').disabled=!stream;
    if (stream) $('status').textContent=result==='granted'?'カメラ起動・姿勢待ち':'カメラ起動';
  } catch(e) { reportError('起動失敗',e); }
  $('start').disabled=!!stream; starting=false;
  if(result==='granted') setTimeout(()=>{if(!orientationReceived)message('姿勢データ未受信。Safariの許可を確認してください。');},3500);
}
function stop() {
  if(attached) { window.removeEventListener('deviceorientation',onOrientation);attached=false; }
  stream?.getTracks().forEach(t=>t.stop());stream=null; $('camera').srcObject=null;
  $('start').disabled=false; $('stop').disabled=true; $('cameraSelect').disabled=true; $('refreshCameras').disabled=true;
  $('status').textContent='停止'; heading=beta=null;orientationReceived=false; updateVideoInfo(); message('停止しました。');
}
function locate() {
  if(!navigator.geolocation){ message('GPS APIが利用できません');return; }
  $('locate').disabled=true;message('GPS取得中…');
  navigator.geolocation.getCurrentPosition(p=>{
    geoPosition={latitude:p.coords.latitude,longitude:p.coords.longitude};
    $('coords').textContent=`${geoPosition.latitude.toFixed(5)}, ${geoPosition.longitude.toFixed(5)}`;
    $('gpsAccuracy').textContent=`推定精度 ±${Math.round(p.coords.accuracy)}m`;
    $('locate').disabled=false;message('GPS取得成功。');updateSun();
  },e=>{$('locate').disabled=false;message(`GPSエラー (${e.code}): ${e.message}`);},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
$('start').addEventListener('click',start);
$('stop').addEventListener('click',stop);
$('locate').addEventListener('click',locate);
$('cameraSelect').addEventListener('change',e=>openCamera(e.target.value));
$('refreshCameras').addEventListener('click',refreshCameras);
$('now').addEventListener('click',now);
$('dateTime').addEventListener('change',updateSun);
for(const id of ['azOffset','altOffset']) $(id).addEventListener('input',()=>{$(id+'Value').textContent=`${$(id).value}°`;updateSun();});
$('resetOffset').addEventListener('click',()=>{for(const id of ['azOffset','altOffset']){$(id).value=0;$(id+'Value').textContent='0°';}updateSun();});
window.addEventListener('orientationchange',updateScreen);
window.addEventListener('resize',()=>updateVideoInfo());
$('camera').addEventListener('loadedmetadata',()=>updateVideoInfo());
updateScreen();now();
