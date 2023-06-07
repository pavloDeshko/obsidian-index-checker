import { TFile, TFolder, debounce } from 'obsidian'
import IndexPlugin from './Plugin'

export class BenchMark{
  testN = 0
  testT = 0
  private lastTime = Date.now()
  constructor(debounceTime = 1000){
    this.out = debounce(()=>{
      console.log(`Called in last ${debounceTime/1000} seconds: ${this.testN}, took s: ${Math.round(this.testT*1000)/ 1000} `)
      this.testN = this.testT = 0
    },debounceTime,true)  
  }
  private out :()=>void
  
  start(){
    this.lastTime = Date.now()
  }
  end(){
    this.testN ++
    this.testT += (Date.now()-this.lastTime)/1000
    this.out()
  }
}

export const setupTests = (plugin:IndexPlugin)=>{
  plugin.addCommand({
    id: 'test-nodes',
    name: 'Index-Checker: create test nodes',
    callback: async() => {
      const vault = plugin.app.vault

      const existing = vault.getAbstractFileByPath('test-folder')
      existing && (vault.delete(existing))

      await vault.createFolder('test-folder')
      const folder = vault.getAbstractFileByPath('test-folder')
      
      folder && [...Array(1000)].forEach((_,n)=>{
        vault.create(folder.path+'/folder_'+n+'.md','loren ipsun blabalbal')
      })
    }
  })

  plugin.addCommand({
    id: 'test-mark',
    name: 'Index-Checker: mark all nodes in test-folder',
    callback: async() => {
      const vault = plugin.app.vault

      const folder = vault.getAbstractFileByPath('test-folder')
      folder instanceof TFolder && 
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.markFile(child.path))
    }
  })
  
  plugin.addCommand({
    id: 'test-unmark',
    name: 'Index-Checker: unmark all nodes in test-folder',
    callback: async() => {
      const vault = plugin.app.vault

      const folder = vault.getAbstractFileByPath('test-folder')
      folder instanceof TFolder && 
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.unmarkFile(child.path))
    }
  })
}