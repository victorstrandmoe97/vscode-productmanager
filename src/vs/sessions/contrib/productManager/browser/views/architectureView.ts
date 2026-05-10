/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../../workbench/browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../../workbench/common/views.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { localize } from '../../../../../nls.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import {
	IProductManagerDataService,
	IProductManagerLaneModel,
	OPEN_DISCOVER_CHAT_COMMAND_ID,
	PRODUCT_MANAGER_REPO_ID_SETTING,
} from '../../../../services/productManager/common/productManager.js';

type ArchitectureViewMode = 'tree' | 'files' | 'paths';

interface IArchitectureModeItem extends IQuickPickItem {
	readonly mode: ArchitectureViewMode;
}

interface IArchitectureTreeNode {
	readonly kind: 'folder' | 'file';
	readonly name: string;
	readonly path: string;
	readonly fileCount: number;
	readonly children?: readonly IArchitectureTreeNode[];
}

interface IMutableArchitectureTreeNode {
	kind: 'folder' | 'file';
	name: string;
	path: string;
	fileCount: number;
	children?: Map<string, IMutableArchitectureTreeNode>;
}

export class ArchitectureView extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private readonly expandedLanes = new Set<string>();
	private readonly expandedFolders = new Set<string>();
	private readonly collapsedFolders = new Set<string>();
	private readonly renderDisposables = this._register(new DisposableStore());
	private _isBusy = false;
	private _viewMode: ArchitectureViewMode = 'tree';

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductManagerDataService private readonly productManagerDataService: IProductManagerDataService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.bodyContainer = dom.append(parent, dom.$('.product-manager-view'));
		this.renderContent();
		this._register(this.productManagerDataService.onDidChange(() => this.renderContent()));
	}

	private renderContent(): void {
		if (!this.bodyContainer) {
			return;
		}

		this.renderDisposables.clear();
		dom.clearNode(this.bodyContainer);

		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const hasRepoId = !!(this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '');

		const headerCard = dom.append(stack, dom.$('.product-manager-card'));
		const headerRow = dom.append(headerCard, dom.$('.product-manager-section-heading'));
		dom.append(headerRow, dom.$('.product-manager-section-title', undefined, localize('architectureCoverage', "Architecture Coverage")));

		if (hasRepoId) {
			const controls = dom.append(headerRow, dom.$('.product-manager-section-controls'));
			dom.append(controls, dom.$('span.product-manager-mode-badge', undefined, this._getModeLabel(this._viewMode)));

			const settingsButton = dom.append(controls, dom.$('button.product-manager-icon-button', {
				type: 'button',
				title: localize('changeArchitectureMode', "Change architecture view mode"),
			}));
			settingsButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.settingsGear));
			this.renderDisposables.add(dom.addDisposableListener(settingsButton, dom.EventType.CLICK, () => void this.pickArchitectureMode()));
		}

		const statusMsg = artifactsState.status === 'ready'
			? localize('architectureReadyBody', "Architecture map loaded from the complexity-estimator.")
			: artifactsState.status === 'loading'
				? (artifactsState.message ?? localize('architectureLoadingBody', "Loading…"))
				: artifactsState.status === 'error'
					? (artifactsState.message ?? localize('architectureErrorBody', "An error occurred."))
					: localize('architecturePlaceholderBody', "Connect a GitHub repository to see its architecture map here.");

		dom.append(headerCard, dom.$('p.product-manager-body', undefined, statusMsg));

		if (artifactsState.generatedAt) {
			dom.append(headerCard, dom.$('span.product-manager-tag', undefined, localize('generatedAt', "Generated {0}", artifactsState.generatedAt)));
		}

		const actionsRow = dom.append(headerCard, dom.$('.product-manager-actions'));
		const busy = this._isBusy;

		if (!hasRepoId) {
			const connectButton = this.renderDisposables.add(new Button(actionsRow, defaultButtonStyles));
			connectButton.label = localize('connectRepository', "Connect Repository");
			connectButton.element.title = localize('connectRepositoryTooltip', "Enter a GitHub repository URL and optional PAT to load the architecture map");
			connectButton.enabled = !busy;
			this.renderDisposables.add(connectButton.onDidClick(() => void this.runConnectDialog(connectButton)));
		} else {
			const loadButton = this.renderDisposables.add(new Button(actionsRow, defaultButtonStyles));
			loadButton.label = busy ? localize('loadingArchitecture', "Loading…") : localize('loadArchitecture', "Load Architecture");
			loadButton.enabled = !busy;
			this.renderDisposables.add(loadButton.onDidClick(async () => {
				if (this._isBusy) { return; }
				this._isBusy = true;
				this.renderContent();
				try {
					await this.productManagerDataService.fetchArchitectureFromApi();
				} finally {
					this._isBusy = false;
					this.renderContent();
				}
			}));

			const reconnectButton = this.renderDisposables.add(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			reconnectButton.label = localize('reconnectRepository', "Change Repository");
			reconnectButton.element.title = localize('reconnectRepositoryTooltip', "Connect a different repository");
			reconnectButton.enabled = !busy;
			this.renderDisposables.add(reconnectButton.onDidClick(() => {
				if (this._isBusy) { return; }
				void this.runConnectDialog(reconnectButton);
			}));

			const refreshButton = this.renderDisposables.add(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			refreshButton.label = busy ? localize('refreshingArchitecture', "Indexing…") : localize('refreshArchitecture', "Refresh");
			refreshButton.element.title = localize('refreshArchitectureTooltip', "Re-index the repository and reload the architecture map");
			refreshButton.enabled = !busy;
			this.renderDisposables.add(refreshButton.onDidClick(async () => {
				if (this._isBusy) { return; }
				this._isBusy = true;
				this.renderContent();
				try {
					await this.productManagerDataService.recookAndRefresh();
				} finally {
					this._isBusy = false;
					this.renderContent();
				}
			}));

			const discoverButton = this.renderDisposables.add(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			discoverButton.label = localize('openDiscoverChat', "Open Discover Chat");
			discoverButton.element.title = localize('openDiscoverChatTooltip', "Open a GitHub-backed chat for this repository without using a local checkout");
			discoverButton.enabled = !busy;
			this.renderDisposables.add(discoverButton.onDidClick(() => {
				if (this._isBusy) { return; }
				void this.commandService.executeCommand(OPEN_DISCOVER_CHAT_COMMAND_ID);
			}));

			const deleteButton = this.renderDisposables.add(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			deleteButton.label = localize('deleteRepository', "Delete Repository");
			deleteButton.element.title = localize('deleteRepositoryTooltip', "Disconnect this repository and reset all Product Mode state");
			deleteButton.enabled = !busy;
			this.renderDisposables.add(deleteButton.onDidClick(async () => {
				if (this._isBusy) { return; }
				deleteButton.enabled = false;
				try {
					await this.productManagerDataService.disconnectRepository();
				} finally {
					deleteButton.enabled = true;
				}
			}));
		}

		const lanes = this.productManagerDataService.getArchitecture();
		if (artifactsState.status !== 'ready' || lanes.length === 0) {
			return;
		}

		const laneList = dom.append(stack, dom.$('.product-manager-lane-list'));
		for (const lane of lanes) {
			this.renderLaneRow(laneList, lane);
		}

		const chatCard = dom.append(stack, dom.$('.product-manager-card.product-manager-chat-card'));
		const chatRow = dom.append(chatCard, dom.$('.product-manager-chat-row'));
		const chatIcon = dom.append(chatRow, dom.$('span.product-manager-chat-icon'));
		chatIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));
		dom.append(chatRow, dom.$('span.product-manager-chat-label', undefined, localize('askAboutArchitecture', "Ask Copilot about this architecture")));
		this.renderDisposables.add(dom.addDisposableListener(chatCard, dom.EventType.CLICK, () => {
			void this.commandService.executeCommand(OPEN_DISCOVER_CHAT_COMMAND_ID, {
				query: this._buildArchitectureChatPrompt(lanes),
			});
		}));
	}

	private async pickArchitectureMode(): Promise<void> {
		const pick = await this.quickInputService.pick<IArchitectureModeItem>([
			{
				label: localize('architectureModeTree', "Folders"),
				description: localize('architectureModeTreeDescription', "Lane folders with collapsible file trees"),
				picked: this._viewMode === 'tree',
				mode: 'tree',
			},
			{
				label: localize('architectureModeFiles', "Files"),
				description: localize('architectureModeFilesDescription', "Filenames first, with parent folders as supporting context"),
				picked: this._viewMode === 'files',
				mode: 'files',
			},
			{
				label: localize('architectureModePaths', "Paths"),
				description: localize('architectureModePathsDescription', "Full repository paths for a denser technical view"),
				picked: this._viewMode === 'paths',
				mode: 'paths',
			},
		], {
			title: localize('architectureViewModeTitle', "Architecture View Mode"),
			placeHolder: localize('architectureViewModePlaceholder', "Choose how to browse files inside each lane"),
		});

		if (!pick || pick.mode === this._viewMode) {
			return;
		}

		this._viewMode = pick.mode;
		this.renderContent();
	}

	private _getModeLabel(mode: ArchitectureViewMode): string {
		switch (mode) {
			case 'files':
				return localize('architectureModeBadgeFiles', "Files");
			case 'paths':
				return localize('architectureModeBadgePaths', "Paths");
			default:
				return localize('architectureModeBadgeFolders', "Folders");
		}
	}

	private async runConnectDialog(triggerButton: Button): Promise<void> {
		triggerButton.enabled = false;

		try {
			const repoUrl = await this.quickInputService.input({
				title: localize('connectDialogTitle', "Connect Repository (1/3) — URL"),
				placeHolder: 'https://github.com/owner/repo',
				prompt: localize('connectDialogUrlPrompt', "Enter the GitHub repository URL"),
				ignoreFocusLost: true,
				validateInput: value => {
					if (!value || !value.trim()) {
						return Promise.resolve(localize('urlRequired', "Repository URL is required"));
					}
					if (!value.includes('github.com')) {
						return Promise.resolve(localize('urlMustBeGitHub', "URL must be a GitHub repository (https://github.com/owner/repo)"));
					}
					return Promise.resolve(undefined);
				},
			});

			if (!repoUrl) {
				return;
			}

			const githubUsername = await this.quickInputService.input({
				title: localize('connectDialogUsernameTitle', "Connect Repository (2/3) — GitHub Username"),
				placeHolder: 'your-github-username (leave empty for public repositories)',
				prompt: localize('connectDialogUsernamePrompt', "Enter your GitHub username — required for private repositories"),
				ignoreFocusLost: true,
			});

			if (githubUsername === undefined) {
				return;
			}

			const githubToken = await this.quickInputService.input({
				title: localize('connectDialogPatTitle', "Connect Repository (3/3) — Personal Access Token"),
				placeHolder: 'ghp_… (leave empty for public repositories)',
				prompt: localize('connectDialogPatPrompt', "Paste your GitHub PAT — kept in memory for this session only, never written to disk"),
				password: true,
				ignoreFocusLost: true,
			});

			if (githubToken === undefined) {
				return;
			}

			await this.productManagerDataService.connectRepository(
				repoUrl.trim(),
				githubToken.trim() || undefined,
				githubUsername.trim() || undefined,
			);
		} finally {
			triggerButton.enabled = true;
		}
	}

	private _buildArchitectureChatPrompt(lanes: readonly { id: string; title: string; summary: string; coverageLabel: string; files?: readonly string[] }[]): string {
		const laneBlocks = lanes.map(lane => {
			const fileLines = (lane.files ?? []).slice(0, 30).join('\n  - ');
			return `### ${lane.title} (${lane.id})\n${lane.summary}\nCoverage: ${lane.coverageLabel}\nFiles:\n  - ${fileLines || '(none)'}`;
		}).join('\n\n');
		return `Here is the current architecture map for this repository, grouped by architectural lane:\n\n${laneBlocks}\n\n`;
	}

	private renderLaneRow(container: HTMLElement, lane: IProductManagerLaneModel): void {
		const isExpanded = this.expandedLanes.has(lane.id);
		const row = dom.append(container, dom.$('.product-manager-lane-row' + (isExpanded ? '.expanded' : '')));

		const header = dom.append(row, dom.$('.product-manager-lane-header'));
		const chevron = dom.append(header, dom.$('.product-manager-chevron', undefined, isExpanded ? '▾' : '▸'));
		dom.append(header, dom.$('span.product-manager-list-title', undefined, lane.title));
		dom.append(header, dom.$('span.product-manager-tag', undefined, lane.coverageLabel));

		const laneChatIcon = dom.append(header, dom.$('span.product-manager-lane-chat-icon'));
		laneChatIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));
		laneChatIcon.title = localize('askAboutLane', "Ask Copilot about this lane");
		this.renderDisposables.add(dom.addDisposableListener(laneChatIcon, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			const fileLines = (lane.files ?? []).slice(0, 40).join('\n  - ');
			const prompt = `I am looking at the **${lane.title}** architectural lane of this repository.\n\n${lane.summary}\nCoverage: ${lane.coverageLabel}\n\nFiles in this lane:\n  - ${fileLines || '(none)'}\n\n`;
			void this.commandService.executeCommand(OPEN_DISCOVER_CHAT_COMMAND_ID, { query: prompt });
		}));

		const filesContainer = dom.append(row, dom.$('.product-manager-lane-files'));
		dom.append(filesContainer, dom.$('p.product-manager-body', undefined, lane.summary));

		const files = [...(lane.files ?? [])].sort((a, b) => a.localeCompare(b));
		if (files.length > 0) {
			switch (this._viewMode) {
				case 'files':
					this.renderFileSummaryList(filesContainer, files);
					break;
				case 'paths':
					this.renderPathList(filesContainer, files);
					break;
				default:
					this.renderTree(filesContainer, lane.id, files);
					break;
			}
		} else {
			dom.append(filesContainer, dom.$('p.product-manager-body', undefined, localize('noFilesInLane', "No files classified in this lane.")));
		}

		filesContainer.style.display = isExpanded ? '' : 'none';

		this.renderDisposables.add(dom.addDisposableListener(header, dom.EventType.CLICK, () => {
			if (this.expandedLanes.has(lane.id)) {
				this.expandedLanes.delete(lane.id);
				row.classList.remove('expanded');
				chevron.textContent = '▸';
				filesContainer.style.display = 'none';
			} else {
				this.expandedLanes.add(lane.id);
				row.classList.add('expanded');
				chevron.textContent = '▾';
				filesContainer.style.display = '';
			}
		}));
	}

	private renderTree(container: HTMLElement, laneId: string, files: readonly string[]): void {
		const tree = this.buildTree(files);
		const treeRoot = dom.append(container, dom.$('.product-manager-tree-root'));
		for (const node of tree) {
			this.renderTreeNode(treeRoot, laneId, node, 0);
		}
	}

	private renderTreeNode(container: HTMLElement, laneId: string, node: IArchitectureTreeNode, depth: number): void {
		if (node.kind === 'file') {
			const fileRow = dom.append(container, dom.$('.product-manager-tree-row.product-manager-tree-row-file'));
			fileRow.style.paddingLeft = `${depth * 18}px`;

			const icon = dom.append(fileRow, dom.$('span.product-manager-tree-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.fileCode));
			dom.append(fileRow, dom.$('span.product-manager-tree-label', undefined, node.name));
			return;
		}

		const folderKey = `${laneId}:${node.path}`;
		const isExpanded = this.isFolderExpanded(folderKey, depth);
		const folderRow = dom.append(container, dom.$('.product-manager-tree-row.product-manager-tree-row-folder'));
		folderRow.style.paddingLeft = `${depth * 18}px`;

		dom.append(folderRow, dom.$('.product-manager-tree-chevron', undefined, isExpanded ? '▾' : '▸'));
		const icon = dom.append(folderRow, dom.$('span.product-manager-tree-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.folder));
		dom.append(folderRow, dom.$('span.product-manager-tree-label', undefined, node.name));
		dom.append(folderRow, dom.$('span.product-manager-tree-meta', undefined, localize('folderFileCount', "{0} files", node.fileCount)));

		this.renderDisposables.add(dom.addDisposableListener(folderRow, dom.EventType.CLICK, () => {
			this.toggleFolderExpanded(folderKey, depth);
		}));

		if (!isExpanded) {
			return;
		}

		const children = dom.append(container, dom.$('.product-manager-tree-children'));
		for (const child of node.children ?? []) {
			this.renderTreeNode(children, laneId, child, depth + 1);
		}
	}

	private renderFileSummaryList(container: HTMLElement, files: readonly string[]): void {
		const list = dom.append(container, dom.$('.product-manager-file-summary-list'));
		for (const filePath of files) {
			const parts = filePath.split('/');
			const fileName = parts.pop() ?? filePath;
			const parentPath = parts.join('/');
			const row = dom.append(list, dom.$('.product-manager-file-summary-row'));
			const icon = dom.append(row, dom.$('span.product-manager-tree-icon'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.fileCode));
			const text = dom.append(row, dom.$('.product-manager-file-summary-text'));
			dom.append(text, dom.$('span.product-manager-file-summary-name', undefined, fileName));
			dom.append(text, dom.$('span.product-manager-file-summary-path', undefined, parentPath || localize('repoRoot', "Repository Root")));
		}
	}

	private renderPathList(container: HTMLElement, files: readonly string[]): void {
		const list = dom.append(container, dom.$('ul.product-manager-file-list.product-manager-file-list--paths'));
		for (const filePath of files) {
			dom.append(list, dom.$('li.product-manager-file-item', undefined, filePath));
		}
	}

	private buildTree(files: readonly string[]): readonly IArchitectureTreeNode[] {
		const root: IMutableArchitectureTreeNode = {
			kind: 'folder',
			name: '',
			path: '',
			fileCount: 0,
			children: new Map<string, IMutableArchitectureTreeNode>(),
		};

		for (const filePath of files) {
			const parts = filePath.split('/').filter(Boolean);
			let current = root;
			current.fileCount++;
			let currentPath = '';

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				currentPath = currentPath ? `${currentPath}/${part}` : part;

				if (i === parts.length - 1) {
					current.children?.set(part, {
						kind: 'file',
						name: part,
						path: currentPath,
						fileCount: 1,
					});
					continue;
				}

				let next = current.children?.get(part);
				if (!next) {
					next = {
						kind: 'folder',
						name: part,
						path: currentPath,
						fileCount: 0,
						children: new Map<string, IMutableArchitectureTreeNode>(),
					};
					current.children?.set(part, next);
				}

				next.fileCount++;
				current = next;
			}
		}

		return this.finalizeTree(Array.from(root.children?.values() ?? []));
	}

	private finalizeTree(nodes: readonly IMutableArchitectureTreeNode[]): readonly IArchitectureTreeNode[] {
		return nodes
			.map(node => {
				if (node.kind === 'file') {
					return {
						kind: 'file',
						name: node.name,
						path: node.path,
						fileCount: 1,
					} satisfies IArchitectureTreeNode;
				}

				const children = this.finalizeTree(Array.from(node.children?.values() ?? []));
				return this.compactFolder({
					kind: 'folder',
					name: node.name,
					path: node.path,
					fileCount: node.fileCount,
					children,
				});
			})
			.sort((a, b) => {
				if (a.kind !== b.kind) {
					return a.kind === 'folder' ? -1 : 1;
				}
				return a.name.localeCompare(b.name);
			});
	}

	private compactFolder(node: IArchitectureTreeNode): IArchitectureTreeNode {
		if (node.kind !== 'folder') {
			return node;
		}

		let name = node.name;
		let path = node.path;
		let currentChildren = node.children ?? [];

		while (currentChildren.length === 1 && currentChildren[0].kind === 'folder') {
			const child = currentChildren[0];
			name = `${name}/${child.name}`;
			path = child.path;
			currentChildren = child.children ?? [];
		}

		return {
			kind: 'folder',
			name,
			path,
			fileCount: node.fileCount,
			children: currentChildren,
		};
	}

	private isFolderExpanded(key: string, depth: number): boolean {
		if (this.collapsedFolders.has(key)) {
			return false;
		}
		if (this.expandedFolders.has(key)) {
			return true;
		}
		return depth === 0;
	}

	private toggleFolderExpanded(key: string, depth: number): void {
		if (this.isFolderExpanded(key, depth)) {
			this.expandedFolders.delete(key);
			this.collapsedFolders.add(key);
		} else {
			this.collapsedFolders.delete(key);
			this.expandedFolders.add(key);
		}
		this.renderContent();
	}
}
