import {
	App,
	PluginSettingTab,
	Setting,
	ExtraButtonComponent,
	Modal,
	ToggleComponent,
	TextComponent,
	ColorComponent
} from 'obsidian'
import z, { object } from 'zod'
import IndexPlugin from "./Plugin"
import { MarkType } from "./Marker"
import {Position as CanvasPosition, Position} from "./Canvas"

const inEnum = <T extends {[s:string]:unknown}>(enm: T)=> (value:any):value is T[keyof T] =>Object.values(enm).includes(value)
const parseNumber = (n:any,d:number)=>z.number().catch(d).parse(Number(n))

// How nested files should be treated. Explained in details in readme and settings
export enum NestedModes {
	"NONE" = '',
	"ALL" = "ALL",
	"NO_INDEX" = "NO_INDEX"
}
export const inNestedModes = inEnum(NestedModes)

// Where output should go. Explained in details in readme and settings
export enum OutputModes {
	"NONE" = '',
	"INDEX" = "INDEX",
	"FILE" = "FILE"
}
export const inOutputModes = inEnum(OutputModes)

// User can use those to inject names into matching patterns for index and output files as well as when formatting output
export const tokens = {
  FOLDER:'[FOLDER]',
	VAULT:'[VAULT]',
	LINKS:'[LINKS]',
	INDEX:'[INDEX]',
} as const

export const inCanvasPosition = inEnum(CanvasPosition)

// Zod is used to parse plugin data and assign default.
const _PluginSettingsSchema = z
  .object({
    indexFileFormat: z.string()
		  .catch(tokens.FOLDER),
    useRootIndexFileFormat: z.boolean()
		  .catch(false),
    rootIndexFileFormat: z.string()
		  .catch(tokens.VAULT),
    outputFileFormat: z.string()
		  .catch('_'+tokens.FOLDER),
    markIndexes: z.boolean()
		  .catch(true),
		//markColor: z.string().catch('#ff0000'),
    startupCheck: z.boolean()
		  .catch(false),
    nestedMode: z.nativeEnum(NestedModes)
		  .catch(NestedModes.NONE),
    allFiles: z.boolean()
		  .catch(false),
		ignorePatterns: z.string()
		  .catch(""),
    outputMode: z.nativeEnum(OutputModes)
		  .catch(OutputModes.INDEX),
    prependToIndex: z.boolean()
		  .catch(false),
    outputLinksFormat: z.string()
		  .catch(`***\n${tokens.LINKS}`),
		canvasShowOptions: z.boolean()
		  .catch(false),
		canvasGroup: z.boolean()
		  .catch(true),
		canvasGroupLabel:z.string()
		  .catch('Missing files:'),
		canvasPosition:z.nativeEnum(CanvasPosition)
		  .catch(CanvasPosition.TOP_LEFT),
		canvasSize: z.tuple([z.number(),z.number()])
		  .catch([50,300]),
		canvasMode: z.nativeEnum(OutputModes).or(z.null())
		  .catch(null),
    persistentMarks: z.array(z.tuple([z.string(), z.nativeEnum(MarkType)]))
			.catch([]),
    timeStamps: z.array(z.number()).transform(a => a.slice(-1000))
		  .catch([]),
  })
export const PluginSettingsSchema = _PluginSettingsSchema.catch(_PluginSettingsSchema.parse({}))
export type IndexPluginSettings = z.infer<typeof PluginSettingsSchema>

