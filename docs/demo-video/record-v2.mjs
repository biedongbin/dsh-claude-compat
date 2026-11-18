// Invoke captureV2(context, page, language) from an authenticated Tabbit task.
// Records real version-2 inventory interactions; it never changes plugin state.
import {overlays, caption, moveClick, record, cleanup} from './record-interactions.mjs';
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export async function captureV2(context, page, language) {
  const zh = language === 'zh-CN';
  const labels = zh
    ? {bridge:'Claude 桥接',newSession:'新建会话',query:'搜索名称或描述',skills:'技能',plugins:'插件',view:'📄 查看内容',back:'返回详情'}
    : {bridge:'Claude bridge',newSession:'New session',query:'Search by name or description',skills:'Skills',plugins:'Plugins',view:'📄 View content',back:'Back to details'};
  await page.setViewportSize({width:1440,height:900});
  const panel = page.locator('.dcc-inv-page');
  // Restore a known view before capture; no product content is rewritten.
  const search = panel.locator('input[type=search]');
  if (await search.count()) {
    await search.click(); await search.press('Meta+A'); await search.press('Backspace');
    await page.waitForTimeout(350);
  }
  await panel.getByRole('button',{name:new RegExp('^'+labels.plugins+'\\s*\\d+')}).click({timeout:3000});
  await panel.locator('.dcc-inv-item').filter({hasText:/superpowers/}).first().waitFor({timeout:5000});
  await page.getByRole('button',{name:labels.newSession,exact:true}).first().click();
  await overlays(page,zh?'2.0.0：从 DSH 进入 Claude 桥接总览':'2.0.0: explore Claude configuration inside DSH');
  const result=[];
  const directory=`${ROOT}/.tmp/interaction-capture-v2-take2/${language}`;
  result.push(await record(context,page,`${directory}/overview`,async mark=>{
    await page.waitForTimeout(600);
    await moveClick(page,page.getByRole('button',{name:labels.bridge,exact:true}));
    await panel.locator('.dcc-inv-item').filter({hasText:/superpowers/}).first().waitFor({timeout:5000});
    await page.waitForTimeout(700);
    await moveClick(page,panel.locator('.dcc-inv-item').filter({hasText:/superpowers/}).first());
    mark('plugin-details');
    await caption(page,zh?'查看每个插件提供的技能、命令与其他声明':'Inspect the skills, commands and declarations a plugin provides');
    await page.waitForTimeout(3500);
  }));
  result.push(await record(context,page,`${directory}/drill`,async mark=>{
    await moveClick(page,panel.locator('.dcc-provides-item').filter({hasText:labels.skills}));
    mark('plugin-drill');await page.waitForTimeout(700);
    const input=panel.locator('input[type=search]');await moveClick(page,input);
    await input.pressSequentially('brainstorming',{delay:100});
    await panel.locator('.dcc-inv-item').filter({hasText:'brainstorming'}).waitFor({timeout:4000});
    await caption(page,zh?'能力计数可下钻；输入即搜索，当前筛选清晰可见':'Drill into a capability; type to search and see the active filters');
    mark('filtered');await page.waitForTimeout(3500);
  }));
  result.push(await record(context,page,`${directory}/viewer`,async mark=>{
    await moveClick(page,panel.locator('.dcc-inv-item').filter({hasText:'brainstorming'}));
    await page.waitForTimeout(700);
    await moveClick(page,panel.getByRole('button',{name:labels.view,exact:true}));
    await panel.locator('.dcc-file-pre').waitFor({timeout:4000});
    mark('actual-file');await caption(page,zh?'直接阅读原文件；翻译仅供查看，可能消耗模型额度':'Read the source file. Optional translation is view-only and may use tokens');
    await page.waitForTimeout(4500);
    await moveClick(page,panel.getByRole('button',{name:labels.back,exact:true}));
    await caption(page,zh?'DSH 开关只控制技能、命令与 Agents；声明不等于已挂载':'DSH switches control skills, commands and agents; declarations are not runtime status');
    mark('scope');await page.waitForTimeout(3500);
  }));
  await cleanup(page);
  return result;
}
