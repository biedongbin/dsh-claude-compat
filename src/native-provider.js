// Native-realm Claude sources. No Host filesystem fallback or project mirrors.
import {createHash} from 'node:crypto';
import {parse as yaml} from 'yaml';
const api=path=>/^[A-Za-z]:[\\/]|^\\\\/.test(path)?windows:posix;
import {posix,win32 as windows} from 'node:path';
const absent=error=>['ENOENT','ENOTDIR','FS_NOT_FOUND'].includes(error?.code);
const legal=name=>typeof name==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
const tools=value=>Array.isArray(value)?value.map(String):typeof value==='string'?value.split(',').map(x=>x.trim()).filter(Boolean):[];
const prose=value=>typeof value==='string'?value.trim()||undefined:Array.isArray(value)?value.filter(item=>typeof item==='string').map(item=>item.trim()).filter(Boolean).join('; ')||undefined:undefined;

export class RealmReader {
  constructor(fs,signal){this.fs=fs;this.signal=signal;}
  async target(path){this.signal?.throwIfAborted();return this.fs.resolve(path,{signal:this.signal});}
  async stat(path){try{return await this.fs.stat(await this.target(path),this.signal);}catch(error){if(absent(error))return;throw error;}}
  async text(path){if((await this.stat(path))?.type!=='file')return;return this.fs.readText(await this.target(path),this.signal);}
  async list(path){
    if((await this.stat(path))?.type!=='directory')return[];
    const entries=await this.fs.listDir(await this.target(path),this.signal);
    return Promise.all(entries.map(async entry=>entry.type==='file'||entry.type==='directory'?entry:{...entry,type:(await this.stat(api(path).join(path,entry.name)))?.type}));
  }
}
function frontmatter(raw){const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);return match?{data:yaml(match[1])??{},body:match[2]}:{data:{},body:raw};}
function definition(path,raw,fallback,kind,rank,pluginRoot){
  const{data,body}=frontmatter(raw),name=legal(data.name)?data.name:fallback;
  if(!legal(name))throw new Error(`Claude source has no native skill name: ${path}`);
  const sourceTools=tools(data['allowed-tools']??data.tools);
  const whenToUse=prose(data.whenToUse)??prose(data.when_to_use)??prose(data['when-to-use'])??prose(data.triggers);
  const argumentHint=prose(data['argument-hint'])??prose(data.argumentHint)??prose(data.argument_hint);
  const description=String(data.description??body.split(/\r?\n/).find(line=>line.trim())??name)+(argumentHint?` Arguments: ${argumentHint}`:'');
  return{name,description,...(whenToUse?{whenToUse}:{}),
    invocation:{modelInvocable:data['disable-model-invocation']!==true,userInvocable:data['user-invocable']!==false},provider:'claude-native',source:rank===50?'project-claude':rank===750?'claude-plugin':'user-claude',rank,
    locator:{path,directory:api(path).dirname(path),kind,pluginRoot},resourceBase:{kind:'directory',path:api(path).dirname(path)},path,
    metadata:{claude:{kind,sourceFile:path,digest:createHash('sha256').update(raw).digest('hex'),...(pluginRoot?{pluginRoot}:{}),
      ...Object.fromEntries(['context','agent','model','effort','permissionMode','hooks'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]])),...(argumentHint?{argumentHint}:{}),...(Object.hasOwn(data,'allowed-tools')||Object.hasOwn(data,'tools')?{tools:sourceTools}:{}),rawFrontmatter:data}},content:body};
}

