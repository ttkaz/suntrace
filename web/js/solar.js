'use strict';
// Sun position based on common low-precision astronomical formulas (SunCalc approach).
// Output: north-clockwise azimuth, altitude above horizon, both in degrees.
window.SunTraceSolar = (() => {
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const J1970 = 2440588, J2000 = 2451545;
  const toDays = date => date.getTime() / dayMs - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(23.4397*rad) - Math.tan(b)*Math.sin(23.4397*rad), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b)*Math.cos(23.4397*rad)+Math.cos(b)*Math.sin(23.4397*rad)*Math.sin(l));
  const wrap = x => ((x % 360) + 360) % 360;
  function position(date, lat, lon) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) return null;
    const d = toDays(date);
    const M = rad * (357.5291 + 0.98560028*d);
    const C = rad * (1.9148*Math.sin(M)+0.02*Math.sin(2*M)+0.0003*Math.sin(3*M));
    const L = M + C + rad*(102.9372+180);
    const dec = declination(L,0), ra=rightAscension(L,0);
    const phi=lat*rad;
    const H=rad*(280.16+360.9856235*d+lon)-ra;
    const altitude=Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H));
    const azimuth=Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi));
    return {azimuth:wrap((azimuth+Math.PI)/rad),altitude:altitude/rad};
  }
  return {position};
})();
