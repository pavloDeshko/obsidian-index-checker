import { DataWriteOptions, debounce, normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian'
import diff from 'lodash.differencewith'
import escapeRegExp from 'lodash.escaperegexp'
import memoize from 'lodash.memoize'

import IndexPluginSettingsTab, { 
  IndexPluginSettings, 
  PluginSettingsSchema, 
  DefaultPluginSettings,
  NestedModes, 
  OutputModes, 
  placeHolders 
} from "./SettingsTab"
import Marker,{MarkType} from './Marker'
import {setupTests} from './test'
import { link } from 'fs'

export default class IndexPlugin extends Plugin {
  settings: IndexPluginSettings = DefaultPluginSettings//TODO no proxy here?
  marker: Marker = new Marker(this.app, this)

  //////  Setup  //////
  async onload() {
    await this.loadSettings()

    this.addSettingTab(new IndexPluginSettingsTab(this.app, this))

    this.addRibbonIcon('folder-check', 'Check indexes', (evt: MouseEvent) => {
      this.validateIndex()
    }).addClass('index-validator-plugin-ribbon-icon')

    this.addCommand({
      id: 'check-indexes',
      name: 'Check indexes',
      callback: () => {
        this.validateIndex()
      }
    })

    this.app.workspace.onLayoutReady(() => {
      //console.log('persistent:', this.settings.persistentMarks)
      this.marker.restoreMarks()
    })

    this.settings.startupCheck && this.app.workspace.onLayoutReady(() => this.validateIndex())

    process.env.NODE_ENV=='development'&&setupTests(this)
  }
  async onunload() {
    //this.marker.saveMarks(), 
    this.marker.cleanUp()
    //this.settings.timeStamps = this.settings.timeStamps.slice(-100)
    //this.saveData(PluginSettingsSchema.parse(this.settings))
    //console.log('saved settings: ', this.settings)
  }

  ////// Utils //////
  private loadSettings = async() => {
    try {
      this.settings = this._makeSettingsProxy(PluginSettingsSchema.parse(await this.loadData()))
      console.log('settings retrieved: ', this.settings)
    } catch (e) {
      this.settings = this._makeSettingsProxy(this.settings)
      console.log('Error parsing settings', e)
    }
  }
  private saveSettings = ()=>this.saveData(PluginSettingsSchema.parse(this.settings)) //debounce(()=>{this.saveData(PluginSettingsSchema.parse(this.settings));console.log('saved called')},100)
  
  private _makeSettingsProxy= (target:IndexPluginSettings)=>{
    const debSaveSettings = debounce(()=>{this.saveSettings();console.log('saved called')},100)
    return new Proxy(target,{
      set:(object, key:keyof IndexPluginSettings,value)=>{
        (object[key] as any) = value
        debSaveSettings() //this.saveSettings()
        return true
      }
    })
  }

  private _getRegExp = memoize(
    (format: string, placeHolder: string, replacer: string) => {
      const replaced = format.replace(placeHolder, replacer)
      const useRegexInput = replaced.match(/^\/(.*)\/$/)
      return new RegExp(useRegexInput ? useRegexInput[1] : `^${escapeRegExp(replaced)}$`)
    },
    (...args) => args.join()
  )
  
  private matchIndex(file: TFile, folder: TFolder, vaultName?: string) {
    const useVault = vaultName && this.settings.useRootIndexFileFormat

    const regex = this._getRegExp(
      useVault ? this.settings.rootIndexFileFormat : this.settings.indexFileFormat,
      useVault ? placeHolders.VAULT : placeHolders.FOLDER,
      useVault ? vaultName : folder.name || vaultName || ''//TODO empty not good
    )
    return regex.test(file.basename) || regex.test(file.name)
  }

  private formatLinks(links: string[]) {
    return '\n' + this.settings.outputLinksFormat.replace(placeHolders.LINKS, links.join('\n')) +'\n'//TODO replace all
  }

  private formatOutputFilePath(folder :TFolder, index:TFile){
    return normalizePath(`${folder.path}/${this.settings.outputFileFormat
      .replace(placeHolders.FOLDER, folder.name || (folder.isRoot() ? this.app.vault.getName() : ''))
      .replace(placeHolders.INDEX, index.basename)}.md`
    )
  }

  private fixLink(link:string){
    const path = link.match(/^\!?\[\]\((.+)\)$/)?.[1]
    return path ? link.replace(/^\!?\[\]/,`[${path}]`) : link.replace(/^\!/,'')
  }

  //////  Main action //////
  private indexedFolders: {
    indexFile: TFile,
    children: TFile[],
    missingChildren: TFile[],
    folder: TFolder
  }[] = []

  private processFolder(folder: TFolder, upTreeIndex = false){
    const indexFile = folder.children.find(
      (file): file is TFile => file instanceof TFile && this.matchIndex(file, folder, folder.isRoot() ? this.app.vault.getName() : undefined)
    )
    const shouldReturnChildren :boolean = upTreeIndex && (
      this.settings.nestedMode == NestedModes.ALL ||
      this.settings.nestedMode == NestedModes.NO_INDEX && !indexFile
    )
    const optinalOutputFilePath = indexFile && this.settings.outputMode == OutputModes.FILE ? this.formatOutputFilePath(folder, indexFile) : undefined
    
    const optinalGrandChildren :TFile[] = folder.children.filter(
      (child): child is TFolder => child instanceof TFolder
    ).map(
      folder => this.processFolder(folder, !!indexFile || upTreeIndex)
    ).flat()
    
    const children :TFile[] = indexFile || shouldReturnChildren ?
      folder.children.filter(
        (child): child is TFile => 
          child instanceof TFile && 
          (child.extension == 'md' || this.settings.allFiles) &&
          child != indexFile && 
          child.path !== optinalOutputFilePath
      ).concat(optinalGrandChildren) :
      []
    
    if (indexFile) {
      const missingChildren = diff(
        children,
        Object.keys(app.metadataCache.resolvedLinks[indexFile.path]),
        (file, link) => link === file.path
      )
      this.indexedFolders.push({indexFile, children, missingChildren, folder})
    }
    
    return shouldReturnChildren ? children : []
  }

  validateIndex = debounce(()=>{
    /// Build indexes ///
    this.indexedFolders = []
    //this.marker.unmarkAll()
    this.processFolder(this.app.vault.getRoot())
    //console.log(indexedFolders)
    /// Output Result ///
    const timeStamp = Date.now()
    this.settings.timeStamps = [...this.settings.timeStamps, timeStamp]//.push(timeStamp)
    let nFolders = 0; let nChildren = 0

    this.indexedFolders.filter(folder => !!folder.missingChildren.length).forEach(async (indexedFolder) => {
      const missingLinks = indexedFolder.missingChildren.map(
        child => this.app.fileManager.generateMarkdownLink(child, indexedFolder.indexFile.parent?.path || '')
      ).map(link=>this.fixLink(link)) //TODO non-wiki link for non-notes are empty text
  
      if (this.settings.outputMode == OutputModes.INDEX) {
        this.addToFile(indexedFolder.indexFile,  this.formatLinks(missingLinks), timeStamp)
        //this.app.vault.adapter.append(indexedFolder.indexFile.path, this.formatLinks(missingLinks), {mtime: timeStamp})
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile.path)

      }else if(this.settings.outputMode == OutputModes.FILE){
        const outputFilePath = this.formatOutputFilePath(indexedFolder.folder, indexedFolder.indexFile)
        this.rewriteToFile(outputFilePath, this.formatLinks(missingLinks), {mtime: timeStamp, ctime:timeStamp})
        this.settings.markIndexes && this.marker.markFile(outputFilePath, MarkType.ON_EMPTY)

      } else {
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile.path)

      }
      nFolders++; nChildren +=indexedFolder.missingChildren.length
    })
    //setTimeout(()=>console.log('index: ', this.indexedFolders),1000)
    new Notice(nChildren ? `Indexes checked: ${nChildren} missing links in ${nFolders} folders.` : 'Indexes checked: no missing links!' )
    //this.saveSettings()
  },1000, true)

  private async rewriteToFile(path: string, data: string, t: DataWriteOptions) {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file == null) {
      this.app.vault.create(path, data, t)
    } else if (file instanceof TFile) {
      if (this.settings.timeStamps.includes(file.stat.ctime)) {
        this.app.vault.modify(file, data, { mtime: t.mtime })
      } else {
        await this.app.vault.trash(file, true)
        this.app.vault.create(path, data, t)
      }
    }
  }
  private async addToFile(file:TFile, data:string, mtime: number){
    this.app.vault.process(file, content=>{
      return this.settings.prependToIndex ? data+content : content+data
    },{mtime})
  }
}
