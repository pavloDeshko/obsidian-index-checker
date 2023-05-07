import { normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian'
import IndexPlugin from './Plugin'

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
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.markFile(child,Date.now(),true))
      folder instanceof TFolder && setTimeout(()=>{
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.unmarkFile(child))
      }, 1e3*15)
    }
  })

}