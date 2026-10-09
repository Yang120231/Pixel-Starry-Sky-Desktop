import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isLive } from '@/engine'
import { bridge, getEngineState } from '@/engine/store'
import { changeDemoSession, getDemoSessionChanges } from '@/mock/sessionLifecycle'
import { paneActions } from '@/panes/store'
import { SESSION_REMOVED_EVENT } from '@/engine/sessionLifecycle'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useI18n } from '@/i18n/I18nProvider'
import { translateMessage } from '@/i18n/core'
import { retainSessionFiles } from '@/files/store'
import { RenameSessionDialog } from './RenameSessionDialog'
import { normalizeSessionTitle } from '@pixelsky/protocol'
export interface SessionTarget {id:string;title:string;archived:boolean;running:boolean;bottomed?:boolean}
type Action='archive'|'restore'|'delete'|'rename'|'bottom'
interface Context {request:(action:Action,target:SessionTarget)=>void;requestResult:(action:Action,target:SessionTarget)=>Promise<boolean>;busy:boolean}
const Context=createContext<Context|null>(null)
export function useSessionActions():Context {const value=useContext(Context);if(!value)throw new Error('SessionActionsProvider missing');return value}
interface Request {action:'archive'|'delete';target:SessionTarget}
type ToastKind='archive'|'restore'|'delete'|'error'|'rename'|'bottom'|'unbottom'
interface Toast {kind:ToastKind;id:string;title:string;text?:string;at:number}
const TOAST_KEYS={archive:'session.archivedToast',restore:'session.restoredToast',delete:'session.deletedToast',rename:'session.renamedToast',bottom:'session.bottomToast',unbottom:'session.unbottomToast'} as const
export function SessionActionsProvider({children}:{children:ReactNode}) {
  const {t}=useI18n(),[confirm,setConfirm]=useState<Request|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[toast,setToast]=useState<Toast|null>(null),working=useRef(false)
  const [rename,setRename]=useState<SessionTarget|null>(null)
  const returnFocus=useRef<HTMLElement|null>(null)
  const pendingResult=useRef<((ok:boolean)=>void)|null>(null)
  const resolveResult=(ok:boolean):void=>{pendingResult.current?.(ok);pendingResult.current=null}
  const cancelConfirm=():void=>{resolveResult(false);setConfirm(null);setRename(null);setError(null);requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true})})}
  useEffect(()=>{const removed=(event:Event):void=>{const ids=new Set((event as CustomEvent<{ids:string[]}>).detail.ids);paneActions.closeSessions(ids)};window.addEventListener(SESSION_REMOVED_EVENT,removed);return()=>window.removeEventListener(SESSION_REMOVED_EVENT,removed)},[])
  const fresh=(target:SessionTarget):SessionTarget=>{
    if(!isLive){const change=getDemoSessionChanges()[target.id];return {...target,title:change?.title??target.title,bottomed:change?.bottomedAt===undefined?target.bottomed:!!change.bottomedAt,archived:change?!!change.archivedAt:target.archived,running:change?.stopped?false:target.running}}
    const state=getEngineState(),summary=state.sessions.find(s=>s.record.id===target.id),snapshot=state.snapshots[target.id],record=snapshot?.record??summary?.record
    return record?{id:record.id,title:record.title,bottomed:!!record.bottomedAt,archived:!!record.archivedAt,running:(snapshot?.state??summary?.state??'idle')!=='idle'}:target
  }
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5000);return()=>clearTimeout(timer)},[toast])
  const apply=async(action:Exclude<Action,'rename'>,target:SessionTarget,allowRunning:boolean):Promise<void>=>{
    if(working.current)return;working.current=true;setBusy(true);setError(null)
    try {
      const current=fresh(target)
      if(isLive&&bridge){if(action==='delete'){retainSessionFiles(current.id);await bridge.deleteSession(current.id)}else if(action==='bottom')await bridge.setSessionBottom(current.id,!current.bottomed);else await bridge.archiveSession(current.id,action==='archive',allowRunning)}
      else changeDemoSession(current.id,action==='bottom'?{bottomedAt:current.bottomed?null:Date.now(),archivedAt:current.archived?(getDemoSessionChanges()[current.id]?.archivedAt??1):null}:action==='delete'?{deleted:true,stopped:true}:{archivedAt:action==='archive'?Date.now():null,stopped:action==='archive'||getDemoSessionChanges()[current.id]?.stopped===true})
      if(action==='archive'||action==='delete')paneActions.closeSessions(new Set([current.id]))
      setConfirm(null);setToast({kind:action==='bottom'&&current.bottomed?'unbottom':action,id:current.id,title:current.title,at:Date.now()})
      resolveResult(true)
    }catch(error){
      if(action==='archive'&&(error as Error).message.includes('SESSION_RUNNING'))setConfirm({action,target:{...fresh(target),running:true}})
      else {const message=translateMessage((error as Error).message)||t('session.retry');if(confirm)setError(message);else {resolveResult(false);setToast({kind:'error',id:target.id,title:target.title,text:message,at:Date.now()})}}
    }finally{working.current=false;setBusy(false)}
  }
  const saveRename=async(title:string):Promise<void>=>{
    if(!rename||working.current)return
    working.current=true;setBusy(true);setError(null)
    try{
      const next=normalizeSessionTitle(title),current=fresh(rename)
      if(isLive&&bridge)await bridge.renameSession(current.id,next)
      else changeDemoSession(current.id,{title:next,archivedAt:current.archived?(getDemoSessionChanges()[current.id]?.archivedAt??1):null})
      setRename(null);setToast({kind:'rename',id:current.id,title:next,at:Date.now()})
      resolveResult(true)
      requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true})})
    }catch(error){setError(translateMessage((error as Error).message)||t('session.retry'))}
    finally{working.current=false;setBusy(false)}
  }
  const request=(action:Action,target:SessionTarget):void=>{
    if(working.current)return
    const current=fresh(target);setError(null)
    returnFocus.current=document.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(current.id)}"][aria-selected="true"]`) ?? document.querySelector<HTMLElement>(`[data-session-row="${CSS.escape(current.id)}"] > button`)
    if(action==='rename')setRename(current)
    else if(action==='delete'||action==='archive'&&current.running)setConfirm({action,target:current})
    else void apply(action,current,false)
  }
  const selected=confirm?fresh(confirm.target):null
  const requestResult=(action:Action,target:SessionTarget):Promise<boolean>=>{
    if(working.current||confirm||rename||pendingResult.current)return Promise.resolve(false)
    return new Promise(resolve=>{pendingResult.current=resolve;request(action,target)})
  }
  return <Context.Provider value={{request,requestResult,busy}}>{children}
    {rename&&<RenameSessionDialog key={rename.id} title={rename.title} busy={busy} error={error} onSave={title=>void saveRename(title)} onCancel={cancelConfirm}/>}
    {confirm&&selected&&<ConfirmDialog title={t(confirm.action==='delete'?'session.deleteTitle':'session.archiveTitle',{title:selected.title})} description={<><p>{t(confirm.action==='delete'?'session.deleteDescription':'session.archiveDescription')}</p>{(selected.running||confirm.target.running)&&<p className="mt-2 text-warn">{t('session.stopDescription')}</p>}</>} confirmLabel={busy?t('session.busy'):t(confirm.action==='delete'?'session.delete':'session.archive')} cancelLabel={t('session.cancel')} busy={busy} error={error} danger={confirm.action==='delete'} onConfirm={()=>void apply(confirm.action,selected,true)} onCancel={cancelConfirm}/>}
    {toast&&<div role="status" aria-live="polite" data-session-toast className="fixed bottom-6 left-1/2 z-[90] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-line-card bg-popover px-4 py-3 text-list text-fg shadow-menu">
      <span className="min-w-0 break-words">{toast.kind==='error'?toast.text:t(TOAST_KEYS[toast.kind],{title:toast.title})}</span>
      {toast.kind==='archive'&&<button disabled={busy} className="shrink-0 text-accent-fg underline" onClick={()=>void apply('restore',{id:toast.id,title:toast.title,archived:true,running:false},false)}>{t('session.undo')}</button>}
      <button aria-label={t('session.dismiss')} onClick={()=>setToast(null)} className="shrink-0 rounded-sm p-1 text-fg-muted hover:bg-hover"><X size={14}/></button>
    </div>}
  </Context.Provider>
}
