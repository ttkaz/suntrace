'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? `${n.toFixed(1)}°` : '—';
let stream = null, geoPosition = null, heading = null, beta = null, orientationReceived = false;
let cameraDevices = [], selectedCameraId = '', orientationListenerAttached = false, pendingCameraSwitch = false;
function message(s) { $('message').textContent = s; }
function reportError(prefix, e) { message(`${prefix}: ${e?.name || 'Error'} / ${e?.message || e}`); }
window.addEventListener('error', e => message(`JSエラー: ${e.message} (${e.lineno})`));
window.addEventListener('unhandledrejection', e => reportError('非同期エラー', e.reason));
const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;
function updateScreen() { $('screen').textContent = `${screenAngle()}°`; }
function setNow() {
  const d = new Date();
  $('dateTime').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  updateSun();
}
function shortestAngle(a) { return ((a + 540) % 360) - 180; }
function updateMarker(sun) {
  const marker = $('sunMarker'), warning = $('offscreen');
  marker.hidden = true; warning.textContent = '';
  if (!sun || heading === null || beta === null || sun.altitude < 0) return;
  if (screenAngle() !== 0) { warning.textContent = 'AR仮表示は縦向きのみ'; return; }
  // Provisional only: orientation-to-camera transform and actual field of view NOT calibrated.
  const box = $('view').getBoundingClientRect();
  const relAz = shortestAngle(sun.azimuth - heading - Number($('azOffset').value));
  const relAlt = sun.altitude - (beta - 90 + Number($('altOffset').value));
  const x = box.width / 2 + (relAz / 60) * box.width;
  const y = box.height / 2 - (relAlt / 75) * box.height;
  if (x < 0 || x > box.width || y < 0 || y > box.height) {
    warning.textContent = `太陽は画面外（方位差 ${fmt(relAz)} / 高度差 ${fmt(relAlt)}）`;
    return;
  }
  marker.style.left = `${x}px`; marker.style.top = `${y}px`; marker.hidden = false;
}
function updateSun() {
  if (!geoPosition) { $('sunAz').textContent = '—'; $('sunAlt').textContent = '—'; updateMarker(null); return; }
  const solar = window.SunTraceSolar?.position(new Date($('dateTime').value), geoPosition.latitude, geoPosition.longitude);
  $('sunAz').textContent = fmt(solar?.azimuth);
  $('sunAlt').textContent = fmt(solar?.altitude);
  updateMarker(solar);
}
function onOrientation(e) {
  orientationReceived = true;
  $('status').textContent = 'センサー受信中';
  heading = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : null;
  beta = Number.isFinite(e.beta) ? e.beta : null;
  $('heading').textContent = fmt(heading);
  $('accuracy').textContent = fmt(e.webkitCompassAccuracy);
  $('beta').textContent = fmt(beta);
  $('other').textContent = `${fmt(e.alpha)} / ${fmt(e.gamma)}`;
  updateSun();
}
function updateVideoInfo() {
  const track = stream?.getVideoTracks()[0];
  if (!track) { $('cameraInfo').textContent = 'カメラ停止中'; return; }
  const settings = track.getSettings();
  const capabilities = track.getCapabilities?.() || {};
  const zoom = capabilities.zoom ? ` / zoom対応: ${capabilities.zoom.min}〜${capabilities.zoom.max} (現在 ${settings.zoom ?? '不明'})` : ' / zoom API公開なし';
  $('cameraInfo').textContent = `${track.label || '背面カメラ'} / ${settings.width ?? '?'}×${settings.height ?? '?'}${zoom}`;
  $('resolution').textContent = `${$('camera').videoWidth || settings.width || '?'}×${$('camera').videoHeight || settings.height || '?'}`;
}
async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    cameraDevices = all.filter(d => d.kind === 'videoinput');
    const select = $('cameraSelect'); select.replaceChildren();
    if (!cameraDevices.length) {
      select.add(new Option('カメラが見つかりません', '')); select.disabled = true; return;
    }
    cameraDevices.forEach((d, i) => select.add(new Option(d.label || `カメラ ${i + 1}`, d.deviceId)));
    const activeId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const matched = cameraDevices.find(d => d.deviceId === activeId) || cameraDevices.find(d => d.deviceId === selectedCameraId);
    if (matched) select.value = matched.deviceId;
    selectedCameraId = select.value;
    select.disabled = !stream;
    $('refreshCameras').disabled = !stream;
    updateVideoInfo();
  } catch (e) { reportError('カメラ列挙失敗', e); }
}
async function switchCamera(deviceId) {
  if (pendingCameraSwitch) return;
  pendingCameraSwitch = true;
  $('cameraSelect').disabled = true;
  const previous = stream;
  // iOS Safari may refuse a second camera stream while the first is running.
  previous?.getTracks().forEach(t => t.stop());
  stream = null;
  $('camera').srcObject = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: deviceId ? {deviceId: {exact: deviceId}} : {facingMode: {ideal: 'environment'}}, audio: false});
    $('camera').srcObject = stream;
    await $('camera').play();
    selectedCameraId = deviceId || stream.getVideoTracks()[0].getSettings().deviceId || '';
    message('カメラを切り替えました。画角の変化を実映像で確認してください。');
  } catch (e) {
    reportError('カメラ切替失敗', e);
    try {
      stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
      $('camera').srcObject = stream; await $('camera').play();
      message(`指定カメラの起動失敗 (${e.name})。標準の背面カメラに戻しました。`);
    } catch (fallbackError) { reportError('カメラ復旧失敗', fallbackError); }
  } finally {
    pendingCameraSwitch = false;
    await refreshCameras(); updateVideoInfo();
  }
}
async function start() {
  $('start').disabled = true;
  $('status').textContent = '権限確認中';
  // Permission request must be issued directly within click handler, before awaiting camera.
  let permission;
  try {
    permission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
  } catch (e) { permission = Promise.reject(e); }
  const result = await permission.catch(e => `error: ${e.message}`);
  if (result === 'granted' && !orientationListenerAttached) {
    window.addEventListener('deviceorientation', onOrientation); orientationListenerAttached = true;
  }
  if (result !== 'granted') message(`姿勢センサーの権限: ${result}`);
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS / カメラAPIを確認してください');
    await switchCamera('');
    if (stream) {
      $('stop').disabled = false;
      $('refreshCameras').disabled = false;
      if (result === 'granted') message('カメラ・姿勢センサー起動。カメラ一覧から切り替えてください。');
    } else { $('start').disabled = false; }
  } catch (e) { reportError('起動失敗', e); $('start').disabled = false; }
  if (result === 'granted') setTimeout(() => { if (!orientationReceived) message('姿勢データ未受信。Safariのセンサー許可を確認してください。'); }, 3500);
}
function stop() {
  if (orientationListenerAttached) { window.removeEventListener('deviceorientation', onOrientation); orientationListenerAttached = false; }
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  $('camera').srcObject = null;
  $('start').disabled = false; $('stop').disabled = true;
  $('cameraSelect').disabled = true; $('refreshCameras').disabled = true;
  $('status').textContent = '停止'; heading = beta = null; orientationReceived = false;
  updateMarker(null); message('停止しました。');
}
function locate() {
  if (!navigator.geolocation) { message('位置情報APIが利用できません'); return; }
  $('locate').disabled = true; message('位置情報を取得しています…');
  navigator.geolocation.getCurrentPosition(p => {
    geoPosition = {latitude: p.coords.latitude, longitude: p.coords.longitude};
    $('coords').textContent = `${geoPosition.latitude.toFixed(5)}, ${geoPosition.longitude.toFixed(5)}`;
    $('gpsAccuracy').textContent = `推定精度 ±${Math.round(p.coords.accuracy)}m`;
    $('locate').disabled = false; message('GPS取得成功。日時と太陽位置を確認できます。'); updateSun();
  }, e => { $('locate').disabled = false; message(`GPSエラー (${e.code}): ${e.message}`); },
  {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('locate').addEventListener('click', locate);
$('now').addEventListener('click', setNow);
$('cameraSelect').addEventListener('change', e => switchCamera(e.target.value));
$('refreshCameras').addEventListener('click', refreshCameras);
$('dateTime').addEventListener('change', updateSun);
for (const id of ['azOffset','altOffset']) $(id).addEventListener('input', () => { $(id+'Value').textContent = `${$(id).value}°`; updateSun(); });
$('resetOffset').addEventListener('click', () => { for (const id of ['azOffset','altOffset']) { $(id).value = 0; $(id+'Value').textContent = '0°'; } updateSun(); });
window.addEventListener('orientationchange', () => { updateScreen(); updateSun(); });
window.addEventListener('resize', updateSun);
$('camera').addEventListener('loadedmetadata', updateVideoInfo);
updateScreen(); setNow();
