import { App, TFile, TAbstractFile, CachedMetadata } from 'obsidian'
import uniq from 'lodash.uniq'
import IndexPlugin from './Plugin'
/* 
.nav-file-title-content[data-path="bar.md"]{
  color:red;
}*/
export default class Marker {
  app: App
  plugin: IndexPlugin
  container = {} as {element ?:Element, observer ?:MutationObserver}
  index: Map<TFile, { element ?:HTMLElement, ignoreTimeStamp?: number, unmarkOnEmpty?: boolean }> = new Map()

  constructor(app: App, plugin: IndexPlugin) {
    this.app = app
    this.plugin = plugin

    this.app.workspace.onLayoutReady(this.setContainer)
    this.app.workspace.onLayoutReady(()=>this.app.metadataCache.on('changed',(file,_,cache)=>this.unmarkFile(file,cache)))
  }

  private setContainer = () =>{
    this.container.observer && this.container.observer.disconnect()
    this.container.element = this.app.workspace.getLeavesOfType('file-explorer')[0]?.view.containerEl

    if (this.container) {
      this.container.observer = new MutationObserver((mutations) => {
        console.log('mutation: ',mutations)
        const addedNodes = mutations.flatMap(mutation => Array.from(mutation.addedNodes))
        addedNodes.filter(
          (added): added is HTMLElement => added instanceof HTMLElement && 
            (added.classList.contains("nav-folder-children") || added.classList.contains("nav-file"))
        ).forEach(el=>this.markRevealed(el))
      })
      this.container.observer.observe(this.container.element, { childList: true, subtree: true })
    }
  }

  private getElement(path: string, sub ?:Element) {
    this.container.element && document.body.contains(this.container.element) || this.setContainer()
    const result = (sub || this.container.element)?.querySelector(`[data-path="${path}"]`)
    //console.log('container', this.container, 'element:', result)
    return result instanceof HTMLElement ? result : undefined
  }
/*   private hasLinks(file:TFile){
    return !!this.app.metadataCache.getFileCache(file)?.links?.length
  } */

  private mark(element: HTMLElement) { element.style.color = 'red' }
  private unmark(element: HTMLElement) { element.style.removeProperty('color') }

  markFile(file: TFile, ignoreTimeStamp?: number, unmarkOnEmpty? :boolean) {
    const element = this.getElement(file.path)
    console.log('marking file: ', file, 'element: ', element)
    element && this.mark(element)
    this.index.set(file, {element, ignoreTimeStamp, unmarkOnEmpty})
    return !!element
  }

  private markRevealed(sub :HTMLElement){
    this.index.forEach((entry,key)=> {
      const element = !entry.element && this.getElement(key.path,sub)
      if(element){
        console.log('marking revealed: file ',key, ' element ' ,element)
        this.mark(element)
        entry.element = element
      }
    })
  }

  private markAdded(elements :HTMLElement[]){
    elements.forEach(el=>this.markRevealed(el))
  }

  unmarkFile(file: TAbstractFile, cache? :CachedMetadata) {
    const entry = file instanceof TFile && this.index.get(file)
    if (entry && file.stat.mtime != entry.ignoreTimeStamp && (!entry.unmarkOnEmpty || !cache?.links?.length)) {
      console.log('UNmarking: ', entry)
      entry.element && this.unmark(entry.element)
      this.index.delete(file)
      this.index.size == 0 && console.log('Marker index empty ', this.index)
      return true
    }
    return false
  }

  unmarkAll() {
    [...this.index.values()].forEach(entry => entry.element && this.unmark(entry.element))
    this.container.observer?.disconnect()
    this.index = new Map()
  }

  dehydrate() {
    this.plugin.settings.persistentMarks = [...this.index.keys()].map(file => file.path)
  }

  rehydrate() {
    setTimeout(() =>
      this.plugin.settings.persistentMarks.forEach(path => {
        const file = app.vault.getAbstractFileByPath(path)
        file instanceof TFile && this.markFile(file)
      }) 
    ,500)
  }
}