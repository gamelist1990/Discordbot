import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const id='890315487962095637';
await page.route('**/api/**',async route=>{
 const pathname=new URL(route.request().url()).pathname;
 let data={};
 if(pathname==='/api/auth/session') data={user:{userId:'123',username:'Staff',permissionLevel:3,permissions:[{guildId:id,level:3}]}};
 if(pathname==='/api/staff/guilds') data={guilds:[{id,name:'PEX Community'}]};
 if(pathname===`/api/staff/ai/${id}`) data={customMemos:[{id:'m',title:'建築ルール',content:'拠点周辺の木を植え直す',authorName:'Staff',createdAt:new Date().toISOString()}],memories:[]};
 await route.fulfill({json:data});
});
try{
 await page.goto('http://127.0.0.1:5177/staff/ai');
 await page.getByText('建築ルール',{exact:true}).waitFor({state:'attached',timeout:15000});
 console.log(await page.getByText('建築ルール',{exact:true}).evaluate(el=>{const c=getComputedStyle(el);return {fontSize:c.fontSize,lineHeight:c.lineHeight,color:c.color,contentVisibility:c.contentVisibility,html:el.outerHTML}}));
 await page.getByText('建築ルール',{exact:true}).scrollIntoViewIfNeeded();
 await page.getByText('拠点周辺の木を植え直す',{exact:true}).waitFor();
 assert.equal(await page.getByText('ユーザー別プロフィール',{exact:true}).count(),0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1050});
  await page.screenshot({path:`test-results/nemotron-staff-${width}.png`,fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
  assert.equal(overflow,false,'horizontal overflow '+width);
 }
 assert.deepEqual(errors,[]);
 console.log('Staff UI: custom memo visible, retired profile hidden, desktop/mobile no horizontal overflow, no runtime errors');
}finally{await browser.close();}
