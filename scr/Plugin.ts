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
import {addTestCommands} from '../utils.test'

export default class IndexPlugin extends Plugin {
  settings: IndexPluginSettings = DefaultPluginSettings//TODO no proxy here?
  marker: Marker = new Marker(this.app, this)

  /// PLUGIN SETUP ///
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
      // Restores persistent marking of modified files
      this.marker.restoreMarks()
    })
    
    // Performs index check if it should be performed on startup
    this.settings.startupCheck && this.app.workspace.onLayoutReady(() => this.validateIndex())
    
    process.env.NODE_ENV=='development' && addTestCommands(this)//TODO remove?
  }
  async onunload() {
    // Removes some DOM listeners of Marker
    this.marker.cleanUp()
  }

  /// UTILS ///
  private loadSettings = async() => {
    try {
      this.settings = this._makeSettingsProxy(PluginSettingsSchema.parse(await this.loadData()))
    } catch (e) {
      this.settings = this._makeSettingsProxy(this.settings)
      console.log('Error restoring settings', e)
    }
  }
  private saveSettings = ()=>this.saveData(PluginSettingsSchema.parse(this.settings))

  // Wraps setting in Proxy object to resave settings every time they are modified
  private _makeSettingsProxy= (target:IndexPluginSettings)=>{
    const debSaveSettings = debounce(()=>this.saveSettings(),100)
    return new Proxy(target,{
      set:(object, key:keyof IndexPluginSettings,value)=>{
        (object[key] as any) = value
        debSaveSettings()
        return true
      }
    })
  }
  
  // Creates regexp for every folder to check all forders files against it (to locate index file)
  private _getRegExp = memoize(
    (format: string, placeHolder: string, replacer: string) => {
      const replaced = format.replace(placeHolder, replacer)
      const useRegexInput = replaced.match(/^\/(.*)\/$/)
      return new RegExp(useRegexInput ? useRegexInput[1] : `^${escapeRegExp(replaced)}$`)
    },
    (...args) => args.join()
  )
  
  // Checks if a file is an index file
  private matchIndex(file: TFile, folder: TFolder, vaultName?: string) {
    const useVault = vaultName && this.settings.useRootIndexFileFormat

    const regex = this._getRegExp(
      useVault ? this.settings.rootIndexFileFormat : this.settings.indexFileFormat,
      useVault ? placeHolders.VAULT : placeHolders.FOLDER,
      useVault ? vaultName : folder.name || vaultName || ''//TODO empty not good
    )
    return regex.test(file.basename) || regex.test(file.name)
  }
  
  // Formats links according to settings
  private formatLinks(links: string[]) {
    return '\n' + this.settings.outputLinksFormat.replace(placeHolders.LINKS, links.join('\n')) +'\n'//TODO replace all
  }
  
  // Determines how separate output file should be named for a folder (used for 'separate file' output method)
  private formatOutputFilePath(folder :TFolder, index:TFile){
    return normalizePath(`${folder.path}/${this.settings.outputFileFormat
      .replace(placeHolders.FOLDER, folder.name || (folder.isRoot() ? this.app.vault.getName() : ''))
      .replace(placeHolders.INDEX, index.basename)}.md`
    )
  }
  
  // Fix links to non-md files - removes '!' (embed) from the beginning and adds link text if non-wiki links are used
  private fixLink(link:string){
    const path = link.match(/^\!?\[\]\((.+)\)$/)?.[1]
    return path ? link.replace(/^\!?\[\]/,`[${path}]`) : link.replace(/^\!/,'')
  }

  /// MAIN ACTION ///
  private indexedFolders: {
    indexFile: TFile,
    children: TFile[],
    missingChildren: TFile[],
    folder: TFolder
  }[] = []
  
  // Main function that is recurcively called for every folder in vault
  private processFolder(folder: TFolder, upTreeIndex = false){
    // Finds index file in a folder (if present)
    const indexFile = folder.children.find(
      (file): file is TFile => file instanceof TFile && this.matchIndex(file, folder, folder.isRoot() ? this.app.vault.getName() : undefined)
    )

    // Determines if current function call should send its children up to the caller, based on Nesteted mode setting
    const shouldReturnChildren :boolean = upTreeIndex && (
      this.settings.nestedMode == NestedModes.ALL ||
      this.settings.nestedMode == NestedModes.NO_INDEX && !indexFile
    )
    // Determines how separate output file (for repective output mode) should be named 
    const optinalOutputFilePath = indexFile && this.settings.outputMode == OutputModes.FILE ? this.formatOutputFilePath(folder, indexFile) : undefined
    // Populates an array of childeren returned by recursive calls to nested folders (if any are returned)
    const optinalGrandChildren :TFile[] = folder.children.filter(
      (child): child is TFolder => child instanceof TFolder
    ).map(
      folder => this.processFolder(folder, !!indexFile || upTreeIndex)
    ).flat()
    
    // Populates an array with folders children and possible grandchildren
    const children :TFile[] = indexFile || shouldReturnChildren ?
      folder.children.filter(
        (child): child is TFile => 
          child instanceof TFile && 
          (child.extension == 'md' || this.settings.allFiles) &&
          child != indexFile && 
          child.path !== optinalOutputFilePath
      ).concat(optinalGrandChildren) :
      []
    
    // Determines wich links should be present in index file, but are not
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
    // Build indexes
    this.indexedFolders = []
    this.processFolder(this.app.vault.getRoot())

    // Output Result
    const timeStamp = Date.now()
    // Timestamp to be used when modifing or creating files, Lets plugin 'remember' wich files were modified/created by it
    // to avoid unmark events to be trigger by the change and for some other uses (see rewriteToFile())
    this.settings.timeStamps = [...this.settings.timeStamps, timeStamp]
    let nFolders = 0; let nChildren = 0

    this.indexedFolders.filter(folder => !!folder.missingChildren.length).forEach( indexedFolder => {
      // Creates text of missing links
      const missingLinks = indexedFolder.missingChildren
        .map(child => this.app.fileManager.generateMarkdownLink(child, indexedFolder.indexFile.parent?.path || ''))
        .map(link=>this.fixLink(link)) //TODO non-wiki link for non-notes are empty text
      
      // Ouputs result accordin to output mode and marks modified files
      if (this.settings.outputMode == OutputModes.INDEX) {
        this.addToFile(indexedFolder.indexFile,  this.formatLinks(missingLinks), timeStamp)
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
    new Notice(nChildren ? `Indexes checked: ${nChildren} missing links in ${nFolders} folders.` : 'Indexes checked: no missing links!' )
  },1000, true)
  
  // Used to create file or overwrite exicting file for 'separate file' output mode
  private async rewriteToFile(path: string, data: string, t: DataWriteOptions) {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file == null) {
      this.app.vault.create(path, data, t)
    } else if (file instanceof TFile) {
      if (this.settings.timeStamps.includes(file.stat.ctime) || this.settings.timeStamps.includes(file.stat.mtime)) {
        this.app.vault.modify(file, data, { mtime: t.mtime })
      } else {
        // If the file that should be overwritten was not created or modified by the Plugin, its moved to trash first to avoid 
        // accidental loss of user's data.
        await this.app.vault.trash(file, true)
        this.app.vault.create(path, data, t)
      }
    }
  }
  
  // Used to add results to index file - append or prepend
  private async addToFile(file:TFile, data:string, mtime: number){
    this.app.vault.process(file, content=>{
      return this.settings.prependToIndex ? data+content : content+data
    },{mtime})
  }
}
