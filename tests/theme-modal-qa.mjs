import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../package.json', import.meta.url));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const theme=await import('../src/components/ui/ThemeToggle.tsx');
for(const [saved,system,expected] of [[null,true,'light'],['light',true,'light'],['dark',false,'dark'],['system',true,'dark'],['system',false,'light'],['invalid',true,'light']]){
 assert.equal(theme.getInitialTheme({getItem:()=>saved},system),expected);
}
assert.equal(theme.getStoredThemePreference({getItem(){throw Error('storage blocked');}}),'light');
console.log('PASS: default light, explicit theme and system preference resolution');
const originalWindow=globalThis.window;
try{
 const fakeWindow={};Object.defineProperty(fakeWindow,'localStorage',{get(){throw Error('storage getter blocked');}});globalThis.window=fakeWindow;
 assert.equal(theme.getStoredThemePreference(),'light');
 console.log('PASS: inaccessible localStorage getter falls back to light');
}finally{if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
const {ShowToStaffModal}=await import('../src/components/storefront/ShowToStaffModal.tsx');
const shop={id:'qa-shop',slug:'qa',name:'Quán QA',vertical:'fnb',currency:'VND',theme_config:{},supported_langs:['vi','en']};
const tables=[{id:'qa-table',shop_id:shop.id,table_code:'T01',name:'Bàn Cửa Sổ',section:'',capacity:4,sort_order:1,is_active:true,is_archived:false}];
const cart=[{item:{id:'qa-item',shop_id:shop.id,price:65000,name_i18n:{vi:'Phở QA',en:'QA Pho'},desc_i18n:{vi:''},options_json:[]},quantity:1,selectedChoices:[],quickTags:['Không hành'],customNote:''}];
const html=renderToStaticMarkup(React.createElement(ShowToStaffModal,{isOpen:true,onClose(){},shop,locale:'vi',cart,tables,selectedTableId:'qa-table',initialTableLabel:tables[0].name,onUpdateQuantity(){},onClearCart(){}}));
assert.ok(html.includes('Bàn Cửa Sổ'));assert.ok(html.includes('Phở QA'));assert.ok(html.includes('65.000'));
assert.ok(html.includes('Mời quý khách kiểm tra lại món trước khi bấm nút gửi đến quầy.'));
assert.ok(!html.includes('Bàn 05'),'no fabricated example table chips');
assert.ok(html.includes('Không hành'), 'selected dietary notes must survive rendering');
console.log('PASS: actual confirmation component server-rendered with managed table and canonical cart labels');
