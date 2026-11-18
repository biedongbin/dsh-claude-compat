// Current-version base feature recording. Use from an authenticated Tabbit task.
import {fileURLToPath} from 'node:url';
import {overlays,caption,moveClick,record,cleanup} from './record-interactions.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');
export async function recordBasics(context,page,lang){
 const zh=lang==='zh-CN';
 const l=zh?{new:'新建会话',plugins:'插件',installed:'已安装',add:'添加插件',managed:'已安装插件',send:'发送消息'}:{new:'New session',plugins:'Plugins',installed:'Installed',add:'Add plugin',managed:'Installed plugins',send:'Send message'};
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:l.new,exact:true}).first().click();
 await overlays(page,zh?'完整2.0.0演示：从安装入口开始':'Complete 2.0.0 demo: start with the installation entry');
 const base=`${root}/.tmp/complete-v2-capture/${lang}`;
 const install=await record(context,page,`${base}/install`,async mark=>{
  await page.waitForTimeout(700);
  await moveClick(page,page.getByRole('button',{name:l.plugins,exact:true}));
  await page.getByRole('tab',{name:l.installed,exact:true}).click({timeout:5000});
  await page.waitForTimeout(700);
  await moveClick(page,page.getByRole('button',{name:l.add,exact:true}));
  const input=page.getByRole('dialog').getByRole('textbox');await input.waitFor({timeout:5000});
  await input.pressSequentially('dsh-claude-compat',{delay:85});
  await page.waitForFunction(()=>{const d=document.querySelector('[role=dialog]');return d&&d.getAnimations({subtree:true}).every(a=>a.playState==='finished')});
  await caption(page,zh?'填写包名即可安装；演示只展示入口，不重复安装':'Enter the package name to install; this demo does not reinstall it');
  mark('package-entered');await page.waitForTimeout(2600);
 });
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:l.new,exact:true}).first().click();
 const input=page.locator('[role=textbox][contenteditable=true]');await input.click();await input.press('Meta+A');await input.press('Backspace');
 await caption(page,zh?'Claude配置继续用：对话里输入 /cc-plugin':'Reuse your Claude setup: type /cc-plugin inside chat');
 const plugins=await record(context,page,`${base}/plugins`,async mark=>{
  await moveClick(page,input);await input.pressSequentially('/cc-plugin',{delay:85});
  await moveClick(page,page.getByRole('button',{name:l.send,exact:true}));mark('submit');
  await page.getByRole('button',{name:l.managed,exact:true}).waitFor({timeout:5000});
  await page.waitForTimeout(700);
  const search=page.getByRole('searchbox');await moveClick(page,search);
  await search.pressSequentially('context7',{delay:100});await search.press('Enter');
  const item=page.getByText('context7',{exact:true}).last();await item.waitFor({timeout:5000});await item.scrollIntoViewIfNeeded();
  await caption(page,zh?'管理插件、发现内容、查看市场，都在DSH里':'Manage plugins, discover content and browse marketplaces inside DSH');
  mark('plugin-result');await page.waitForTimeout(3000);
 });
 await cleanup(page);return{install,plugins};
}
export async function recordSkill(context,page,lang){
 const zh=lang==='zh-CN';
 await page.getByRole('button',{name:zh?'新建会话':'New session',exact:true}).first().click();await page.setViewportSize({width:1440,height:900});
 const input=page.locator('[role=textbox][contenteditable=true]');await input.click();await input.press('Meta+A');await input.press('Backspace');
 await overlays(page,zh?'已有Claude格式技能：从 / 菜单选择并执行':'Reuse a Claude-format skill: choose it from the / menu');
 const result=await record(context,page,`${root}/.tmp/complete-v2-capture/${lang}/skill-good`,async mark=>{
  await moveClick(page,input);await input.pressSequentially('/demo-brief-v2',{delay:80});
  const option=page.getByRole('option',{name:/^demo-brief-v2/});await option.waitFor({timeout:5000});mark('skill-menu');await page.waitForTimeout(600);
  await moveClick(page,option);await input.pressSequentially(zh?' 请用中文输出三条摘要。':' Write three brief items in English.',{delay:45});
  await moveClick(page,page.getByRole('button',{name:zh?'发送消息':'Send message',exact:true}));mark('submit');
  const answer=page.getByText(zh?'演示用2.0摘要':'Demo 2.0 brief',{exact:true}).last();await answer.waitFor({timeout:40000});mark('result');
  await answer.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
  await caption(page,zh?'实际生成的回复：配置复用、插件管理、历史与总览':'Actual output: configuration reuse, plugin management, history and inventory');
  await page.waitForTimeout(3500);
 });
 await cleanup(page);return result;
}

