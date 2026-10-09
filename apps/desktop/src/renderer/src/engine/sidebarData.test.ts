import { describe, expect, it } from 'vitest'
import type { ProjectRecord, SessionSummary } from '@pixelsky/protocol'
import { demoSidebarData, sidebarData } from './sidebarData'
describe('侧栏归档分组',()=>{
  it('置底在项目尾部；最近先取八条再置底，目标仍可见，普通项顺序稳定',()=>{
    const projects:ProjectRecord[]=[{id:'p',name:'项目',path:'test',addedAt:1}]
    const sessions=Array.from({length:10},(_,i)=>({record:{id:'s'+i,projectId:'p',title:'会话'+i,updatedAt:100-i,bottomedAt:i===0?2:i===2?1:null},state:'idle'})) as SessionSummary[]
    const data=sidebarData(projects,sessions,{},String)
    expect(data.projects[0].sessions.map(s=>s.id)).toEqual(['s1','s3','s4','s5','s6','s7','s8','s9','s2','s0'])
    expect(data.recent.map(s=>s.id)).toEqual(['s1','s3','s4','s5','s6','s7','s2','s0'])
    expect(sessions[0].record.id).toBe('s0')
  })
  it('归档与演示重命名 / 置底保持所属列表，标题同步到最近任务',()=>{
    const projects=[{id:'p',name:'项目',sessions:[{id:'a',title:'A',status:'idle' as const},{id:'c',title:'C',status:'idle' as const}],archived:[{id:'b',title:'B',status:'idle' as const,archivedAt:1}]}]
    const data=demoSidebarData(projects,[{id:'a',title:'A',time:''},{id:'c',title:'C',time:''}],null,{a:{archivedAt:null,deleted:false,stopped:false,title:'已改名',bottomedAt:2},b:{archivedAt:1,deleted:false,stopped:false,title:'归档名称',bottomedAt:3}})
    expect(data.projects[0].sessions.map(s=>s.title)).toEqual(['C','已改名']);expect(data.recent.map(s=>s.title)).toEqual(['C','已改名'])
    expect(data.projects[0].archived[0].title).toBe('归档名称');expect(projects[0].sessions[0].title).toBe('A')
  })
  it('先过滤归档再取最近八条，项目保留归档入口',()=>{
    const projects:ProjectRecord[]=[{id:'p',name:'项目',path:'test',addedAt:1}]
    const sessions=Array.from({length:12},(_,i)=>({record:{id:'s'+i,projectId:'p',title:'会话'+i,updatedAt:i,archivedAt:i<3?10:null},state:'idle'})) as SessionSummary[]
    const data=sidebarData(projects,sessions,{s0:true,s4:true},String)
    expect(data.recent).toHaveLength(8);expect(data.recent[0].id).toBe('s3');expect(data.projects[0].archived).toHaveLength(3);expect(data.runStatus?.newReplies).toBe(1)
  })
  it('运行状态列出未归档的运行中与新回复会话，运行中在前',()=>{
    const projects:ProjectRecord[]=[{id:'p',name:'项目',path:'test',addedAt:1}]
    const sessions=[
      {record:{id:'a',projectId:'p',title:'空闲',updatedAt:5},state:'idle'},
      {record:{id:'b',projectId:'p',title:'有回复',updatedAt:4},state:'idle'},
      {record:{id:'c',projectId:'p',title:'运行',updatedAt:3},state:'running'},
      {record:{id:'d',projectId:'p',title:'已归档',updatedAt:2,archivedAt:1},state:'running'},
    ] as SessionSummary[]
    const data=sidebarData(projects,sessions,{b:true,d:true},String)
    expect(data.runStatus).toMatchObject({running:1,newReplies:1})
    expect(data.runStatus?.items.map(i=>[i.id,i.status,i.project])).toEqual([['c','running','项目'],['b','unread','项目']])
    expect(sidebarData(projects,sessions.slice(0,1),{},String).runStatus).toBeNull()
  })
  it('演示归档、恢复与删除仅根据内存覆盖，不改原始数据',()=>{
    const projects=[{id:'p',name:'项目',sessions:[{id:'a',title:'A',status:'idle' as const}],archived:[{id:'b',title:'B',status:'idle' as const,archivedAt:1}]}]
    const data=demoSidebarData(projects,[{id:'a',title:'A',time:''}],null,{a:{archivedAt:2,deleted:false,stopped:true},b:{archivedAt:null,deleted:false,stopped:true}})
    expect(data.projects[0].sessions.map(s=>s.id)).toEqual(['b']);expect(data.projects[0].archived.map(s=>s.id)).toEqual(['a']);expect(data.recent.map(s=>s.id)).toEqual(['b']);expect(projects[0].sessions[0].id).toBe('a')
  })
})
