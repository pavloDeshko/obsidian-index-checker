import {
	App,
	PluginSettingTab,
	Setting
} from 'obsidian'
import z from 'zod'
import IndexPlugin from "./Plugin"
import { MarkType } from "./Marker"

const inEnum = <T extends {[s:string]:unknown}>(enm: T)=> (value:any):value is T[keyof T] =>Object.values(enm).includes(value)

export enum NestedModes {
	"NONE" = '',
	"ALL" = "ALL",
	"NO_INDEX" = "NO_INDEX"
}
export const inNestedModes = inEnum(NestedModes)

export enum OutputModes {
	"NONE" = '',
	"INDEX" = "INDEX",
	"FILE" = "FILE"
}
export const inOutputModes = inEnum(OutputModes)

export const placeHolders = {
  FOLDER:'[FOLDER]',
	VAULT:'[VAULT]',
	LINKS:'[LINKS]',
	INDEX:'[INDEX]',
} as const


export const PluginSettingsSchema = z
  .object({
    indexFileFormat: z.string().catch(placeHolders.FOLDER),
    useRootIndexFileFormat: z.boolean().catch(false),
    rootIndexFileFormat: z.string().catch(placeHolders.VAULT),
    outputFileFormat: z.string().catch('_'+placeHolders.FOLDER),
    markIndexes: z.boolean().catch(true),
    startupCheck: z.boolean().catch(false),
    nestedMode: z.nativeEnum(NestedModes).catch(NestedModes.NONE),
		allFiles: z.boolean().catch(false),
    outputMode: z.nativeEnum(OutputModes).catch(OutputModes.INDEX),
		prependToIndex: z.boolean().catch(false),
    outputLinksFormat: z.string().catch(`***\n${placeHolders.LINKS}\n`),
    persistentMarks: z.array(z.tuple([z.string(),z.nativeEnum(MarkType)])).catch([]),
    timeStamps: z.array(z.number()).catch([])
  })
export type IndexPluginSettings = z.infer<typeof PluginSettingsSchema>//typeof DefaultPluginSettings
export const DefaultPluginSettings :IndexPluginSettings = PluginSettingsSchema.parse({})

/* export const DefaultPluginSettings = {
	indexFileFormat: placeHolders.FOLDER as string,
	useRootIndexFileFormat: false,
	rootIndexFileFormat: placeHolders.VAULT as string,
	outputFileFormat: '_'+placeHolders.FOLDER as string,
	markIndexes: true,
	startupCheck: false,
	nestedMode: NestedModes.NONE,
	outputMode: OutputModes.INDEX,
	outputLinksFormat: `***\n${placeHolders.LINKS}\n` as string,
	persistentMarks: [] as string[],
	createdTimeStamps: [] as number[]
} */

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


		containerEl.createEl('h3', {text: 'Index files'})

		new Setting(containerEl)
			.setName('How your index files are named?')
			.setDesc('Use [FOLDER] placeholder to specify current folder\'s name. Vault\'s name will be used as [FOLDER] in root directory')
			.addText(cmp => cmp
				.setValue(settings.indexFileFormat)
				.onChange(value => settings.indexFileFormat = value.trim())
			)
    
		let rootIndexFileFormatInput :HTMLInputElement
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


		containerEl.createEl('h3', { text: 'Indexing options' })

		const nestedDesc = new DocumentFragment() //TODO boooeeee
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
		.addToggle(cmp => cmp
			.setValue(settings.markIndexes)
			.onChange(value => !(settings.markIndexes = value) && this.plugin.marker.unmarkAll())
		)

		containerEl.createEl('br')


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
