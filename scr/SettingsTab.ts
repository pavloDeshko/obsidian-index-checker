import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian'
import z from 'zod'
import IndexPlugin from "./Plugin"
import { MarkType } from "./Marker"

const inEnum = <T extends {[s:string]:unknown}>(enm: T)=> (value:any):value is T[keyof T] =>Object.values(enm).includes(value)

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
export const placeHolders = {
  FOLDER:'[FOLDER]',
	VAULT:'[VAULT]',
	LINKS:'[LINKS]',
	INDEX:'[INDEX]',
} as const

export const DefaultPluginSettings = {
	indexFileFormat: placeHolders.FOLDER as string,
	useRootIndexFileFormat: false,
	rootIndexFileFormat: placeHolders.VAULT as string,
	outputFileFormat: '_'+placeHolders.FOLDER as string,
	markIndexes: true,
	startupCheck: false,
	nestedMode: NestedModes.NONE,
	allFiles: false,
	outputMode: OutputModes.INDEX,
	prependToIndex: false,
	outputLinksFormat: `***\n${placeHolders.LINKS}\n` as string,
	persistentMarks: [] as [string, MarkType][],
	timeStamps: [] as number[]
}

// Zod is used to parse plugin data and assign default.
	export const PluginSettingsSchema = z
  .object({
    indexFileFormat: z.string().catch(DefaultPluginSettings.indexFileFormat),
    useRootIndexFileFormat: z.boolean().catch(DefaultPluginSettings.useRootIndexFileFormat),
    rootIndexFileFormat: z.string().catch(DefaultPluginSettings.rootIndexFileFormat),
    outputFileFormat: z.string().catch(DefaultPluginSettings.outputFileFormat),
    markIndexes: z.boolean().catch(DefaultPluginSettings.markIndexes),
    startupCheck: z.boolean().catch(DefaultPluginSettings.startupCheck),
    nestedMode: z.nativeEnum(NestedModes).catch(DefaultPluginSettings.nestedMode),
    allFiles: z.boolean().catch(DefaultPluginSettings.allFiles),
    outputMode: z.nativeEnum(OutputModes).catch(DefaultPluginSettings.outputMode),
    prependToIndex: z.boolean().catch(DefaultPluginSettings.prependToIndex),
    outputLinksFormat: z.string().catch(DefaultPluginSettings.outputLinksFormat),
    persistentMarks: z
      .array(z.tuple([z.string(), z.nativeEnum(MarkType)])).catch(DefaultPluginSettings.persistentMarks),
    timeStamps: z.array(z.number()).transform(a => a.slice(-1000)).catch(DefaultPluginSettings.timeStamps),
  }).catch(DefaultPluginSettings)

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
			.setDesc('Use [FOLDER] placeholder to specify current folder\'s name. Vault\'s name will be used as [FOLDER] in root directory')
			.addText(cmp => cmp
				.setValue(settings.indexFileFormat)
				.onChange(value => settings.indexFileFormat = value.trim())
			)
    
		let rootIndexFileFormatInput :HTMLInputElement
		// 'show' functions used to toggle display of some options based on other
		const showRootIndexFileFormatInput = ()=>rootIndexFileFormatInput.toggle(settings.useRootIndexFileFormat)
		new Setting(containerEl)
			.setName('Is index file in root folder named differently?')
			.setDesc('You can use [VAULT] placeholder to specify vault\'s name.')
			.addToggle(cmp=> {
				cmp
				  .setValue(settings.useRootIndexFileFormat)
				  .onChange(value =>{ 
						settings.useRootIndexFileFormat = value 
						showRootIndexFileFormatInput()
					})
	    })
			.addText(cmp => {
				cmp
				  .setValue(settings.rootIndexFileFormat)
				  .onChange(value => settings.rootIndexFileFormat = value.trim())
				rootIndexFileFormatInput = cmp.inputEl
				showRootIndexFileFormatInput()
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
			'- all nested - index should contain all files down folder tree'
		)
		new Setting(containerEl)
			.setName('Should files in nested folder be referenced in indexes?')
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
			.setDesc('Check if all files, not just .md ones should be refereced in respective indexes.')
			.addToggle(cmp => cmp
				.setValue(settings.allFiles)
				.onChange(value => settings.allFiles = value)
			)
		containerEl.createEl('br')

    /// ///
		containerEl.createEl('h3', { text: 'Results output' })

		new Setting(containerEl)
			.setName('Where missing links should be added?')
			.addDropdown(comp => comp
				.addOption(OutputModes.INDEX, '- appended to index file')
			  .addOption(OutputModes.FILE, '- written to separate file')
				.addOption(OutputModes.NONE, '- no output')
				.setValue(settings.outputMode)
				.onChange((value) => {
					inOutputModes(value) && (settings.outputMode = value)
					showOutputLinksFormatSetting()
					showFileFormatSetting()
					showPrependToIndexSetting()
				})
			)

		const outputLinksFormatSetting = 
			new Setting(containerEl)
		    .setName('How added links should be formatted?')
				.setDesc('Each link will occupy its own line for easy copying. Please use [LINKS] plug to indicate where they should go.')
				.addTextArea(cmp => cmp
					.setValue(settings.outputLinksFormat)
					.onChange(value =>  settings.outputLinksFormat = value.contains('[LINKS]')? value : value+'[LINKS]')
					.inputEl.rows = 3
				)
    const showOutputLinksFormatSetting = () => outputLinksFormatSetting.settingEl.toggle(!!settings.outputMode)
		showOutputLinksFormatSetting()

		const prependToIndexSetting = new Setting(containerEl)
		.setName('Prepend missing links to index file?')
		.setDesc('If checked missing links will be added to the beginning of index file, not the end.')
		.addToggle(cmp => cmp
			.setValue(settings.prependToIndex)
			.onChange(value => settings.prependToIndex = value)
		)
    const showPrependToIndexSetting = () => prependToIndexSetting.settingEl.toggle(settings.outputMode==OutputModes.INDEX)
		showPrependToIndexSetting()
			
		const fileFormatSetting = new Setting(containerEl)
			.setName('How separate output file should be named?')
			.setDesc('Use [FOLDER] and [INDEX] to specify folder name and current index filename.')
			.addText(cmp => cmp
				.setValue(settings.outputFileFormat)
				.onChange(value => settings.outputFileFormat = value.trim())
			)
		const showFileFormatSetting = ()=>fileFormatSetting.settingEl.toggle(settings.outputMode == OutputModes.FILE)
		showFileFormatSetting()

		new Setting(containerEl)
		.setName('Mark indexes which have missing links in file explorer?')
		.setDesc('Red mark will persist until file is not touched (changed in some way).')
		.addExtraButton(cmp => cmp
			.onClick(() => this.plugin.marker.unmarkAll())
			.setIcon('x')
			.setTooltip('Clear all marks')
		)
		.addToggle(cmp => cmp
			.setValue(settings.markIndexes)
			.onChange(value => !(settings.markIndexes = value) && this.plugin.marker.unmarkAll())
		)
		containerEl.createEl('br')

    /// ///
		containerEl.createEl('h3', { text: 'Validation' })

		new Setting(containerEl)
			.setName('Check indexes every time the vault is opened?')
			.setDesc('Check on startup. Or you can trigger check manually.')
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
			)
	  containerEl.createEl('br')
	}
}
