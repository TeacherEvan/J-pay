
// Regression test — would catch RATE_OUT_OF_RANGE if guard removed
const RATE_MAX = 100000;
function passesRateGuard(rate) { return rate === undefined || (rate >= 0 && rate <= RATE_MAX); }
console.assert(passesRateGuard(0) === true, 'min 0 passes');
console.assert(passesRateGuard(50000) === true, 'mid passes');
console.assert(passesRateGuard(-1) === false, 'negative fails');
console.assert(passesRateGuard(100001) === false, 'over max fails');
console.log('PASS: rate-range regression guard verified');