// Plugin settings Tab
export default class IndexPluginSettingsTab extends PluginSettingTab {
	plugin: IndexPlugin;
	constructor(app: App, plugin: IndexPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const {settings} = this.plugin
		const { containerEl } = this
		containerEl.empty()

    /// ///
		containerEl.createEl('h3', {text: 'Index files'})

		new Setting(containerEl)
			.setName('How your index files are named?')
			.setDesc('Use [FOLDER] placeholder to specify current folder\'s name. Vault\'s name will be used as [FOLDER] in root directory. You can use RegEx pattern as follows /.../')
			.addText(cmp => cmp
				.setValue(settings.indexFileFormat)
				.onChange(value => settings.indexFileFormat = value.trim())
			)
    
		let rootIndexFileFormatInput :HTMLInputElement
		// 'update' functions used to toggle display of some options based on other
		const updateRootIndexFileFormatInput = ()=>rootIndexFileFormatInput.toggle(settings.useRootIndexFileFormat)
		new Setting(containerEl)
			.setName('Is index file in root folder named differently?')
			.setDesc('You can use [VAULT] placeholder to specify vault\'s name.')
			.addToggle(cmp=> {
				cmp
				  .setValue(settings.useRootIndexFileFormat)
				  .onChange(value =>{ 
						settings.useRootIndexFileFormat = value 
						updateRootIndexFileFormatInput()
					})
	    })
			.addText(cmp => {
				cmp
				  .setValue(settings.rootIndexFileFormat)
				  .onChange(value => settings.rootIndexFileFormat = value.trim())
				rootIndexFileFormatInput = cmp.inputEl
				updateRootIndexFileFormatInput()
	    })
		containerEl.createEl('br')
		
    /// ///
		containerEl.createEl('h3', { text: 'Indexing options' })

		const nestedDesc = new DocumentFragment() //TODO boooeeee
		// The way I found to add multiline descriptions
		nestedDesc.append(
			'- no nested - index should contain links only to files in the same folder',
			createEl('br'),
			'- smart nested - index should contain links to files in nested folders, but only if that folder doesn\'t have its own index ',
			createEl('br'),
			'- all nested - index should contain all files down the folder tree'
		)
		new Setting(containerEl)
			.setName('Should files in nested folders be referenced in indexes?')
		  .setDesc(nestedDesc)
			.addDropdown(comp => comp
				.addOption(NestedModes.NONE, 'no nested')
				.addOption(NestedModes.NO_INDEX, 'smart nested')
				.addOption(NestedModes.ALL, 'all nested')
				.setValue(settings.nestedMode)
				.onChange(value => inNestedModes(value) && (settings.nestedMode = value))
			)
		new Setting(containerEl)
			.setName('Should non-notes files (like images) be linked in indexes?')
			.setDesc('Check if all files (not just .md or .canvas) should be refereced in respective indexes.')
			.addToggle(cmp => cmp
				.setValue(settings.allFiles)
				.onChange(value => settings.allFiles = value)
			)

		new Setting(containerEl)
		  .setName("Which files should be ignored?")
			.setDesc("You can specify file name patterns, one for each line. Use * as wildcard(any character) and [FOLDER], [VAULT], [INDEX] for respective filenames. RegEx can be used like this /.../ too.  ")
			.addTextArea((cmp) => cmp
			  .setValue(settings.ignorePatterns)
				.onChange((value) => settings.ignorePatterns = value)
				.setPlaceholder("draft_*\n*temp*\n_[INDEX]\netc")
				.inputEl.rows = 4
    )
		containerEl.createEl('br')

    /// ///
		containerEl.createEl('h3', { text: 'Results output' })
    
		const outputModsOptions = {
			[OutputModes.INDEX] : '- added to index file',
			[OutputModes.FILE]: '- written to separate file',
			[OutputModes.NONE]: '- no output (marks only)'
		} as const// TODO better way? used twice again below

		new Setting(containerEl)
			.setName('Where missing links should be added?')//TODO add desc?
			.addDropdown(cmp => {cmp
				.onChange((value) => {
					inOutputModes(value) && (settings.outputMode = value)
					value == OutputModes.NONE && markIndexesComponent.setValue(true)
					updateAllOutputSettings()
					updateAllCanvasSettings()
				})
				Object.entries(outputModsOptions).forEach(([value,text])=>cmp.addOption(value,text))
				cmp.setValue(settings.outputMode)
	    })

		const outputLinksFormatSetting = 
			new Setting(containerEl)
		    .setName('How added links should be formatted?')
				.setDesc('Each link will occupy its own line for easy copying. Use [LINKS] plug to indicate where they should go.')
				.addTextArea(cmp => cmp
					.setValue(settings.outputLinksFormat)
					.onChange(value =>  settings.outputLinksFormat = value.contains('[LINKS]')? value : value+'[LINKS]')
					.inputEl.rows = 3
				)

		const prependToIndexSetting = new Setting(containerEl)
			.setName('Prepend (not append) missing links?')
			.setDesc('If checked, missing links will be added to the beginning of index file, not the end.')
			.addToggle(cmp => cmp
				.setValue(settings.prependToIndex)
				.onChange(value => settings.prependToIndex = value)
			)
		
		const fileFormatComponents = [] as TextComponent[]// faccilates paring between component in general and canvas sections
		const makefileFormatSetting = ()=>new Setting(containerEl)
			.setName('How separate output file should be named?')
			.setDesc('Use [FOLDER] and [INDEX] to specify folder name and current index filename.')
			.addText(cmp =>{
				fileFormatComponents.push(cmp)
				cmp
				  .setValue(settings.outputFileFormat)
				  .onChange(value =>{
						settings.outputFileFormat = value.trim()
						fileFormatComponents.find(c=>c!=cmp)?.setValue(settings.outputFileFormat)
					})
	   })
		const fileFormatSetting = makefileFormatSetting()
    
		let markIndexesComponent :ToggleComponent
		/* let markColorComponent :ColorComponent
		const updateMarkColorComponent = ()=>markColorComponent.setDisabled(!settings.markIndexes) */
		const markIndexesSetting = new Setting(containerEl)
			.addExtraButton(cmp => cmp
				.onClick(() => this.plugin.marker.unmarkAll())
				.setIcon('x')
				.setTooltip('Clear all marks')
			)
			.addToggle(cmp => {cmp
				.setValue(settings.markIndexes)
				.onChange(value =>{
					!(settings.markIndexes = value) && this.plugin.marker.unmarkAll()
					//updateMarkColorComponent()
			  })
				markIndexesComponent = cmp
			})
		const updateMarkIndexesSetting = ()=>{markIndexesSetting
			.setName(settings.outputMode == OutputModes.FILE? 'Mark files which contain missing links?' :'Mark indexes which have missing links?')
			.setDesc('Red mark in file explorer will persist until ' + (settings.outputMode == OutputModes.FILE ? 
				'all links are removed from the file (presumably moved to their place in index).' :
				'index file is not touched (changed in some way).'))
		}
/* 			.addColorPicker(cmp=>{cmp
				.setValue(settings.markColor)
				.onChange(value=>settings.markColor = value)
				markColorComponent = cmp
    	}) */
		
		const updateAllOutputSettings = ()=>{
			outputLinksFormatSetting.settingEl.toggle(!!settings.outputMode)
			prependToIndexSetting.settingEl.toggle(settings.outputMode==OutputModes.INDEX)
			fileFormatSetting.settingEl.toggle(settings.outputMode == OutputModes.FILE)
      updateMarkIndexesSetting()
			//updateMarkColorComponent()
		}
		updateAllOutputSettings()


		containerEl.createEl('br')

    /// When to check ///
		containerEl.createEl('h3', { text: 'Validation' })

		new Setting(containerEl)
			.setName('Check indexes on startup?')
			.setDesc('Will check automatically every time the vault is opened. Alternatively you can trigger check manually, see below.')
			.addToggle(cmp => cmp
				.setValue(settings.startupCheck)
				.onChange(value => settings.startupCheck = value)
			)

		new Setting(containerEl)
			.setName('Check now!')
			.setDesc('You can also use a button on the left side of your workspase.')
			.addButton(cmp => cmp
				.onClick(() => this.plugin.validateIndex())
				.setIcon('folder-check')
				.setTooltip('Check indexes Now')
			)
	  containerEl.createEl('br')

    //////////// Canvas
		containerEl.createEl('h3', { text: 'Canvas' , attr:{style:'margin-bottom:-12px;'}})// TODO negative margin, not good

		const updateDropdown = (cmp:ExtraButtonComponent)=>{cmp
			.setIcon(settings.canvasShowOptions ? 'chevron-up' : 'chevron-down')
			.setTooltip(settings.canvasShowOptions ? 'Hide canvas options' : 'Show canvas options')
		}
		new Setting(containerEl)
		  .setHeading()
			.setDesc('You can use .canvas file as indexes as easy as .md (note) files. Click to see options specific to Canvas indexes.')
			.addExtraButton(cmp => {cmp
				.onClick(()=>{
					settings.canvasShowOptions = !settings.canvasShowOptions
					updateDropdown(cmp)
					updateAllCanvasSettings()
				})
				updateDropdown(cmp)
	    })
		
		const canvasModeSetting = new Setting(containerEl)
		  .setName('Where files missing in canvas indexes should go?')
			.addDropdown(comp => {comp
				.addOption('null','DEFAULT (same as all indexes)')
				.onChange((value) => {
          settings.canvasMode = inOutputModes(value) ? value : null
					value == OutputModes.NONE && markIndexesComponent.setValue(true)
					updateAllCanvasSettings()
				})
				Object.entries(outputModsOptions).forEach(([value,text])=>comp.addOption(value,text))
				comp.setValue(String(settings.canvasMode))
			})
		const updateCanvasModeSettingDesc = ()=>{
			canvasModeSetting.setDesc('Select DEFAULT to use the same mode as for .md (note) indexes (see option above).'+
			(settings.canvasMode === null ? ` Currently "${outputModsOptions[settings.outputMode]}".`:'')
		)
		}

    const fileFormatSettingInCanvas = makefileFormatSetting()
			
		let canvasGroupLabelInput: HTMLInputElement
		const updateCanvasGroupLabel = () => canvasGroupLabelInput.toggle(settings.canvasGroup)
		const canvasGroupLabelSetting = new Setting(containerEl)
			.setName('Should files added to .canvas index be grouped?')
			.setDesc('Recommended for easy handling. You can specify how group should be titled.')
			.addToggle(cmp => {cmp
				.setValue(settings.canvasGroup)
				.onChange(value => {
					settings.canvasGroup = value
					updateCanvasGroupLabel()
				})
			})
			.addText(cmp => {cmp
				.setPlaceholder('group title..')
				.setValue(settings.canvasGroupLabel)
				.onChange(value => settings.canvasGroupLabel = value.trim())
				canvasGroupLabelInput = cmp.inputEl
				updateCanvasGroupLabel()
			})

		const canvasPositinoSetting = new Setting(containerEl)
			.setName('Where on canvas missing files should be placed?')
			.setDesc('You can specify location (corner) in reference to existing canvas content.')
			.addDropdown(comp => comp
				.addOption(Position.TOP_LEFT, '- top left')
				.addOption(Position.TOP_RIGHT, '- top right')
				.addOption(Position.BOTTOM_LEFT, '- bottom left')
				.addOption(Position.BOTTOM_RIGHT, '- bottom right')
				.setValue(settings.canvasPosition)
				.onChange((value) => {
					 inCanvasPosition(value) && (settings.canvasPosition = value)
				})
			)
		
		const CanvasSizeSetting = new Setting(containerEl)
		  .setName('What dimensions should files added to Canvas be?')
			.setDesc('The height of 50 seems to be the minimum to accommodate the name of the file. Choose width to your liking.')
			.addText(cmp =>{ cmp
				.setValue(String(settings.canvasSize[0]))
				.onChange(value =>{
					settings.canvasSize = [parseNumber(value,settings.canvasSize[0]),settings.canvasSize[1]]
					cmp.setValue(String(settings.canvasSize[0]))
			  })
				cmp.inputEl.insertAdjacentText('beforebegin','H: ')
				//cmp.inputEl.insertAdjacentText('afterend','px')
				cmp.inputEl.size = 3
		  })
			.addText(cmp => {cmp
				.setValue(String(settings.canvasSize[1]))
				.onChange(value => {
					settings.canvasSize = [settings.canvasSize[0],parseNumber(value,settings.canvasSize[1])]
					cmp.setValue(String(settings.canvasSize[1]))
				})
				cmp.inputEl.insertAdjacentText('beforebegin','W: ')
				//cmp.inputEl.insertAdjacentText('afterend','px')
				cmp.inputEl.size = 3
	    })
    
		const updateAllCanvasSettings = ()=>{
			canvasModeSetting.settingEl.toggle(settings.canvasShowOptions)
      updateCanvasModeSettingDesc()
			fileFormatSettingInCanvas.settingEl.toggle(
				settings.canvasMode == OutputModes.FILE && settings.outputMode != OutputModes.FILE
			);
			[canvasGroupLabelSetting,canvasPositinoSetting,CanvasSizeSetting]
				.forEach(setting=>setting.settingEl.toggle(settings.canvasShowOptions && !!(settings.canvasMode !== null ? settings.canvasMode : settings.outputMode)))
		}
		updateAllCanvasSettings()

		containerEl.createEl('br')

		/// Restore Defaults ///
		containerEl.createDiv({attr:{style:'height:24px;'}})
		new Setting(containerEl)
		.setName('Restore Default Setting')
		.setDesc("You've clicked something and it's not working any more? This might help.")
		.addButton(cmp=>cmp
			.onClick(()=>{
				const m = new Modal(this.app)
				  m.titleEl.setText('Restore Default Setting')
					m.contentEl.setText('Are you sure? Once done it can\'t be reversed')
					m.contentEl.appendChild(createEl('button',{text:'RESTORE',cls:'mod-warning'},cmp=>{
						cmp.setCssStyles({marginLeft:'12px'})
            cmp.addEventListener('click',()=>{
							this.plugin.restoreDefaultSettings()
							m.close()
							this.display()
						})
					}))
					m.contentEl.appendChild(createEl('button',{text:'CANCEL'},cmp=>{
						cmp.setCssStyles({marginLeft:'12px'})
						cmp.addEventListener('click',()=>m.close())
					}))
				  m.open()
			})
			.setIcon('rotate-ccw')
			//.setWarning()
			.setTooltip("Restore Default Settings")
		)
  	containerEl.createEl('br')
	}
}
