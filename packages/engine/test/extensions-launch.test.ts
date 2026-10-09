import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { ClaudeAdapter, EngineHost } from '../src'
import type { HostEvent } from '@pixelsky/protocol'
import { makeTmp, removeTmp } from './helpers/tmp'
let root:string,host:EngineHost|undefined,events:HostEvent[]
beforeEach(()=>{root = makeTmp('extension-launch');events=[]})
afterEach(async()=>{await host?.shutdown();removeTmp(root)})
it('initialize 命令原生标记穿过适配器和宿主快照，区分内置与同名用户技能',async()=>{
  const commands=[
    {name:'compact',description:'Built-in summary',builtin:true},
    {name:'plugin:compact',description:'Plugin original description',builtin:false},
    {name:'legacy-skill',description:'Legacy original description'},
  ]
  const fake=fileURLToPath(new URL('./fakes/fake-claude.mjs',import.meta.url))
  const adapter=new ClaudeAdapter({launcher:{command:process.execPath,args:[fake]},env:{...process.env,FAKE_CLAUDE_COMMANDS:JSON.stringify(commands)}})
  host=new EngineHost({dataDir:join(root,'engine'),adapters:{claude:adapter},emit:e=>events.push(e)})
  const session=host.createSession({projectId:host.addProject(root).id})
  await host.send(session.id,'command metadata probe')
  for(let n=0;n<200&&!host.open(session.id).commands?.length;n++)await new Promise(r=>setTimeout(r,10))
  expect(host.open(session.id).commands).toEqual(commands.map(command=>({...command,source:'engine'})))
})
it('扩展版本变化下一轮重建 Claude，保留 resume、加载参数并释放未使用配置',async()=>{
  let version=1,disposed=0
  const fake=fileURLToPath(new URL('./fakes/fake-claude.mjs',import.meta.url)),argsLog=join(root,'args'),projectsDir=join(root,'claude-projects')
  const adapter=new ClaudeAdapter({launcher:{command:process.execPath,args:[fake]},projectsDir,env:{...process.env,FAKE_CLAUDE_LOG:argsLog,FAKE_CLAUDE_PROJECTS:projectsDir}})
  host=new EngineHost({dataDir:join(root,'engine'),adapters:{claude:adapter},emit:e=>events.push(e),extensions:()=>({key:String(version),pluginDirs:[join(root,'plugin')],pathDirs:[join(root,'bin')],mcpFile:join(root,'mcp.json'),dispose:()=>{disposed++}})})
  const s=host.createSession({projectId:host.addProject(root).id})
  const wait=async(count:number)=>{for(let n=0;n<200;n++){if(events.filter(e=>e.kind==='session'&&e.sessionId===s.id&&e.event.type==='turn_completed').length>=count)return;await new Promise(r=>setTimeout(r,20))}throw new Error('turn timed out')}
  await host.send(s.id,'first');await wait(1);await host.send(s.id,'second');await wait(2)
  expect(readFileSync(argsLog,'utf8').trim().split('\n').filter(line=>line.startsWith('['))).toHaveLength(1);expect(disposed).toBe(1)
  version=2;await host.send(s.id,'third');await wait(3)
  const args=readFileSync(argsLog,'utf8').trim().split('\n').filter(line=>line.startsWith('[')).map(line=>JSON.parse(line) as string[])
  expect(args).toHaveLength(2);expect(args[1]).toContain('--resume');expect(args[1]).toContain('--plugin-dir');expect(args[1]).toContain('--mcp-config')
  await host.shutdown();host=undefined;expect(disposed).toBe(3)
})
