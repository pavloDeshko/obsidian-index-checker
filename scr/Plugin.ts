import { Editor,DataWriteOptions, debounce, normalizePath, Notice, Plugin, TFile, TFolder, setIcon, ButtonComponent } from 'obsidian'
import diff from 'lodash.differencewith'
import escapeRegExp from 'lodash.escaperegexp'

import IndexPluginSettingsTab, { 
  IndexPluginSettings, 
  PluginSettingsSchema,
  NestedModes, 
  OutputModes, 
  tokens 
} from "./SettingsTab"
import Marker, {MarkType} from './Marker'
import CanvasUtils,{EMPTY_CANVAS} from './Canvas'
//import {addTestCommands} from '../utils.test'

const DELAY = 5e3
const CANVAS_DELAY = 2e3

type IndexedFolder = {
  index: TFile,
  //children: TFile[],
  missingChildren: TFile[],
  folder: TFolder,
  useCanvas: boolean,
  outputFilePath?: string
}
type TokenValues = {[key in typeof tokens[keyof typeof tokens]]?: string}

export enum ERROR_MESSAGES {
  WRITE_FILES = 'Seems like there\'s trouble saving results of the last index check :( Please, make sure your memory is not completly full and Index Checker plugin is updated',
  CANVAS_PARSE = 'Seems like there\'s trouble parsing(decoding) some of your .canvas index files :( Please, make sure Index Checker plugin is up to date and no program or plugin corrupts .canvas files in your Vault. Contact us if problem persists',
  CANVAS_READ = 'Seems like there\'s trouble reading some of your .canvas index files - check result might be incorrect :( Please, make sure Index Checker plugin is up to date and contact us if problem persists',
  OTHER_SYNC = 'Seems like plugin can\'t perform index check properly :(  Please, make sure Index Checker plugin is up to date and contact us if problem persists',
  NO_INDEX = 'No Index files were found!',
  REGEX = 'Seems like some RegExp you provided inside forward slashes  /.../ is invalid :( Double check it or contact us if problem persists'
} 

export default class IndexPlugin extends Plugin {
  settings :IndexPluginSettings = PluginSettingsSchema.parse({})//TODO no proxy here?
  marker :Marker = new Marker(this.app, this)
  canvas :CanvasUtils = new CanvasUtils(this.app, this)
  lastErrors : Set<ERROR_MESSAGES> = new Set()

