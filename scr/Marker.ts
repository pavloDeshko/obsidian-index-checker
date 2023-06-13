import { App, TFile, LinkCache, debounce, TFolder } from 'obsidian'
import isEqual from 'lodash.isequal'
import IndexPlugin from './Plugin'
import { BenchMark } from './test'

const bench = process.env.NODE_ENV=='development' ? new BenchMark() :null

export const MARK_CLASS_NAME = 'index-checker-marked'

// Indicates when a particular mark should be removed - on file empty of links (used for 'separate file' output mode)
// or after it's touched (for 'add to index file' mode)
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
    // Calls process() every time dom structure is of file explorers is change. See process() belowz
    this.observer = new MutationObserver(() =>this.process())

    this.app.workspace.onLayoutReady(()=>this.setContainers())

    // Listens to events that could mean file should be unmarked
    this.app.workspace.onLayoutReady(()=>{
      this.app.metadataCache.on('changed',(file,_,cache)=>this.unmarkIfNeeded(file, cache.links))
      this.app.vault.on('rename', file=>file instanceof TFile && this.unmarkFile(file.path))
      this.app.vault.on('delete',file=>file instanceof TFile && this.unmarkFile(file.path))
    })
    this.app.workspace.on('layout-change', ()=>this.setContainers())
  }
  
  // Setup of explorer type dom elements
  private setContainers() {
    const newContainers = this.app.workspace.getLeavesOfType('file-explorer').map(l => l.view.containerEl)
    if (this.containers !== null && !isEqual(this.containers, newContainers)) {
      this.observer.disconnect()
      this.containers = []

      // Setup of listeners for new elements are added, like when folder is expanded
      newContainers.forEach(element => {
        this.observer.observe(element, { childList: true, subtree: true })
        this.containers!.push(element)//TODO why you need ! ?
      })
    }
  }
  
  // Methods to modify dom elements to display markings. Style are in styles.css file
  private _mark(element: HTMLElement) { element.classList.add(MARK_CLASS_NAME)}
  private _unmark(element: HTMLElement) { element.classList.remove(MARK_CLASS_NAME)}
  private _isMarked(element: HTMLElement){ return  element.classList.contains(MARK_CLASS_NAME)}

  private process = debounce((rebuildIndex = false)=>{
    // Constructs a Set (unique values) of ancestoral folders of all marked files
    // and adds them to folders index.
    if(rebuildIndex){
      this.plugin.settings.persistentMarks = [...this.index.entries()]
      
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
    }

    this.containers !== null && !this.containers.length && this.setContainers()
    
    // Gets all elements with 'data-path' attribute and makes sure they are marked (or not) accordith to index.
    // Yes, it's fast. I've benchmarked it with large vault and large number of marked files.
    // Function is debounced primarly to avoid multiple redundant calls if methods like markFile() is
    // called in some sort of a loop.
    this.containers?.forEach(c=>{
      Array.from(c.querySelectorAll('[data-path]') || []).forEach(el=>{
        if(!(el instanceof HTMLElement)){return}
        
        const path = el.dataset['path']
        const inIndex = path !== undefined ? this.index.get(path) || this.foldersIndex.has(path) : undefined
        const marked = this._isMarked(el)

        inIndex && !marked && this._mark(el)
        !inIndex && marked && this._unmark(el)
      })
    })
  },50)
  
  // Unmarks modified file if it's a) marked  b) should be unmarked according to type of marking c) was modified not by this Plugin
  private unmarkIfNeeded(file: TFile, links? :LinkCache[]){
    const type = this.index.get(file.path)
    type && 
      !this.plugin.settings.timeStamps.includes(file.stat.mtime) && (type==MarkType.ON_TOUCH || !links?.length) &&
      this.unmarkFile(file.path)
  }
  
  /// PUBLIC METHODS ///

  markFile(path: string, unmarkType = MarkType.ON_TOUCH) {
    this.index.set(path, unmarkType)
    this.process(true)
  }
  
  unmarkFile(path: string){
    this.index.delete(path)
    this.process(true)
  }

  unmarkAll() {
    this.index = new Map()
    this.process(true)
  }
  
  // Restore persistent marks from Plugin's data
  restoreMarks() {
      this.index = new Map(this.plugin.settings.persistentMarks)
      this.process(true)
  } 

  cleanUp() {
    this.observer.disconnect()
    this.containers = null
  }
}