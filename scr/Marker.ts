import { App, TFile, LinkCache, debounce, TFolder } from 'obsidian'
import isEqual from 'lodash.isequal'
import IndexPlugin from './Plugin'
import { BenchMark } from './test'

const bench = process.env.NODE_ENV=='development' ? new BenchMark() :null

export const MARK_CLASS_NAME = 'index-checker-marked'

export enum MarkType{
  ON_EMPTY = "ON_EMPTY",
  ON_TOUCH = "ON_TOUCH"
}

export default class Marker {
  app: App
  plugin: IndexPlugin
  containers: HTMLElement[] | null = []
  observer: MutationObserver
  index: Map<string, MarkType> = new Map()
  foldersIndex: Set<string> = new Set()

  constructor(app: App, plugin: IndexPlugin) {
    this.app = app
    this.plugin = plugin
    this.observer = new MutationObserver(() =>this.processDom())

    this.app.workspace.onLayoutReady(()=>{
      console.log('layout ready')
      this.setContainers()
    })
    this.app.workspace.onLayoutReady(()=>{
      this.app.metadataCache.on('changed',(file,_,cache)=>this.tryUnmarkFile(file, cache.links))
      this.app.vault.on('rename', file=>file instanceof TFile && this.unmarkFile(file.path))
      this.app.vault.on('delete',file=>file instanceof TFile && this.unmarkFile(file.path))
    })
    this.app.workspace.on('layout-change', ()=>this.setContainers())
  }

  private setContainers() {
    const newContainers = this.app.workspace.getLeavesOfType('file-explorer').map(l => l.view.containerEl)
    if (this.containers !== null && !isEqual(this.containers, newContainers)) {
      this.observer.disconnect()
      this.containers = []

      newContainers.forEach(element => {
        this.observer.observe(element, { childList: true, subtree: true })
        this.containers!.push(element)//TODO why you need ! ?
      })
    }
  }
  
  private _mark(element: HTMLElement) { element.classList.add(MARK_CLASS_NAME)}
  private _unmark(element: HTMLElement) { element.classList.remove(MARK_CLASS_NAME)}
  private _isMarked(element: HTMLElement){ return  element.classList.contains(MARK_CLASS_NAME)}

  private processDom = debounce(()=>{
    //bench?.start()
    this.containers !== null && !this.containers.length && this.setContainers()

    this.containers?.forEach(c=>{
      Array.from(c.querySelectorAll('[data-path]') || []).forEach(el=>{
        if(!(el instanceof HTMLElement)){return}
        
        const path = el.dataset['path']
        const inIndex = path !== undefined ? this.index.get(path) || this.foldersIndex.has(path) : undefined
        const marked = this._isMarked(el)

        inIndex && !marked && this._mark(el)
        !inIndex && marked && this._unmark(el)
      })
    //bench?.end()
    })
  },50)

  private process = debounce(()=>{
    bench?.start()
    const traverseUp =(folder:TFolder)=>{
      if(folder.path == '/' || this.foldersIndex.has(folder.path)){
        return
      }
      this.foldersIndex.add(folder.path)
      folder.parent && traverseUp(folder.parent)
    }
    this.foldersIndex = new Set();
    [...this.index.keys()].forEach(path=>{
      const file = this.app.vault.getAbstractFileByPath(path)
      file instanceof TFile && file.parent && traverseUp(file.parent)
    })
    bench?.end()
    this.processDom()
  },50)

  private tryUnmarkFile(file: TFile, links? :LinkCache[]){
    const type = this.index.get(file.path)
    type && 
      !this.plugin.settings.timeStamps.includes(file.stat.mtime) && (type==MarkType.ON_TOUCH || !links?.length) &&
      this.unmarkFile(file.path)
  }

  markFile(path: string, unmarkType = MarkType.ON_TOUCH) {
    this.index.set(path, unmarkType)
    this._saveMarks()
    this.process()
  }
  
  unmarkFile(path: string){
    this.index.delete(path)
    this._saveMarks()
    this.process()
  }

  unmarkAll() {
    this.index = new Map()
    this._saveMarks()
    this.process()
  }

  _saveMarks = ()=>{
    this.plugin.settings.persistentMarks = [...this.index.entries()]
  }//,100, true)
  
  restoreMarks() {
      this.index = new Map(this.plugin.settings.persistentMarks)
      //console.log('marks restored:', this.index)
      this.process()
  } 

  cleanUp() {
    console.log('cleaned up')
    this.observer.disconnect()
    this.containers = null
  }
}