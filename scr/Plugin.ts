import { normalizePath, Notice, Plugin, TFile, TFolder } from 'obsidian'
import diff from 'lodash.differencewith'
import escapeRegExp from 'lodash.escaperegexp'
import memoize from 'lodash.memoize'

import IndexPluginSettingsTab, { IndexPluginSettings, DefaultPluginSettings, NestedModes, OutputModes, placeHolders } from "./SettingsTab"
import Marker from './Marker'
import {setupTests} from './test'

export default class IndexPlugin extends Plugin {
  settings: IndexPluginSettings = DefaultPluginSettings
  marker: Marker = new Marker(this.app, this)

  //////  Setup  //////
  async onload() {
    this.settings = { ...DefaultPluginSettings, ...await this.loadData() }

    this.app.workspace.onLayoutReady(() => {
      console.log('persistent:', this.settings.persistentMarks)
      this.settings.persistentMarks.length && this.marker.rehydrate()
    })

    this.addRibbonIcon('folder-check', 'Validate indexes', (evt: MouseEvent) => {
      this.validateIndex()
    }).addClass('index-validator-plugin-ribbon-icon')

    // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
    const statusBarItemEl = this.addStatusBarItem()
    statusBarItemEl.setText('Status Bar Text')

    this.addCommand({
      id: 'validate-indexes',
      name: 'Index Validator Plagin: Check indexes',
      callback: () => {
        this.validateIndex()
      }
    })
    process.env.NODE_ENV=='development'&&setupTests(this)

    this.addSettingTab(new IndexPluginSettingsTab(this.app, this))

    this.settings.startupCheck && this.app.workspace.onLayoutReady(() => this.validateIndex())
  }
  async onunload() {
    this.marker.dehydrate()
    this.marker.unmarkAll()
    await this.saveData(this.settings)
    console.log('saved settings: ', this.settings)
  }

  ////// Utils //////
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
    return '\n' + this.settings.outputLinksFormat.replace(placeHolders.LINKS, links.join('\n')) + '\n'//TODO replace all
  }

  private formatOutputFilePath(folder :TFolder, index:TFile){
    return normalizePath(`${folder.path}/${this.settings.outputFileFormat
      .replace(placeHolders.FOLDER, folder.name || (folder.isRoot() ? this.app.vault.getName() : ''))
      .replace(placeHolders.INDEX, index.basename)}.md`
    )
  }

  //////  Main action //////
  private indexedFolders: {
    indexFile: TFile,
    children: TFile[],
    missingChildren: TFile[],
    folder: TFolder
  }[] = []

  validateIndex(){
    /// Build indexes ///
    const processFolder = (folder: TFolder, upTreeIndex = false) => {
      const vaultName = folder.isRoot() ? this.app.vault.getName() : undefined

      const indexFile = folder.children.find(
        (file): file is TFile => file instanceof TFile && this.matchIndex(file, folder, vaultName)
      )
      const shouldReturnChildren :boolean = upTreeIndex && (
        this.settings.nestedMode == NestedModes.ALL ||
        this.settings.nestedMode == NestedModes.NO_INDEX && !indexFile
      )
      const possibeleOutputFilePath = indexFile && this.settings.outputMode == OutputModes.FILE ? this.formatOutputFilePath(folder, indexFile) : undefined
      
      const anyGrandChildren :TFile[] = folder.children.filter(
        (child): child is TFolder => child instanceof TFolder
      ).map(
        folder => processFolder(folder, !!indexFile || upTreeIndex)
      ).flat()
      
      const children :TFile[] = indexFile || shouldReturnChildren ?
        folder.children.filter(
          (child): child is TFile => child instanceof TFile && child != indexFile && child.path !== possibeleOutputFilePath
        ).concat(anyGrandChildren) :
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

    this.indexedFolders = []
    processFolder(this.app.vault.getRoot())
    //console.log(indexedFolders)
    
    /// Output Result ///
    this.indexedFolders.filter(folder => !!folder.missingChildren.length).forEach(async (indexedFolder) => {
      const missingLinks = indexedFolder.missingChildren.map(
        child => this.app.fileManager.generateMarkdownLink(child, indexedFolder.indexFile.parent.path)
      )
      const  ignoreTimeStamp = Date.now()
      console.log('Missing links in folder index ' + indexedFolder.indexFile.path + ' : \n', missingLinks)

      if (this.settings.outputMode == OutputModes.INDEX) {
        this.app.vault.adapter.append(//why check only here?
          indexedFolder.indexFile.path,
          this.formatLinks(missingLinks),
          {mtime: ignoreTimeStamp}
        )
        
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile, ignoreTimeStamp)

      }else if(this.settings.outputMode == OutputModes.FILE){
        const outputFilePath = this.formatOutputFilePath(indexedFolder.folder, indexedFolder.indexFile)
        let outputFile  = this.app.vault.getAbstractFileByPath(outputFilePath)
        const ignoreTimeStamp = Date.now()
        
        outputFile instanceof TFile ? 
          this.app.vault.modify(
            outputFile, 
            this.formatLinks(missingLinks), 
            {mtime: ignoreTimeStamp}
          ) : 
          outputFile = await this.app.vault.create(
            outputFilePath, 
            this.formatLinks(missingLinks), 
            {mtime: ignoreTimeStamp}
          )

        this.settings.markIndexes && this.marker.markFile(outputFile as TFile, ignoreTimeStamp, true)//TODO as
      } else {
        this.settings.markIndexes && this.marker.markFile(indexedFolder.indexFile, ignoreTimeStamp)
      }
    })
    //setTimeout(()=>console.log('index: ', this.indexedFolders),1000)
    new Notice('Index validation done.')
  }
}