  private working :{notice:Notice, delay:number} | null = null
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
      this.app.workspace.on('editor-change',debounce(()=>{this.lastInput = Date.now()}, 100))
    )
    //setIcon(this.addStatusBarItem(),'loader')

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
      console.error('Error restoring settings', e)
    }
  }
  private saveSettings = ()=>this.saveData(PluginSettingsSchema.parse(this.settings))
  restoreDefaultSettings = ()=>{
    this.settings = PluginSettingsSchema.parse({})
    this.saveSettings()
  }

  // Wraps setting in Proxy object to resave settings every time they are modified
  private _makeSettingsProxy= (target:IndexPluginSettings)=>{
    const debSaveSettings = debounce(()=>this.saveSettings(),100)
    return new Proxy(target,{
      set:(object, key:keyof IndexPluginSettings,value)=>{
        //console.log(key, value);
        (object[key] as any) = value
        debSaveSettings()
        return true
      }
    })
  }
  
  // Creates regex for pattern, with placeholder and wildcard replaced
  private getRegex = (pattern:string, tokens:Record<string,string>)=>{
      // Replace patterns regardless of it's regex or not
      Object.keys(tokens).forEach(k=>
        pattern = pattern.trim().replace(new RegExp(escapeRegExp(k),'g'),tokens[k])
      )
      // Extract regexp source if user used /../
      const regexContent =  pattern.match(/^\/(.+)\/$/)
      // Apply * (\* after regex escape) wildcards - used later only if non regex is used
      const nonRegexContent = `^${escapeRegExp(pattern).replace(/\\\*/g,'.*')}$`
      try{
        return new RegExp(regexContent ? regexContent[1] : nonRegexContent)
      }catch(err){
        console.error('Error parsing user\'s regex: ', pattern, err)
        this.lastErrors.add(ERROR_MESSAGES.REGEX)
        return new RegExp('^$')// fallback regex that doesn't match anything
      }
  }
  
  // Formats links according to settings
  private formatLinks(links: string[]) {
    return '\n' + this.settings.outputLinksFormat.replace(new RegExp(escapeRegExp(tokens.LINKS),'g'), links.join('\n')) 
  }
  
  // Determines how separate output file should be named for a folder (used for 'separate file' output method)
  private formatOutputFilePath(folder :TFolder, index:TFile, useCanvas :boolean){
    return normalizePath(`${folder.path}/${this.settings.outputFileFormat
      .replace(tokens.FOLDER, folder.name || (folder.isRoot() ? this.app.vault.getName() : ''))
      .replace(tokens.INDEX, index.basename)}${useCanvas? '.canvas' :'.md'}`
    )
  }
  
  // Fix links to non-md files - removes '!' (embed) from the beginning and adds link text if non-wiki links are used
  private fixLink(link:string){
    const pathOnly = link.match(/^\!?\[\]\((.+)\)$/)?.[1]
    return pathOnly ? link.replace(/^\!?\[\]/,`[${decodeURIComponent(pathOnly)}]`) : link.replace(/^\!/,'')
  }

  /// MAIN ACTION ///
  private indexedFoldersP: Promise<IndexedFolder>[] = []
  
  // Main function that is recurcively called for every folder in vault
  private processFolder(folder: TFolder, upTreeIndex = false){
    // Get values for placeholders, create regexes
    const tokensValues :TokenValues = {
      [tokens.VAULT]:this.app.vault.getName(), 
      [tokens.FOLDER]: folder.isRoot() ? this.app.vault.getName() : folder.name
    }

    const ignoreRegexs =  this.settings.ignorePatterns
      .split(/(?:\r\n|\n|\x0b|\f|\r|\x85)+/).map(l=>l.trim()).filter(l=>l!=='')
      .map(p=>this.getRegex(p, tokensValues))
    
    const indexRegex = this.getRegex(
      folder.isRoot() && this.settings.useRootIndexFileFormat ? this.settings.rootIndexFileFormat : this.settings.indexFileFormat,
      tokensValues
    )

    // Finds index file in a folder (if present), if canvas index is used, optional output file paths
    const indexFiles = folder.children.filter(
      (file): file is TFile => file instanceof TFile && ['md','canvas'].includes(file.extension) &&
        (indexRegex.test(file.basename) || indexRegex.test(file.name))
    )
    const useCanvases = indexFiles.map(index=>{
      return index.extension == 'canvas'
    }) 
    const outputPaths = indexFiles.map((index,i)=>{
      const mode = useCanvases[i] && this.settings.canvasMode !== null ? this.settings.canvasMode : this.settings.outputMode
      return mode == OutputModes.FILE ? this.formatOutputFilePath(folder, index, useCanvases[i]) : undefined 
    })
    const indexed = !!indexFiles.length

    // Determines if current function call should send its children up to the caller, based on Nesteted mode setting
    const shouldReturnChildren :boolean = upTreeIndex && (
      this.settings.nestedMode == NestedModes.ALL ||
      this.settings.nestedMode == NestedModes.NO_INDEX && !indexed
    )
    // Will make sure in smart mode nested indexes are referenced in parent indexes
    const shouldReturnIndex :boolean = 
      upTreeIndex && this.settings.nestedMode == NestedModes.NO_INDEX && indexed
    
    //Populates an array of childeren returned by recursive calls to nested folders (if any are returned). must be preformed every time to trigger index match for deep nested indexd folders
    const anyGrandChildren :TFile[] = 
      folder.children.filter(
        (child): child is TFolder =>  child instanceof TFolder
      ).map(
        folder => this.processFolder(folder, indexed || upTreeIndex)
      ).flat()

    if(indexed || shouldReturnChildren){
      // Populates an array with folders children 
      const children :TFile[] = folder.children.filter((child): child is TFile => 
        child instanceof TFile && 
        !indexFiles.contains(child) && 
        !outputPaths.contains(child.path) &&
        (this.settings.allFiles || ['md','canvas'].includes(child.extension)) &&
        !ignoreRegexs.find(r=>r.test(child.basename) || r.test(child.name))
        //!(ignoreRegex && (ignoreRegex.test(child.basename) || ignoreRegex.test(child.name))) 
      // adds any grandchildren
      ).concat(anyGrandChildren)

      // Determines wich links should be present in index file, but are not, fill result array with Promises
      this.indexedFoldersP.push(...indexFiles.map(async (index,i)=>{
        const useCanvas = useCanvases[i]
        const outputFilePath = outputPaths[i]

        const links :string[]|undefined = useCanvas ?
          await this.getCanvasLinks(index) :
          Object.keys(this.app.metadataCache.resolvedLinks[index.path])
        
        const missingChildren = (links != undefined) ? diff(// no missing children if links could not be uptained
          children,
          links,
          (file, link) => link === file.path
        ) : []
        return  {index, /*children,*/ missingChildren, folder, useCanvas, outputFilePath}
      }))

      return shouldReturnChildren ? children : 
        shouldReturnIndex ? indexFiles : 
        []
    }else{
      return []
    }
  }
  
  validateIndex = ()=>{
    // Postpones check until DELAY (4 seconds) has passed from last user's editor input 
    // and displays 'in process' notice to be change to result later. Ie if no input was recorded
    // in last 4 seconds the check is performed immidiately. Gives Obsidian some time to update cache
    // and resolve links. 
    if(!this.working){// ignores if check is in progress
      const notice = new Notice('Checking Indexes - waiting for files to catch up..', 30e3)//also flags ongoing processing
      const delay = DELAY - (Date.now() - this.lastInput)

      this.working = {notice, delay : delay>0?delay:0}
      delay > 0 ? setTimeout(()=>this._validateIndex(), delay) : this._validateIndex()
    }// else ignore click
  }
  _validateIndex = async()=>{
    try{
      // Timestamp to be used when modifing or creating files, Lets plugin 'remember' wich files were modified/created by it
      // to avoid unmark events to be trigger by the change and for some other uses (see rewriteToFile())
      const timeStamp = Date.now()
      this.settings.timeStamps = [...this.settings.timeStamps, timeStamp]

      // Build indexes
      this.indexedFoldersP = [] //clear
      this.processFolder(this.app.vault.getRoot()) //populate with promises
      //console.log('index-checker: sync processing done in '+ String((Date.now()-timeStamp)/1000) + 's')
      const allIndexedFolders = await Promise.all(this.indexedFoldersP)
      //console.log(...allIndexedFolders.map(f=>f.index.path))
      const indexedFolders = allIndexedFolders.filter((f)=>!!f.missingChildren.length) // wait for results
      //console.log('index-checker: async processing done in '+ String((Date.now()-timeStamp)/1000) + 's')

      // Output Result
      indexedFolders.forEach( async indexedFolder => {
        const {index, missingChildren, useCanvas, outputFilePath} = indexedFolder
        try{
          // Creates text of missing links
          const missingLinks = missingChildren
            .map(child => this.app.fileManager.generateMarkdownLink(child, index.parent?.path || ''))
            .map(link=>this.fixLink(link)) // non-wiki link for non-notes are empty text
          // Ouputs result accordin to output mode and marks modified files
          const activeMode = indexedFolder.useCanvas && this.settings.canvasMode !== null ? this.settings.canvasMode : this.settings.outputMode
          if (activeMode == OutputModes.INDEX) {
            useCanvas ?
              await this.addToCanvas(index, missingChildren.map(child=>child.path), timeStamp):
              await this.addToFile(index,  this.formatLinks(missingLinks), timeStamp)

            this.settings.markIndexes && this.marker.markFile(index.path)

          }else if(activeMode== OutputModes.FILE && outputFilePath){
            useCanvas ?
              await this.rewriteToCanvas(outputFilePath, missingChildren.map(child=>child.path), {mtime: timeStamp, ctime:timeStamp}) :
              await this.rewriteToFile(outputFilePath, this.formatLinks(missingLinks), {mtime: timeStamp, ctime:timeStamp})

            this.settings.markIndexes && this.marker.markFile(outputFilePath, MarkType.ON_EMPTY)
            
          } else {
            this.settings.markIndexes && this.marker.markFile(index.path)
          }
        }catch(err){
          console.error('Error writing results: ', err)
          this.lastErrors.add(ERROR_MESSAGES.WRITE_FILES)
        }
      })
      // Displays resulet in Notice created when check was triggered
      const totalMissing = indexedFolders.reduce((n,f)=>n+f.missingChildren.length,0)
      const resultMessege ='Indexes checked: ' + (
        !allIndexedFolders.length ? ERROR_MESSAGES.NO_INDEX : 
          totalMissing ? `${totalMissing} missing links in ${indexedFolders.length} files.` : 'no missing links!'
      )
      this.working && document.contains(this.working.notice.noticeEl) ? 
        this.working.notice.noticeEl.setText(resultMessege) : 
        new Notice(resultMessege, 30e3)

      //console.log('Index Checker: output done in '+ String((Date.now()-timeStamp)/1000) + 's')
    }catch(err){
      console.error('Error while performing sync logic: ', err)
      this.lastErrors.add(ERROR_MESSAGES.OTHER_SYNC)
      this.working?.notice.hide() //hides wait.. notice in case of fatal sync error
    }finally{
      [...this.lastErrors].forEach(m=>new Notice('ALERT - Index Checker Plugin:\n'+m, 0))
      this.working = null 
      this.lastErrors = new Set()
    }
  }
  
  /// OUTPUT METHODS ///
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

  private async rewriteToCanvas(path: string, links :string[], t :DataWriteOptions){
    return this.rewriteToFile(path, 
      this.canvas.addFilesToCanvas(EMPTY_CANVAS,links)
    ,t)
  }
  
  // Used to add results to index file - append or prepend
  private async addToFile(file:TFile, data:string, mtime: number){
    return this.app.vault.process(
      file, 
      content=>this.settings.prependToIndex ? data+content : content+data,
      {mtime}
    )
  }

  private async addToCanvas(file:TFile, links :string[], mtime:number){
    return this.app.vault.process(
      file,
      content=>this.canvas.addFilesToCanvas(content,links),
      {mtime}
    )
  }
  
  // Extract links to files from canvas files
  async getCanvasLinks(file:TFile, delay = true){
    try{
      // Delay before reading canvas file during check (so latest changes are accounted). 
      // Workaround for the sake of user experience. Apparently changes made to canvas 
      // doesn't trigger any immidiate events, so user input is not
      // picked up by code setting this.lastInput via 'editor-change' event. 
      if(delay){
        const value = this.working ? CANVAS_DELAY - this.working.delay : CANVAS_DELAY
        await new Promise<void>(res=>setTimeout(res, value>0 ? value : 0))
      }

      const data = await this.app.vault.read(file)
      console.log('data: ', data)
      try{
        return this.canvas.getLinksFromCanvas(data) //!!data.trim() ? this.canvas.getLinksFromCanvas(data) : []
      }catch(err){
        console.error('Error parsing canvas file: ',err)
        this.lastErrors.add(ERROR_MESSAGES.CANVAS_PARSE)
        return undefined
      }
    }catch(err){
      console.error('Error reading canvas file: ',err)
      this.lastErrors.add(ERROR_MESSAGES.CANVAS_READ)
      return undefined
    }
  }
}
