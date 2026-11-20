'use strict';
const $ = id => document.getElementById(id);
let stream = null;
let receivingOrientation = false;
let orientationWatchdog = null;
const fmt = value => Number.isFinite(value) ? `${value.toFixed(1)}°` : '—';
const message = text => { $('message').textContent = text; };
function onOrientation(e) {
  receivingOrientation = true;
  $('status').textContent = 'センサー受信中';
  const heading = Number.isFinite(e.webkitCompassHeading) ? e.webkitCompassHeading : null;
  $('heading').textContent = fmt(heading);
  $('accuracy').textContent = `精度: ${fmt(e.webkitCompassAccuracy)}`;
  $('alpha').textContent = fmt(e.alpha);
  $('beta').textContent = fmt(e.beta);
  $('gamma').textContent = fmt(e.gamma);
  // alpha is not converted to north-up heading: its reference frame differs by browser.
}
function updateScreen() {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  $('screen').textContent = `画面回転: ${angle}°`;
}
function stop() {
  window.removeEventListener('deviceorientation', onOrientation);
  window.removeEventListener('deviceorientationabsolute', onOrientation);
  clearTimeout(orientationWatchdog);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $('camera').srcObject = null;
  $('start').disabled = false;
  $('stop').disabled = true;
  $('status').textContent = '停止';
  receivingOrientation = false;
  message('停止しました。');
}
async function start() {
  $('start').disabled = true;
  $('status').textContent = '権限確認中';
  // Must be called synchronously as part of the button's user gesture,
  // before any await (including the camera permission request).
  let orientationPermission;
  try {
    orientationPermission = (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function')
      ? DeviceOrientationEvent.requestPermission()
      : Promise.resolve('granted');
  } catch (e) {
    orientationPermission = Promise.reject(e);
  }
  const permission = await orientationPermission.catch(e => `error: ${e.message}`);
  if (permission === 'granted') {
    window.addEventListener('deviceorientation', onOrientation);
  } else {
    message(`姿勢センサーの許可がありません: ${permission}`);
  }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('カメラAPIが利用できません。HTTPSとSafariを確認してください。');
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    $('camera').srcObject = stream;
    await $('camera').play();
    $('status').textContent = permission === 'granted' ? 'カメラ起動・センサー待ち' : 'カメラのみ起動';
    if (permission === 'granted') message('iPhoneを動かし、数値の変化を確認してください。');
  } catch (e) {
    $('status').textContent = 'カメラ起動失敗';
    message(`カメラ: ${e.name || 'Error'} / ${e.message}`);
  }
  $('stop').disabled = false;
  if (permission === 'granted') {
    orientationWatchdog = setTimeout(() => {
      if (!receivingOrientation) message('姿勢データが届いていません。Safariの設定・端末の対応状況を確認してください。');
    }, 3000);
  }
}
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
window.addEventListener('orientationchange', updateScreen);
updateScreen();
