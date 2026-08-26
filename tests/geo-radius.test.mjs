
const ONE_MILE_METERS = 1609.34;
function toRad(x) { return x * Math.PI / 180; }
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isInRadius(pLat, pLng, sLat, sLng, radiusM) { return haversine(pLat, pLng, sLat, sLng) <= radiusM; }
// GREEN assertions
console.assert(isInRadius(40.0, -74.0, 40.0, -74.0, ONE_MILE_METERS) === true, 'same point pass');
console.assert(isInRadius(40.0, -74.0, 41.0, -74.0, ONE_MILE_METERS) === false, '1deg N >1mi fail');
console.log('PASS: haversine geo-radius verified (1 mile =', ONE_MILE_METERS, 'm)');
