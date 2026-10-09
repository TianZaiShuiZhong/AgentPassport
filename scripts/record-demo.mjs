import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { publicSettingsFile } from '../server/public-access.mjs';
const {origin,accessCode}=JSON.parse(readFileSync(publicSettingsFile(),'utf8'));
if(!origin)throw new Error('Run npm run public first');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
let context,video;
try{
 mkdirSync('docs/demo-video',{recursive:true});
 context=await browser.newContext({viewport:{width:1440,height:1000},recordVideo:{dir:'docs/demo-video',size:{width:1440,height:1000}}});
 const page=await context.newPage();video=page.video();
 await page.goto(origin);await page.getByLabel('演示访问码').fill(accessCode);await page.getByRole('button',{name:'进入演示',exact:true}).click();
 await page.getByText('协议运行中').waitFor({timeout:45000});await page.waitForTimeout(2200);
 await page.getByRole('button',{name:'创建授权',exact:true}).click();await page.waitForTimeout(1800);await page.getByRole('button',{name:'签发链上授权',exact:true}).click();
 await page.getByText('授权已写入链上，应用现在可以按范围读取').waitFor({timeout:45000});
 console.log('Real Monad grants submitted via public gateway.');
 await page.getByRole('button',{name:'Writing Studio',exact:true}).click();await page.getByRole('button',{name:'测试私密记忆访问',exact:true}).click();
 await page.getByText(/私密内容未返回给应用/).waitFor({timeout:45000});await page.waitForTimeout(1800);
 await page.getByRole('button',{name:'读取记忆并生成',exact:true}).click();
 await page.getByText('文章已生成，输入与输出凭证已锚定到链上').waitFor({timeout:90000});
 console.log('Real DeepSeek generation and Monad output anchoring passed via public URL.');
 await page.waitForTimeout(2500);await page.getByRole('button',{name:'查看凭证',exact:true}).click();await page.getByRole('button',{name:'从链上核验',exact:true}).click();
 await page.getByText('凭证验证通过',{exact:true}).waitFor({timeout:45000});await page.waitForTimeout(2300);await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'授权管理',exact:true}).click();await page.getByRole('button',{name:'撤销全部有效授权',exact:true}).click();
 await page.getByText('授权已撤销，后续读取将被拒绝').waitFor({timeout:45000});await page.getByRole('button',{name:'Writing Studio',exact:true}).click();await page.getByRole('button',{name:'读取记忆并生成',exact:true}).click();
 await page.getByRole('status').filter({hasText:'授权已撤销'}).waitFor({timeout:45000});await page.waitForTimeout(2200);
 const evidence=JSON.parse(readFileSync('deployments/public-access-validation.json','utf8'));Object.assign(evidence,{publicGrantWrite:true,publicDeepSeekGeneration:true,publicResultAnchoring:true,publicRevocationDenied:true,videoDraft:'docs/demo-video/public-live-demo.webm'});writeFileSync('deployments/public-access-validation.json',JSON.stringify(evidence,null,2));
 console.log('Public complete interaction flow passed, including revocation denial.');
}finally{if(context)await context.close();if(video)await video.saveAs('docs/demo-video/public-live-demo.webm');await browser.close();}
