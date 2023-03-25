import { App, Editor, LinkCache, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder,
  normalizePath
} from 'obsidian';
import diff from 'lodash.differencewith'

// Remember to rename these classes and interfaces!

export default class MyPlugin extends Plugin {
	settings: PluginSettings;
	async loadSettings() {
		this.settings = {...DefaultPluginSettings, ...await this.loadData()}// Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}

	isFileLinkTo(file: TFile, link:LinkCache){
	  //console.log('comparing', file, link)
	  //console.log(link.link === file.basename)
	  return link.link === file.basename
	}

	matchIndex(filename :string, foldername :string, isRoot = false){
      isRoot && (foldername = this.app.vault.getName())
      console.log(filename, foldername, filename == this.settings.indexFormat.replace('[folder]',foldername))
      return filename == this.settings.indexFormat.replace('[folder]',foldername)//TODO regex? all
	}

	formatLinks(links :string[]){
      return '\n' + this.settings.addFormat.replace('[links]', links.join('\n')) + '\n'//TODO replace all
	}

	validateIndex() {
/* 
        this.registerEvent(
			this.app.vault.on("create",f=>console.log('created: ', f))
		)
		this.registerEvent(
		  this.app.vault.on("delete",f=>console.log('deleted: ', f))
		)
		this.registerEvent(
		  this.app.vault.on("rename",f=>console.log('renamed: ', f))
		)
		this.registerEvent(
		  this.app.vault.on("modify",f=>console.log('modified: ', f)) 
		)*/

		const processFolder = (folder: TFolder) => {
			const index = folder.children.find((file):file is TFile => file instanceof TFile && this.matchIndex(file.basename, folder.name, folder.isRoot()))
			const children: TFile[] = []

      folder.children.forEach((file) => {
        file instanceof TFile && file != index && children.push(file)
        file instanceof TFolder && children.push(...processFolder(file))//TODO faster?
      })
      index && indexedFolders.push({ index, children })
			
      switch(this.settings.nested){
        case NestedOption.ALL:
          return children
        case NestedOption.NONE:
          return []
        case NestedOption.NO_INDEX:
          return !index ? children : []
      }
		}

		const indexedFolders :{index: TFile, children: TFile[]}[] = []
		processFolder(this.app.vault.getRoot())
    console.log(indexedFolders)
        
    indexedFolders.forEach(async (folder) => {
      const missingFiles = diff(
        folder.children,
        this.app.metadataCache.getFileCache(folder.index)?.links || [],
        this.isFileLinkTo
      )
      const missingLinks = missingFiles.map(
        file => this.app.fileManager.generateMarkdownLink(file, normalizePath(folder.index.name))
      )
      console.log('Missing links in folder index '+ folder.index.basename+' :', missingLinks)
      missingLinks.length && this.settings.add && 
        this.app.vault.adapter.append(normalizePath(folder.index.path), this.formatLinks(missingLinks))
    })

	}

	async onload() {
		await this.loadSettings();
		//console.log('loaded', this.settings)
		// This creates an icon in the left ribbon.
		this.addRibbonIcon('folder-check', 'Validate indexes', (evt: MouseEvent) => {
          this.validateIndex()
		});
		// Perform additional things with the ribbon
		//ribbonIconEl.addClass('my-plugin-ribbon-class');

		/* // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text'); */

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'validate-indexes',
			name: 'Index Validator Plagin: Check indexes',
			callback: () => {
				this.validateIndex()
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
        
		this.settings.startup && this.validateIndex()
/* 		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		}); */

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		//this.registerDomEvent(document, 'click', (evt: MouseEvent) => {//console.log('click', evt);});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		//this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
		/* 		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		}); */
	}
	async onunload() {
		await this.saveSettings()
		//console.log('saved', this.settings)
	}
}


enum NestedOption{
	"NONE"='',
  "ALL"="ALL",
	"NO_INDEX"="NO_INDEX"
}
const DefaultPluginSettings = {
  indexFormat: '[folder]',
  startup: false,
  nested: NestedOption.NONE,
  add: false,
  addFormat: '\n*********\n[link]\n'
}
type PluginSettings = typeof DefaultPluginSettings


class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for Index Validator plugin.'});

    new Setting(containerEl)
		  .setName('Index file name format')
		  .setDesc('Specify how your index files are named - use [folder] to reference respective folder name')
		  .addText(cmp=>cmp
			.setValue(this.plugin.settings.indexFormat)
			.onChange(value => this.plugin.settings.indexFormat=value)
		)

    new Setting(containerEl)
		  .setName('Validate on startup')
		  .setDesc('Will check your indexes every time you open a vault')
		  .addToggle(cmp=>cmp
			.setValue(this.plugin.settings.startup)
			.onChange(value => this.plugin.settings.startup=value)
		)
        
		new Setting(containerEl)
		  .setName('Check files in nested folders')
		  .setDesc("-same folder of the index \n-nested, if they don't have their own index \n-all nested files")
		  .addDropdown(comp=>comp
			.addOption(NestedOption.NONE,'same folder only, no nested')
			.addOption(NestedOption.NO_INDEX,' if nested folder has no index')
			.addOption(NestedOption.ALL,'all nested files')
			.setValue(this.plugin.settings.nested)
			.onChange((value:NestedOption) => this.plugin.settings.nested=value)
		)
		
		new Setting(containerEl)
		  .setName('Add missing links the index file')
		  .setDesc('After index check missing links will be appended to the end of respected index file and how they will be formatted - us [links] to represnt wherelinks should go')
		  .addToggle(cmp => cmp
			.setValue(this.plugin.settings.add)
		    .onChange(value => this.plugin.settings.add=value)
		)
		  .addTextArea(cmp => cmp
			//.setDisabled(!!this.plugin.settings.add)
			.setValue(this.plugin.settings.addFormat)
            .onChange(value => this.plugin.settings.addFormat=value)
			.inputEl.rows=3
		  )

    new Setting(containerEl)
      .setName('Validate indexes')
      .setDesc('You can also trigger check by clicking on icon on the left')
      .addButton(cmp => cmp
        .onClick(() => this.plugin.validateIndex())
        .setIcon('folder-check')
      )

/* 		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				///.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					console.log('Secret: ' + value);
					//this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
		})) */
	}
}
/* 
class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
} */