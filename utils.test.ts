import { TFile, TFolder, debounce} from 'obsidian'
import {CanvasData, CanvasFileData, AllCanvasNodeData} from 'obsidian/canvas'
import IndexPlugin from './scr/Plugin'

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

export const addTestCommands = async(plugin:IndexPlugin)=>{
  const vault = plugin.app.vault
  plugin.addCommand({
    id: 'test-notes',
    name: 'Recreate test notes tree',
    callback: async() => {
      const vault = plugin.app.vault
      
      const root = vault.getRoot()
      ///clear
      //console.log('children:',root.children)
      for(const ch of [...root.children]){
        !ch.path.contains('png') && await vault.delete(ch,true)
      }
      ///root file
      await makeFiles(root)

      ///Nested Indexed
      const IndexedFolder = await makeFolder('IndexedFolder',root)
      await makeFiles(IndexedFolder)
      await makeFiles(await makeFolder('IndexedFolderNested', IndexedFolder))
      
      ///Not indexed

      await makeFiles(await makeFolder('NoIndexFolderNested',
        await makeFiles(await makeFolder('NoIndexedFolder',root),false)
      ),false)

      //Mixed
      await makeFiles(await makeFolder('MixedIndexed',
        await makeFiles(await makeFolder('MixedNoIndex',root),false)
      ),true)

/*       //const existing = vault.getAbstractFileByPath('test-folder')
      //existing && (await vault.delete(existing))

      //await vault.createFolder('test-folder')
      const folder = vault.getAbstractFileByPath('test-folder')
      
      folder && [...Array(1000)].forEach((_,n)=>{
        //vault.create(folder.path+'/node'+n+'.md','loren ipsun blabalbal')
        vault.create(folder.path+'/folder_'+n+'.canvas','{"nodes":[],"edges":[]}')
      }) */
    }
  })
  
  plugin.addCommand({
    id: 'test-mark',
    name: 'Mark all nodes in test-folder',
    callback: async() => {
      const vault = plugin.app.vault

      const folder = vault.getAbstractFileByPath('test-folder')
      folder instanceof TFolder && 
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.markFile(child.path))
    }
  })
  
/*   plugin.addCommand({
    id: 'test-unmark',
    name: 'Unmark all nodes in test-folder',
    callback: async() => {
      const vault = plugin.app.vault

      const folder = vault.getAbstractFileByPath('test-folder')
      folder instanceof TFolder && 
        folder.children.forEach(child=>child instanceof TFile && plugin.marker.unmarkFile(child.path))
    }
  }) */

  const makeFolder = async(name:string,parent :TFolder)=>{
    console.log('creating : ', name)
    return vault.createFolder((parent.path  =='/' ? parent.path : parent.path+'/')+name)
  }

  const makeFiles = async(folder:TFolder, withIndexes=true)=>{
    const name = folder.isRoot() ? vault.getName() : folder.name
    const indexes = withIndexes? [
      'Index'+'.md',
      name+'.md',
      '_' + name+'.md',
      name+'.canvas',
      '_' + name+'.canvas',
    ]:[]
    for(const path of indexes){await vault.create(folder.path+'/'+path,JSON.stringify({nodes:[],edges:[]}))}

    const files = [
/*       name+'_image1.png',
      name+'_image2'+'.png',
      name+'_image3'+'.png', */
      name+'_file1'+'.md',
      name+'_file2'+'.md',
      name+'_file3'+'.md'
    ]
    
    for(const path of files){await vault.create(folder.path+'/'+path,'')}

    return folder
  }
  
}