'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.argv[2]||path.resolve(__dirname,'..'),context=vm.createContext({window:{}});
const asset=name=>fs.readFileSync(path.join(root,'src/lazyfish/web/static',name),'utf8');
vm.runInContext(asset('reference-i18n.js'),context);
assert.strictEqual(context.window.LazyfishReferenceI18n.zh,undefined,'Chinese text is in a separate resource');
vm.runInContext(asset('i18n-zh.js'),context);
const locales=JSON.parse(JSON.stringify(context.window.LazyfishReferenceI18n));
assert.deepStrictEqual(Object.keys(locales.en).sort(),Object.keys(locales.zh).sort());
assert.ok(!/[\u3400-\u9fff]/.test(JSON.stringify(locales.en)));
function variables(value){return [...new Set((typeof value==='string'?value:Object.values(value).join(' ')).match(/\{\w+\}/g)||[])].sort();}
for(const key of Object.keys(locales.en))assert.deepStrictEqual(variables(locales.en[key]),variables(locales.zh[key]),key);
const html=asset('index.html');
assert.ok(html.indexOf('/reference-i18n.js')<html.indexOf('/i18n-zh.js'));
assert.ok(html.indexOf('/i18n-zh.js')<html.indexOf('/app.js'));
console.log('English and Chinese locale keys, placeholders and load order passed.');
