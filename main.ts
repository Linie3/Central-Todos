import {App, Editor, MarkdownView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder} from "obsidian";
import { runInThisContext } from "vm";

interface MyPluginSettings {
	centralTodoNotePath: string,
	individualTodoNotePaths: string,
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	centralTodoNotePath: '/testnote',
	individualTodoNotePaths: '',
}

class LocationPath extends Object {

	path : string

	constructor(path : string) {
		super()
		this.path = path
	}
	

}

class ChapterNode extends Object implements ChapterNode, Visable<ChapterNode> {
	superChapter : ChapterNode | null
	subchapters : ChapterNode[]
	headerLevel : number
	name : string
	subtext : string
	
	constructor(subtext : string, superChapter : ChapterNode | null, name : string, headerLevel : number) {
		super()
		this.superChapter = superChapter
		this.subchapters = []
		this.name = name
		this.headerLevel = headerLevel
		this.subtext = subtext
		if (!(subtext.length === 0) && !(this.headerLevel === 6)) {
			this.parseSubtext(subtext)
		}
		//parse for header
	}

	visit(Visitor : Visitor<ChapterNode>) {
		Visitor.visiting(this)
		this.subchapters.forEach((subChapter : ChapterNode) => {
			subChapter.visit(Visitor)
		})
	}

	getChapterPath() : string {
		return (this.superChapter !== null ? this.superChapter.getChapterPath() + "#" + this.name : "")
	}

	getChapterLineValidator(minH : number, maxH : number) : RegExp {
		return new RegExp(this.getChapterLineValidatorString(minH, maxH))
	}

	getChapterLineValidatorString(minH : number, maxH : number) : string {
		return `^(#){${minH},${maxH}}( )+`
	}

	parseSubtext(subtext : string) : void {
		var topChapterHLevel : number = 0
		var topChapterTitle : string 
		var currLines : string[] = []
		var chapterLineValidator : RegExp = this.getChapterLineValidator(1, 6)
		subtext.split("\n").forEach((line : string) => {
			if (!chapterLineValidator.test(line)) {
				currLines.push(line)
			} else {
				if (topChapterHLevel !== 0) { //Only create subChapterNode if there was a subchapter found yet
					this.subchapters.push(new ChapterNode(currLines.join("\n"), this, topChapterTitle, topChapterHLevel))
				}
				currLines = []
				topChapterHLevel = line.split(" ")[0].length
				topChapterTitle = line.slice(topChapterHLevel, line.length).trim()
				chapterLineValidator = this.getChapterLineValidator(1, topChapterHLevel)
			}
			
		})
		if (topChapterHLevel !== 0) {
			this.subchapters.push(new ChapterNode(currLines.join("\n"), this, topChapterTitle, topChapterHLevel))

		}

	}

}

interface Visitor<T> extends Object {

	visiting(visable : T) : void

}

interface Visable<O> extends Object {

	visit(visitor : Visitor<O>) : void;

}

class ChapterTree extends Object {

	file : TFile
	topChapterNode : ChapterNode

	constructor(file : TFile) {
		super()
		this.file = file
		//this.createChapterNodes(file)
	}

	async createChapterNodes() : Promise<void> {
		this.topChapterNode = new ChapterNode(await this.file.vault.read(this.file), null, this.file.name.split(".")[0], 0)
	}

}

class FilePathTree extends Object {
	file : TFile
	filePath : LocationPath
	chapterTree : ChapterTree

	constructor(file : TFile) {
		super();
		this.file = file
		this.filePath = new LocationPath(file.path)
		this.chapterTree = new ChapterTree(file)
	}

	getChapters() : LocationPath[] {
		
		var chapterLocationPaths : LocationPath[] = []

		

		return chapterLocationPaths
	}

}

export default class CentralTodoPlugin extends Plugin {
	settings: MyPluginSettings;
	centralTodoNote: TFile;

	getChapterLineValidator(minH : number, maxH : number) : RegExp {
		return new RegExp(this.getChapterLineValidatorString(minH, maxH))
	}

	getChapterLineValidatorString(minH : number, maxH : number) : string {
		return `^(#){${minH},${maxH}}( )+`
	}

	getTodoChapterLineValidator(minH : number, maxH : number) : RegExp {
		return new RegExp(this.getChapterLineValidatorString(minH, maxH) + `\[Tt\]\[Oo\]\[Dd\]\[Oo\]`)
	}