/** Registered once in the same preset layer as skill-filesystem; reads with explicit Agent scope. */
export class NativeClaudeProvider {
  constructor(ctx,control,config={}) {
    this.ctx=ctx;this.control=control;this.config=config;this.name='claude-native';
    // Remote repositories do not have a Host chokidar watcher. Refresh before
    // each request boundary; registry caching remains stable during collection.
    ctx.on('agent/pre-step',async(_request,next)=>{control.invalidate();return next();});
  }
  async list(options={}) {
    const agent=options.scope;
    if(!agent?.session)return[];
    const context=await this.ctx.get('platformProjectConfig').resolve(agent,options.signal);
    const reader=new RealmReader(context.fs,options.signal),out=[];
    await this.root(reader,api(context.checkoutRoot).join(context.checkoutRoot,'.claude'),50,out);
    if(context.userClaudeDir)await this.root(reader,context.userClaudeDir,700,out);
    if(this.config.enablePlugins!==false&&context.userClaudeDir) {
      const root=api(context.userClaudeDir).join(context.userClaudeDir,'plugins'),raw=await reader.text(api(root).join(root,'installed_plugins.json'));
      const enabled={};
      for(const file of [api(context.userClaudeDir).join(context.userClaudeDir,'settings.json'),api(context.checkoutRoot).join(context.checkoutRoot,'.claude','settings.json'),api(context.sourceRoot).join(context.sourceRoot,'.claude','settings.local.json')]) {
        const settings=await reader.text(file);if(settings)Object.assign(enabled,JSON.parse(settings).enabledPlugins??{});
      }
      if(raw)for(const[key,entries]of Object.entries(JSON.parse(raw).plugins??{})) {
        if(enabled[key]!==true||!Array.isArray(entries))continue;
        const entry=entries.findLast(item=>item.scope==='user'||((item.scope==='project'||item.scope==='local')&&[context.sourceRoot,context.checkoutRoot].includes(item.projectPath)));
        if(!entry)continue;
        if(typeof entry.installPath!=='string')continue;
        await this.plugin(reader,entry.installPath,out);
      }
    }
    return out.map(({content,...candidate})=>candidate);
  }
  async root(reader,root,rank,out) {
    await this.skills(reader,api(root).join(root,'skills'),'',0,rank,out);
    for(const[kind,dir]of[['command','commands'],['agent','agents']])for(const entry of await reader.list(api(root).join(root,dir))) {
      if(entry.type!=='file'||!entry.name.endsWith('.md'))continue;
      const path=api(root).join(root,dir,entry.name),raw=await reader.text(path);
      if(raw!==undefined)out.push(definition(path,raw,entry.name.slice(0,-3),kind,rank));
    }
  }
  async skills(reader,root,prefix,depth,rank,out,pluginRoot) {
    const entries=await reader.list(root);
    if(entries.some(item=>item.type==='file'&&item.name==='SKILL.md')) {
      const path=api(root).join(root,'SKILL.md'),raw=await reader.text(path);
      if(raw!==undefined)out.push(definition(path,raw,prefix||api(root).basename(root),'skill',rank,pluginRoot));
      return;
    }
    for(const entry of entries) {
      const path=api(root).join(root,entry.name),name=prefix?`${prefix}-${entry.name.replace(/\.md$/,'')}`:entry.name.replace(/\.md$/,'');
      if(entry.type==='file'&&entry.name.endsWith('.md')) {const raw=await reader.text(path);if(raw!==undefined)out.push(definition(path,raw,name,'skill',rank,pluginRoot));}
      else if(entry.type==='directory'&&!entry.name.startsWith('.')&&entry.name!=='node_modules'&&depth<(this.config.skillDepth??3))await this.skills(reader,path,name,depth+1,rank,out,pluginRoot);
    }
  }
  async plugin(reader,root,out) {
    const raw=await reader.text(api(root).join(root,'.claude-plugin','plugin.json')),manifest=raw?JSON.parse(raw):{};
    const dirs=typeof manifest.skills==='string'?[manifest.skills]:Array.isArray(manifest.skills)?manifest.skills:['skills'];
    for(const dir of dirs)await this.skills(reader,api(root).resolve(root,dir),'',0,750,out,root);
    for(const[kind,dir]of[['command',manifest.commands??'commands'],['agent','agents']]) {
      if(typeof dir!=='string')continue;
      for(const entry of await reader.list(api(root).resolve(root,dir)))if(entry.type==='file'&&entry.name.endsWith('.md')) {
        const path=api(root).resolve(root,dir,entry.name),text=await reader.text(path);if(text!==undefined)out.push(definition(path,text,entry.name.slice(0,-3),kind,750,root));
      }
    }
  }
  async get(candidate,options={}) {
    const agent=options.scope;if(!agent?.session)return;
    const context=await this.ctx.get('platformProjectConfig').resolve(agent,options.signal),reader=new RealmReader(context.fs,options.signal),raw=await reader.text(candidate.locator.path);
    if(raw===undefined)return;
    return definition(candidate.locator.path,raw,candidate.name,candidate.locator.kind,candidate.rank,candidate.locator.pluginRoot);
  }
}
