import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpConfig } from '@pixelsky/protocol'
import { MASKED_SECRET } from '@pixelsky/engine'
export interface Cipher { available():boolean; encrypt(text:string):string; decrypt(text:string):string }
export class Secrets {
  private data:Record<string,Record<string,string>>={}
  warning:string|null=null
  private unreadable=false
  constructor(private readonly dir:string,private readonly cipher:Cipher) {
    const file=join(dir,'secrets.json')
    if(existsSync(file)&&cipher.available())try{this.data=JSON.parse(cipher.decrypt(readFileSync(file,'utf8')))}catch{this.warning='已有凭据无法解密，请重新填写；原加密文件保留。';this.unreadable=true}
  }
  get persistent():boolean{return this.cipher.available()}
  private save():void {
    if(!this.persistent)return
    mkdirSync(this.dir,{recursive:true});const file=join(this.dir,'secrets.json'),temp=file+'.tmp'
    if(this.unreadable&&existsSync(file)){copyFileSync(file,file+'.unreadable-'+Date.now()+'.bak');this.unreadable=false}
    writeFileSync(temp,this.cipher.encrypt(JSON.stringify(this.data)),{mode:0o600});renameSync(temp,file)
  }
  put(id:string,config:McpConfig):McpConfig {
    const values:Record<string,string>={}
    const map=(group:'env'|'headers'):Record<string,string> => Object.fromEntries(Object.entries(config[group]??{}).map(([key,value])=>{
      const name=group+':'+key,resolved=value===MASKED_SECRET?this.data[id]?.[name]:value
      if(resolved===undefined)throw new Error('凭据已失效，请重新填写 '+key)
      values[name]=resolved;return [key,MASKED_SECRET]
    }))
    const redacted={...config,env:map('env'),headers:map('headers')}
    this.data[id]=values;this.save();return redacted
  }
  resolve(id:string,config:McpConfig):McpConfig {
    const map=(group:'env'|'headers'):Record<string,string>=>Object.fromEntries(Object.entries(config[group]??{}).map(([key,value])=>{
      if(value!==MASKED_SECRET)return [key,value]
      const found=this.data[id]?.[group+':'+key]
      if(found===undefined)throw new Error('凭据未保存，请重新填写 '+key)
      return [key,found]
    }))
    return {...config,env:map('env'),headers:map('headers')}
  }
  remove(id:string):void{delete this.data[id];this.save()}
}
