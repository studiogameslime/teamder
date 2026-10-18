import {allowMapNavigation, mapScriptValue, validMapPoint} from '@/utils/mapWebSecurity';

test('map values cannot terminate the inline script, but roundtrip without changing marker ids',()=>{
  const value={id:'</script><script>alert(1)</script>',emoji:"'\\\u2028&"};
  const encoded=mapScriptValue(value);
  expect(encoded).not.toContain('</script>');
  expect(encoded).not.toContain('\u2028');
  expect(JSON.parse(encoded)).toEqual(value);
});
test.each(['https://example.invalid/','javascript:alert(1)','file:///secret','intent://anything','data:text/plain,hello'])('map refuses unexpected navigation: %s',url=>{
  expect(allowMapNavigation(url)).toBe(false);
});
test.each(['about:blank','about:blank#map','data:text/html;charset=utf-8,<html></html>'])('inline map may load: %s',url=>{
  expect(allowMapNavigation(url)).toBe(true);
});
test('coordinates from bridge and imperative scripts must be finite numbers',()=>{
  expect(validMapPoint({lat:32.1,lng:34.8})).toBe(true);
  expect(validMapPoint({lat:'32;alert(1)',lng:34.8})).toBe(false);
  expect(validMapPoint({lat:NaN,lng:Infinity})).toBe(false);
  expect(validMapPoint({lat:91,lng:34})).toBe(false);
});
