'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? `${n.toFixed(1)}°` : '—';
let stream=null, receiving=false, watchdog=null, geoPosition=null, heading=null, beta=null;
const message = s => $('message').textContent=s;
function updateScreen(){ $('screen').textContent=`${screen.orientation?.angle ?? window.orientation ?? 0}°`; }
function setNow(){
  const d=new Date(); const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  $('dateTime').value=local.toISOString().slice(0,16); updateSun();
}
function shortestAngle(a){return ((a+540)%360)-180;}
function updateMarker(sun){
  const marker=$('sunMarker'), warning=$('offscreen');
  marker.hidden=true;warning.textContent='';
  if (!sun || heading===null || beta===null || sun.altitude<0) return;
  // EXPERIMENTAL ONLY: compass heading is not camera-axis heading; beta to camera
  // elevation varies by device orientation. FOV is an unmeasured approximation.
  const angle=screen.orientation?.angle ?? window.orientation ?? 0;
  if(angle!==0){warning.textContent='AR仮表示は縦向きのみ';return;}
  const view=$('view').getBoundingClientRect();
  const relativeAz=shortestAngle(sun.azimuth-heading-Number($('azOffset').value));
  const cameraAltitude=beta-90+Number($('altOffset').value);
  const relativeAlt=sun.altitude-cameraAltitude;
  const x=view.width/2+(relativeAz/60)*view.width;
  const y=view.height/2-(relativeAlt/75)*view.height;
  if(x<0||x>view.width||y<0||y>view.height){
    warning.textContent=`太陽は画面外（水平差 ${fmt(relativeAz)} / 高度差 ${fmt(relativeAlt)}）`;
    return;
  }
  marker.style.left=`${x}px`;marker.style.top=`${y}px`;marker.hidden=false;
}
function updateSun(){
  if(!geoPosition){$('sunAz').textContent='—';$('sunAlt').textContent='—';updateMarker(null);return;}
  const date=new Date($('dateTime').value);
  const sun=window.SunTraceSolar.position(date,geoPosition.latitude,geoPosition.longitude);
  $('sunAz').textContent=fmt(sun?.azimuth);
  $('sunAlt').textContent=fmt(sun?.altitude);
  updateMarker(sun);
}
function onOrientation(e){
  receiving=true;$('status').textContent='センサー受信中';
  heading=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:null;
  beta=Number.isFinite(e.beta)?e.beta:null;
  $('heading').textContent=fmt(heading);
  $('accuracy').textContent=`精度: ${fmt(e.webkitCompassAccuracy)}`;
  $('beta').textContent=fmt(beta);
  $('other').textContent=`${fmt(e.alpha)} / ${fmt(e.gamma)}`;
  updateSun();
}
function stop(){
  window.removeEventListener('deviceorientation',onOrientation);
  clearTimeout(watchdog);stream?.getTracks().forEach(t=>t.stop());stream=null;
  $('camera').srcObject=null;$('start').disabled=false;$('stop').disabled=true;
  receiving=false;heading=null;beta=null;$('status').textContent='停止';updateSun();message('停止しました。');
}
async function start(){
  $('start').disabled=true;$('status').textContent='権限確認中';
  let permissionPromise;
  try{
    permissionPromise=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'
      ?DeviceOrientationEvent.requestPermission():Promise.resolve('granted');
  }catch(e){permissionPromise=Promise.reject(e);}
  const perm=await permissionPromise.catch(e=>`error: ${e.message}`);
  if(perm==='granted')window.addEventListener('deviceorientation',onOrientation);
  else message(`姿勢センサー: ${perm}`);
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('カメラAPIが使えません。HTTPSを確認してください。');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    $('camera').srcObject=stream;await $('camera').play();
    $('status').textContent=perm==='granted'?'カメラ起動・センサー待ち':'カメラのみ起動';
    if(perm==='granted')message('カメラ・姿勢取得を開始しました。次に位置情報を取得してください。');
  }catch(e){$('status').textContent='カメラ起動失敗';message(`カメラ: ${e.message}`);}
  $('stop').disabled=false;
  if(perm==='granted')watchdog=setTimeout(()=>{if(!receiving)message('姿勢センサーが未受信です。Safariで開いて許可を確認してください。');},3500);
}
function locate(){
  if(!navigator.geolocation){message('位置情報APIが利用できません。');return;}
  $('locate').disabled=true;message('位置情報を取得しています…');
  navigator.geolocation.getCurrentPosition(pos=>{
    geoPosition={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
    $('coords').textContent=`${geoPosition.latitude.toFixed(5)}, ${geoPosition.longitude.toFixed(5)}`;
    $('gpsAccuracy').textContent=`位置精度（推定）: ±${Math.round(pos.coords.accuracy)}m`;
    $('locate').disabled=false;message('位置情報を取得しました。日時を変えて太陽方位・高度を確認できます。');updateSun();
  },err=>{$('locate').disabled=false;message(`位置情報エラー（${err.code}）: ${err.message}`);},
  {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
$('start').addEventListener('click',start);
$('stop').addEventListener('click',stop);
$('locate').addEventListener('click',locate);
$('now').addEventListener('click',setNow);
$('dateTime').addEventListener('change',updateSun);
for(const id of ['azOffset','altOffset'])$(id).addEventListener('input',()=>{$(id+'Value').textContent=`${$(id).value}°`;updateSun();});
$('resetOffset').addEventListener('click',()=>{for(const id of ['azOffset','altOffset']){$(id).value=0;$(id+'Value').textContent='0°';}updateSun();});
window.addEventListener('orientationchange',()=>{updateScreen();updateSun();});
window.addEventListener('resize',updateSun);
updateScreen();setNow();
