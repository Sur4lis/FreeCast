const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolve,formatPrice}=require('../browser-extension/ui/superchat-style.js');
test('SC actual yuan amount is independent of its appearance tier',()=>{
  assert.equal(formatPrice(52),'￥52');
  assert.equal(formatPrice(520),'￥520');
  assert.equal(formatPrice(52.5),'￥52.5');
  assert.deepEqual(resolve({price:52}),resolve({price:50}));
  assert.notDeepEqual(resolve({price:52}),resolve({price:500}));
  assert.equal(formatPrice(2),'￥2');
});
test('SC uses platform palette before amount-based fallback',()=>{
  const native={price:52,scColor:'#163B4B',scHeaderColor:'#F2FFFE',scPriceColor:'#7DA4BD',scTextColor:'#FEFEFE',scNameColor:'#17394A'};
  assert.deepEqual(resolve(native),{body:'#163B4B',header:'#F2FFFE',badge:'#7DA4BD',bodyInk:'#FEFEFE',headerInk:'#17394A',priceInk:'#18212B'});
  assert.equal(resolve({price:52,scColor:'url(https://example.com)'}).body,resolve({price:52}).body);
});
test('SC missing metadata remains readable with bounded amounts',()=>{
  for(const value of [NaN,Infinity,-50,undefined])assert.equal(formatPrice(value),'￥0');
  for(const price of [2,30,50,52,100,500,520,1000,2000]){
    const colors=resolve({price});
    assert.match(colors.body,/^#[0-9a-f]{6}$/i);assert.notEqual(colors.header,colors.body);
    assert.ok(['#FFFFFF','#18212B'].includes(colors.bodyInk));
  }
});
