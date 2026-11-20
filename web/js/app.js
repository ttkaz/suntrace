'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? `${n.toFixed(1)}ﾂｰ` : '窶・;
let stream=null, receiving=false, watchdog=null, geoPosition=null, heading=null, beta=null;
const message = s => $('message').textContent=s;
function updateScreen(){ $('screen').textContent=`${screen.orientation?.angle ?? window.orientation ?? 0}ﾂｰ`; }
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
  if(angle!==0){warning.textContent='AR莉ｮ陦ｨ遉ｺ縺ｯ邵ｦ蜷代″縺ｮ縺ｿ';return;}
  const view=$('view').getBoundingClientRect();
  const relativeAz=shortestAngle(sun.azimuth-heading-Number($('azOffset').value));
  const cameraAltitude=beta-90+Number($('altOffset').value);
  const relativeAlt=sun.altitude-cameraAltitude;
  const x=view.width/2+(relativeAz/60)*view.width;
  const y=view.height/2-(relativeAlt/75)*view.height;
  if(x<0||x>view.width||y<0||y>view.height){
    warning.textContent=`螟ｪ髯ｽ縺ｯ逕ｻ髱｢螟厄ｼ域ｰｴ蟷ｳ蟾ｮ ${fmt(relativeAz)} / 鬮伜ｺｦ蟾ｮ ${fmt(relativeAlt)}・荏;
    return;
  }
  marker.style.left=`${x}px`;marker.style.top=`${y}px`;marker.hidden=false;
}
function updateSun(){
  if(!geoPosition){$('sunAz').textContent='窶・;$('sunAlt').textContent='窶・;updateMarker(null);return;}
  const date=new Date($('dateTime').value);
  const sun=window.SunTraceSolar.position(date,geoPosition.latitude,geoPosition.longitude);
  $('sunAz').textContent=fmt(sun?.azimuth);
  $('sunAlt').textContent=fmt(sun?.altitude);
  updateMarker(sun);
}
function onOrientation(e){
  receiving=true;$('status').textContent='繧ｻ繝ｳ繧ｵ繝ｼ蜿嶺ｿ｡荳ｭ';
  heading=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:null;
  beta=Number.isFinite(e.beta)?e.beta:null;
  $('heading').textContent=fmt(heading);
  $('accuracy').textContent=`邊ｾ蠎ｦ: ${fmt(e.webkitCompassAccuracy)}`;
  $('beta').textContent=fmt(beta);
  $('other').textContent=`${fmt(e.alpha)} / ${fmt(e.gamma)}`;
  updateSun();
}
function stop(){
  window.removeEventListener('deviceorientation',onOrientation);
  clearTimeout(watchdog);stream?.getTracks().forEach(t=>t.stop());stream=null;
  $('camera').srcObject=null;$('start').disabled=false;$('stop').disabled=true;
  receiving=false;heading=null;beta=null;$('status').textContent='蛛懈ｭ｢';updateSun();message('蛛懈ｭ｢縺励∪縺励◆縲・);
}
async function start(){
  $('start').disabled=true;$('status').textContent='讓ｩ髯千｢ｺ隱堺ｸｭ';
  let permissionPromise;
  try{
    permissionPromise=typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'
      ?DeviceOrientationEvent.requestPermission():Promise.resolve('granted');
  }catch(e){permissionPromise=Promise.reject(e);}
  const perm=await permissionPromise.catch(e=>`error: ${e.message}`);
  if(perm==='granted')window.addEventListener('deviceorientation',onOrientation);
  else message(`蟋ｿ蜍｢繧ｻ繝ｳ繧ｵ繝ｼ: ${perm}`);
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('繧ｫ繝｡繝ｩAPI縺御ｽｿ縺医∪縺帙ｓ縲・TTPS繧堤｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲・);
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
    $('camera').srcObject=stream;await $('camera').play();
    $('status').textContent=perm==='granted'?'繧ｫ繝｡繝ｩ襍ｷ蜍輔・繧ｻ繝ｳ繧ｵ繝ｼ蠕・■':'繧ｫ繝｡繝ｩ縺ｮ縺ｿ襍ｷ蜍・;
    if(perm==='granted')message('繧ｫ繝｡繝ｩ繝ｻ蟋ｿ蜍｢蜿門ｾ励ｒ髢句ｧ九＠縺ｾ縺励◆縲よｬ｡縺ｫ菴咲ｽｮ諠・ｱ繧貞叙蠕励＠縺ｦ縺上□縺輔＞縲・);
  }catch(e){$('status').textContent='繧ｫ繝｡繝ｩ襍ｷ蜍募､ｱ謨・;message(`繧ｫ繝｡繝ｩ: ${e.message}`);}
  $('stop').disabled=false;
  if(perm==='granted')watchdog=setTimeout(()=>{if(!receiving)message('蟋ｿ蜍｢繧ｻ繝ｳ繧ｵ繝ｼ縺梧悴蜿嶺ｿ｡縺ｧ縺吶４afari縺ｧ髢九＞縺ｦ險ｱ蜿ｯ繧堤｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲・);},3500);
}
function locate(){
  if(!navigator.geolocation){message('菴咲ｽｮ諠・ｱAPI縺悟茜逕ｨ縺ｧ縺阪∪縺帙ｓ縲・);return;}
  $('locate').disabled=true;message('菴咲ｽｮ諠・ｱ繧貞叙蠕励＠縺ｦ縺・∪縺吮ｦ');
  navigator.geolocation.getCurrentPosition(pos=>{
    geoPosition={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
    $('coords').textContent=`${geoPosition.latitude.toFixed(5)}, ${geoPosition.longitude.toFixed(5)}`;
    $('gpsAccuracy').textContent=`菴咲ｽｮ邊ｾ蠎ｦ・域耳螳夲ｼ・ ﾂｱ${Math.round(pos.coords.accuracy)}m`;
    $('locate').disabled=false;message('菴咲ｽｮ諠・ｱ繧貞叙蠕励＠縺ｾ縺励◆縲よ律譎ゅｒ螟峨∴縺ｦ螟ｪ髯ｽ譁ｹ菴阪・鬮伜ｺｦ繧堤｢ｺ隱阪〒縺阪∪縺吶・);updateSun();
  },err=>{$('locate').disabled=false;message(`菴咲ｽｮ諠・ｱ繧ｨ繝ｩ繝ｼ・・{err.code}・・ ${err.message}`);},
  {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}
$('start').addEventListener('click',start);
$('stop').addEventListener('click',stop);
$('locate').addEventListener('click',locate);
$('now').addEventListener('click',setNow);
$('dateTime').addEventListener('change',updateSun);
for(const id of ['azOffset','altOffset'])$(id).addEventListener('input',()=>{$(id+'Value').textContent=`${$(id).value}ﾂｰ`;updateSun();});
$('resetOffset').addEventListener('click',()=>{for(const id of ['azOffset','altOffset']){$(id).value=0;$(id+'Value').textContent='0ﾂｰ';}updateSun();});
window.addEventListener('orientationchange',()=>{updateScreen();updateSun();});
window.addEventListener('resize',updateSun);
updateScreen();setNow();

