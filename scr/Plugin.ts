import { Editor,DataWriteOptions, debounce, normalizePath, Notice, Plugin, TFile, TFolder, setIcon, ButtonComponent } from 'obsidian'
import diff from 'lodash.differencewith'
import escapeRegExp from 'lodash.escaperegexp'
import memoize from 'lodash.memoize'
//import {CanvasData, CanvasFileData} from 'obsidian/canvas'

import IndexPluginSettingsTab, { 
  IndexPluginSettings, 
  PluginSettingsSchema, 
  DefaultPluginSettings,
  NestedModes, 
  OutputModes, 
  placeHolders 
} from "./SettingsTab"
import Marker,{MarkType} from './Marker'
//import {addTestCommands} from '../utils.test'

const DELAY = 4e3

export default class IndexPlugin extends Plugin {
  settings: IndexPluginSettings = DefaultPluginSettings//TODO no proxy here?
  marker: Marker = new Marker(this.app, this)

  private workingNotice :HTMLElement | null = null
  private lastInput = 0

  /// PLUGIN SETUP ///
  async onload() {
    await this.loadSettings()

    this.addSettingTab(new IndexPluginSettingsTab(this.app, this))

    const ribbonButton = this.addRibbonIcon('folder-check', 'Check indexes', (evt: MouseEvent) => {
      this.validateIndex()
    })
    ribbonButton instanceof ButtonComponent && ribbonButton.setDisabled(true)
    //.addClass('index-validator-plugin-ribbon-icon')

    this.addCommand({
      id: 'check-indexes',
      name: 'Check indexes',
      callback: () => {
        this.validateIndex()
      }
    })
    this.addCommand({
      id: 'unmark-all',
      name: 'Unmark all files',
      callback: () => {
        this.marker.unmarkAll()
      }
    })

    // Tracks the time of last user interation with editor - used to delay check for metadata cache to update
    this.registerEvent(
      this.app.workspace.on('editor-change',debounce(()=>this.lastInput = Date.now(), 100))
    )//setIcon(this.addStatusBarItem(),'loader')

    this.app.workspace.onLayoutReady(() => {
      // Restores persistent marking of modified files
      this.marker.restoreMarks()
    })
    
    // Performs index check if it should be performed on startup
    this.settings.startupCheck && this.app.workspace.onLayoutReady(() => this.validateIndex())
    
    //process.env.NODE_ENV=='development' && addTestCommands(this)//TODO remove?
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
  
/*   // Creates regexp for every folder to check all forders files against it (to locate index file)
  private _getRegExp = memoize(
    (format: string, placeHolder: string, replacer: string) => {
      const replaced = format.replace(placeHolder, replacer)
      const regexContent = replaced.match(/^\/(.*)\/$/)
      return new RegExp(regexContent ? regexContent[1] : `^${escapeRegExp(replaced)}$`)
    },
    (...args) => args.join()
  ) */
  
  // Creates regex for one are multiple patterns, with placeholder and wildcard replaced
  private getRegex = (patterns:string[], holders:Record<string,string>)=>{
    const regsStrings = patterns.map(l=>l.trim()).filter(l=>l!=='').map((pattern:string)=>{
      // Replace patterns regardless of it's regex or not
      Object.keys(holders).forEach(k=>
        pattern = pattern.replace(new RegExp(escapeRegExp(k),'g'),holders[k])
      )
      // Extract regexp source if user used /../
      const regexContent =  pattern.match(/^\/(.*)\/$/)
      // Apply * (\* after regex escape) wildcards - used only if non regex is used
      const nonRegexContent = `^${escapeRegExp(pattern).replace(/\\\*/g,'.*')}$`
      // return content ready to be plugged into regex
      return regexContent ? regexContent[1] : nonRegexContent
    })
    console.log("regex created: ", regsStrings.length ? new RegExp(regsStrings.map(s=>'(?:'+s+')').join('|')) : null)
    return regsStrings.length ? new RegExp(regsStrings.map(s=>'(?:'+s+')').join('|')) : null
  }
  
/*   // Checks if a file is an index file
  private matchIndex(file: TFile, folder: TFolder, vaultName?: string) {
    const useVault = vaultName && this.settings.useRootIndexFileFormat

    const regex = this._getRegExp(
      useVault ? this.settings.rootIndexFileFormat : this.settings.indexFileFormat,
      useVault ? placeHolders.VAULT : placeHolders.FOLDER,
      useVault ? vaultName : folder.name || vaultName || ''//TODO empty not good
    )
    return regex.test(file.basename) || regex.test(file.name)
  }
   */
  // Formats links according to settings
  private formatLinks(links: string[]) {
    return '\n' + this.settings.outputLinksFormat.replace(placeHolders.LINKS, links.join('\n')) //TODO replace all
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
    const pathOnly = link.match(/^\!?\[\]\((.+)\)$/)?.[1]
    return pathOnly ? link.replace(/^\!?\[\]/,`[${decodeURIComponent(pathOnly)}]`) : link.replace(/^\!/,'')
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
    // Get values for placeholders
    type FolderHolders = {[key in typeof placeHolders[keyof typeof placeHolders]]?: string}
    const folderHolders :FolderHolders = {
      [placeHolders.VAULT]:this.app.vault.getName(), 
      [placeHolders.FOLDER]: folder.isRoot() ? this.app.vault.getName() : folder.name
    }

    // Finds index file in a folder (if present)
    const _indexRegex = this.getRegex(
      [folder.isRoot() && this.settings.useRootIndexFileFormat ? this.settings.rootIndexFileFormat : this.settings.indexFileFormat],
      folderHolders
    )
    const indexFile = folder.children.find(
      (file): file is TFile => file instanceof TFile && file.extension === 'md' &&
        (!!_indexRegex && (_indexRegex.test(file.basename) || _indexRegex.test(file.name)))
    )
    indexFile && (folderHolders[placeHolders.INDEX] = indexFile.name)

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
    
    // Splits ignore patterns and creates regex for all of them
    const _ignoreRegex = this.getRegex(
      this.settings.ignorePatterns.split(/(?:\r\n|\n|\x0b|\f|\r|\x85)+/),
      folderHolders
    )
    
    // Populates an array with folders children and possible grandchildren
    const children :TFile[] = indexFile || shouldReturnChildren ?
      folder.children.filter(
        (child): child is TFile => 
          child instanceof TFile && 
          child != indexFile && 
          child.path !== optinalOutputFilePath &&
          (child.extension == 'md' || this.settings.allFiles) &&
          !(_ignoreRegex && (_ignoreRegex.test(child.basename) || _ignoreRegex.test(child.name))) 
      ).concat(optinalGrandChildren) :
      []
    
    // Determines wich links should be present in index file, but are not
    if (indexFile) {
      const missingChildren = diff(
        children,
        Object.keys(this.app.metadataCache.resolvedLinks[indexFile.path]),
        (file, link) => link === file.path
      )
      this.indexedFolders.push({indexFile, children, missingChildren, folder})
    }
    
    return shouldReturnChildren ? children : []
  }
  
  validateIndex = ()=>{
    // Postpones check until DELAY (4 seconds) has passed from last user's editor input 
    // and displays 'in process' notice to be change to result later. Ie if no input was recorded
    // in last 4 seconds the check is performed immidiately. Gives Obsidian some time to update cache
    // and resolve links. 
    if(!this.workingNotice){
      this.workingNotice = new Notice('Checking indexes..', 30e3).noticeEl
      const delayLeft = DELAY - (Date.now() - this.lastInput)
      delayLeft > 0 ? setTimeout(()=>this._validateIndex(), delayLeft) : this._validateIndex()
    }
  }
  _validateIndex = ()=>{
    // Build indexes
    this.indexedFolders = []
    this.processFolder(this.app.vault.getRoot())

    // Output Result
    const timeStamp = Date.now()
    // Timestamp to be used when modifing or creating files, Lets plugin 'remember' wich files were modified/created by it
    // to avoid unmark events to be trigger by the change and for some other uses (see rewriteToFile())
    this.settings.timeStamps = [...this.settings.timeStamps, timeStamp]

    const foldersWithMissing = this.indexedFolders.filter(folder => !!folder.missingChildren.length)
    const totalMissingChildren = foldersWithMissing.reduce((n,f)=>n+f.missingChildren.length,0)

    foldersWithMissing.forEach( async indexedFolder => {
      // Creates text of missing links
      const missingLinks = indexedFolder.missingChildren
        .map(child => this.app.fileManager.generateMarkdownLink(child, indexedFolder.indexFile.parent?.path || ''))
        .map(link=>this.fixLink(link)) //TODO non-wiki link for non-notes are empty text
      
      // Ouputs result accordin to output mode and marks modified files
      if (this.settings.outputMode == OutputModes.INDEX) {
        await this.addToFile(indexedFolder.indexFile,  this.formatLinks(missingLinks), timeStamp)
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile.path)

      }else if(this.settings.outputMode == OutputModes.FILE){
        const outputFilePath = this.formatOutputFilePath(indexedFolder.folder, indexedFolder.indexFile)
        await this.rewriteToFile(outputFilePath, this.formatLinks(missingLinks), {mtime: timeStamp, ctime:timeStamp})
        this.settings.markIndexes && this.marker.markFile(outputFilePath, MarkType.ON_EMPTY)
        
      } else {
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile.path)

      }
    })
    // Displays resulet in Notice created when check was triggered
    const resultMessege = totalMissingChildren ? `Indexes checked: ${totalMissingChildren} missing links in ${foldersWithMissing.length} folders.` : 'Indexes checked: no missing links!'
    this.workingNotice && document.contains(this.workingNotice) ? this.workingNotice.setText(resultMessege) : new Notice(resultMessege, 30e3)
    this.workingNotice = null
  }
  
  // Used to create file or overwrite exicting file for 'separate file' output mode
  private async rewriteToFile(path: string, data: string, t: DataWriteOptions) {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file == null) {
      return this.app.vault.create(path, data, t)
    } else if (file instanceof TFile && (this.settings.timeStamps.includes(file.stat.ctime) || this.settings.timeStamps.includes(file.stat.mtime))) {
      return this.app.vault.modify(file, data, { mtime: t.mtime })
    } else if (file instanceof TFile) {
      // If the file that should be overwritten was not created or modified by the Plugin, its moved to trash first to avoid 
      // accidental loss of user's data.
      await this.app.vault.trash(file, true)
      return this.app.vault.create(path, data, t)
    }
  }
  
  // Used to add results to index file - append or prepend
  private async addToFile(file:TFile, data:string, mtime: number){
    return this.app.vault.process(file, content=>{
      return this.settings.prependToIndex ? data+content : content+data
    },{mtime})
  }
}