	async updateCentralNoteContent() {

		if (this.centralTodoNote === undefined) {
			return
		}

		var todoNameValidator : RegExp = new RegExp("\[Tt\]\[Oo\]\[Dd\]\[Oo\]") 
		var todoChapterNodes : ChapterNode[] = []
		
		class ChapterTreeVisitor implements Visitor<ChapterNode> {
			
			visiting(chapterNode : ChapterNode) {
				if (todoNameValidator.test(chapterNode.name)) {
					todoChapterNodes.push(chapterNode)
				}
			}
		}
		
		var files : TFile[] = this.app.vault.getMarkdownFiles()
		files.remove(this.centralTodoNote)
		var todoFiles : Map<TFile,ChapterNode[]> = new Map()
		var visitor : Visitor<ChapterNode> = new ChapterTreeVisitor()

		for (var i : number = 0; i < files.length; i++) {

			var file : TFile = files[i]
			var chapterTree : ChapterTree = new ChapterTree(file)
			todoChapterNodes = []

			await chapterTree.createChapterNodes()
			chapterTree.topChapterNode.visit(visitor)
			if (todoChapterNodes.length > 0) {
				todoFiles.set(file, todoChapterNodes)
			}	
		}
		
		var openTodos : Map<TFile, ChapterNode[]> = new Map()
		var finishedTodos : Map<TFile, ChapterNode[]> = new Map()
		var containsUncheckedCheckboxLineTest : RegExp = new RegExp("^- \\[ \\] ")
		var containsCheckedCheckboxLineTest : RegExp = new RegExp("^- [x] ")

		for (const todoFile of todoFiles.keys()) {
			var todoFileChapterNodes : ChapterNode[] | undefined = todoFiles.get(todoFile)
			if (todoFileChapterNodes !== undefined) {
				var currOpenTodos : ChapterNode[] = []
				var currFinishedTodos : ChapterNode[] = []
				for (const chapterNode of todoFileChapterNodes) {
					var uncheckedCheckboxFound : boolean = false
					
					for (const line of chapterNode.subtext.split("\n")) {
						if (containsUncheckedCheckboxLineTest.test(line)) {
							uncheckedCheckboxFound = true
							break
						}
					}

					uncheckedCheckboxFound ? currOpenTodos.push(chapterNode) : currFinishedTodos.push(chapterNode)
				}
				if (currOpenTodos.length > 0) {
					openTodos.set(todoFile, currOpenTodos)	
				}
				if (currFinishedTodos.length > 0) {
					finishedTodos.set(todoFile, currFinishedTodos)
				}
			}
		}
		
		var result : string = ""
		if (openTodos.size > 0) {
			result += "## Open Todos"
			for (const file of openTodos.entries()) {
				result += "\n\n### [[" + file[0].path + "|" + file[0].basename + "]]\n"
				
				for (const chapterNode of file[1]) {
					result += "\n###### [[" + file[0].path + chapterNode.getChapterPath() + "|" + chapterNode.name + "]]\n"
					result += "\n![[" + file[0].path + chapterNode.getChapterPath() + "]]"
				}
			}
			result += "\n\n"
		}
		if (finishedTodos.size > 0) {
			result += "## Finished Todos"
			for (const file of finishedTodos.entries()) {
				result += "\n\n### [[" + file[0].path + "|" + file[0].basename + "]]\n"
				
				for (const chapterNode of file[1]) {
					result += "\n###### [[" + file[0].path + chapterNode.getChapterPath() + "|" + chapterNode.name + "]]\n"
					result += "\n![[" + file[0].path + chapterNode.getChapterPath() + "]]"
				}
			}
		}

		console.log(openTodos)
		console.log(finishedTodos)

		await this.app.vault.modify(this.centralTodoNote, result)
		
	}

	async onload() {

		await this.loadSettings();

		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.addRibbonIcon('reset', 'Reload Central Todo Note Content', async () => {
			await this.updateCentralNoteContent();
		});

		await this.refindCentralFile()

		
	}

	async onunload() {

		console.log("Unloaded!");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refindCentralFile() {
		this.saveSettings()
		var centralFilePath : string = this.settings.centralTodoNotePath + ".md"
		var centralFile : TFile | null = this.app.vault.getFileByPath(centralFilePath)

		if (centralFile === null) {
			new Notice(`Central ToDo file with path ${centralFilePath} could not be found.`)
		} else {
			this.centralTodoNote = centralFile
			await this.updateCentralNoteContent()
		}
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: CentralTodoPlugin;

	constructor(app: App, plugin: CentralTodoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Central Todos Location')
			.setDesc('Provide a path to the node that should contain your centralized Todo-List')
			.addText(text => text
				.setPlaceholder('Node location, e.g. folder1/node1')
				.setValue(this.plugin.settings.centralTodoNotePath)
				.onChange(async (newValue : string) => {
					this.plugin.settings.centralTodoNotePath = newValue;
					await this.plugin.saveSettings();
					if (this.app.vault.getFileByPath(newValue + ".md") === null) {
						text.inputEl.setCssProps({"background-color": "red"})
					} else {
						text.inputEl.setCssProps({"background-color": "green"})
						this.plugin.refindCentralFile()
						
					}
				}))
			.addButton(button => button
				.setIcon("reset")
				.setTooltip("Try to reload Central Todo File")
				.onClick(() => {
					this.plugin.refindCentralFile()
				})
			);
				
	}
}

/*import {App, Editor, MarkdownView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting} from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	//mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	//mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (event) => {
			const menu = new Menu();

			menu.addItem((item) =>
				item
					.setTitle("Copy")
					.setIcon("documents")
					.onClick(() => {
						new Notice("Copied");
					})
			);

			menu.addItem((item) =>
				item
					.setTitle("Paste")
					.setIcon("paste")
					.onClick(() => {
						new Notice("Pasted");
					})
			);

			menu.showAtMouseEvent(event);
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
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
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

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
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
*/