export async function recordHistory(context,page,lang){
 const zh=lang==='zh-CN';
 const l=zh?{new:'新建会话',send:'发送消息',project:'项目目录',confirm:'确认',preview:'预览',read:'阅读并总结',collapse:'收起管理界面'}:{new:'New session',send:'Send message',project:'Project directory',confirm:'Confirm',preview:'Preview',read:'Read history and summarize',collapse:'Collapse manager'};
 await page.getByRole('button',{name:l.new,exact:true}).first().click();await page.setViewportSize({width:1440,height:900});
 let input=page.locator('[role=textbox][contenteditable=true]');await input.click();await input.press('Meta+A');await input.press('Backspace');
 await overlays(page,zh?'接续Claude历史：预览内容，再交给DSH阅读':'Continue Claude history: preview it, then let DSH read the source');
 const base=`${root}/.tmp/complete-v2-capture/${lang}`;
 const history=await record(context,page,`${base}/history`,async mark=>{
  await moveClick(page,input);await input.pressSequentially('/cc-resume',{delay:85});await moveClick(page,page.getByRole('button',{name:l.send,exact:true}));
  const directory=page.getByRole('textbox',{name:l.project,exact:true});await directory.waitFor({timeout:5000});await directory.fill(`${root}/.tmp/complete-v2-fixture`);await page.getByRole('button',{name:l.confirm,exact:true}).click();
  const title=page.getByText('Demo 2.0: product brief / 演示：产品摘要',{exact:true});await title.waitFor({timeout:5000});await title.scrollIntoViewIfNeeded();await page.waitForTimeout(650);
  await moveClick(page,page.getByRole('button',{name:l.preview,exact:true}));const read=page.getByRole('button',{name:l.read,exact:true});await read.waitFor({timeout:5000});await read.scrollIntoViewIfNeeded();mark('preview');await page.waitForTimeout(1600);
  await moveClick(page,read);mark('handoff');await page.waitForTimeout(1000);
 });
 await page.waitForFunction((isZh)=>{const text=document.body.innerText;return text.includes(isZh?'已完成，用时':'Completed in')&&!document.querySelector('button[aria-label="'+(isZh?'停止生成':'Stop generating')+'"]');},zh,{timeout:40000});
 for(let i=0;i<4;i++){const c=page.getByRole('button',{name:l.collapse,exact:true});if(!await c.count())break;await c.first().click();}
 input=page.locator('[role=textbox][contenteditable=true]');await input.click();await input.press('Meta+A');await input.press('Backspace');
 const heading=zh?'接续完成':'Recovered context';
 await caption(page,zh?'基于刚读取的历史，继续当前对话；模型等待将剪去':'Continue the same chat using recovered history; model waits are cut');
 const summary=await record(context,page,`${base}/summary`,async mark=>{
  const request=zh?'请基于刚读取的演示历史，用中文简述背景、当前状态、下一步，每项一句。标题只写“接续完成”。不要调用工具。':'Based on the demo history you just read, summarize Background, Status and Next step in English, one sentence each. Use the exact heading Recovered context. No tools.';
  await moveClick(page,input);await input.pressSequentially(request,{delay:20});await moveClick(page,page.getByRole('button',{name:l.send,exact:true}));mark('submit');
  const answer=page.getByText(heading,{exact:true}).last();await answer.waitFor({timeout:35000});mark('result');await answer.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
  await caption(page,zh?'真实接续结果：背景、当前状态和下一步':'Actual continuation: background, current status and next step');await page.waitForTimeout(4000);
 });
 await cleanup(page);return{history,summary};
}
