/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
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
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import {
	IProductManagerDataService,
	PRODUCT_MANAGER_REPO_ID_SETTING,
} from '../../../../services/productManager/common/productManager.js';

export class ArchitectureView extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private expandedLanes = new Set<string>();
	private _isBusy = false;

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

		dom.clearNode(this.bodyContainer);
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const hasRepoId = !!(this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '');

		// Header card
		const headerCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(headerCard, dom.$('.product-manager-section-title', undefined, localize('architectureCoverage', "Architecture Coverage")));

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
			// No repo connected yet — show primary connect button
			const connectButton = this._register(new Button(actionsRow, defaultButtonStyles));
			connectButton.label = localize('connectRepository', "Connect Repository");
			connectButton.element.title = localize('connectRepositoryTooltip', "Enter a GitHub repository URL and optional PAT to load the architecture map");
			connectButton.enabled = !busy;
			this._register(connectButton.onDidClick(() => void this.runConnectDialog(connectButton)));
		} else {
			// Repo already connected — show load + reconnect + refresh + delete options
			const loadButton = this._register(new Button(actionsRow, defaultButtonStyles));
			loadButton.label = busy ? localize('loadingArchitecture', "Loading…") : localize('loadArchitecture', "Load Architecture");
			loadButton.enabled = !busy;
			this._register(loadButton.onDidClick(async () => {
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

			const reconnectButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			reconnectButton.label = localize('reconnectRepository', "Change Repository");
			reconnectButton.element.title = localize('reconnectRepositoryTooltip', "Connect a different repository");
			reconnectButton.enabled = !busy;
			this._register(reconnectButton.onDidClick(() => {
				if (this._isBusy) { return; }
				void this.runConnectDialog(reconnectButton);
			}));

			const refreshButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			refreshButton.label = busy ? localize('refreshingArchitecture', "Indexing…") : localize('refreshArchitecture', "Refresh");
			refreshButton.element.title = localize('refreshArchitectureTooltip', "Re-index the repository and reload the architecture map");
			refreshButton.enabled = !busy;
			this._register(refreshButton.onDidClick(async () => {
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

			const deleteButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			deleteButton.label = localize('deleteRepository', "Delete Repository");
			deleteButton.element.title = localize('deleteRepositoryTooltip', "Disconnect this repository and reset all Product Mode state");
			deleteButton.enabled = !busy;
			this._register(deleteButton.onDidClick(async () => {
				if (this._isBusy) { return; }
				deleteButton.enabled = false;
				try {
					await this.productManagerDataService.disconnectRepository();
				} finally {
					deleteButton.enabled = true;
				}
			}));
		}

		// Lane list (only shown when data is ready)
		const lanes = this.productManagerDataService.getArchitecture();
		if (artifactsState.status !== 'ready' || lanes.length === 0) {
			return;
		}

		const laneList = dom.append(stack, dom.$('.product-manager-lane-list'));
		for (const lane of lanes) {
			this.renderLaneRow(laneList, lane);
		}

		// "Ask about architecture" chat entry point at the bottom of the lane list
		const chatCard = dom.append(stack, dom.$('.product-manager-card.product-manager-chat-card'));
		const chatRow = dom.append(chatCard, dom.$('.product-manager-chat-row'));
		const chatIcon = dom.append(chatRow, dom.$('span.product-manager-chat-icon'));
		chatIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));
		dom.append(chatRow, dom.$('span.product-manager-chat-label', undefined, localize('askAboutArchitecture', "Ask Copilot about this architecture")));
		this._register(dom.addDisposableListener(chatCard, dom.EventType.CLICK, () => {
			void this.commandService.executeCommand('workbench.action.chat.open', {
				query: this._buildArchitectureChatPrompt(lanes),
				isPartialQuery: true,
			});
		}));
	}

	private async runConnectDialog(triggerButton: Button): Promise<void> {
		triggerButton.enabled = false;

		try {
			const repoUrl = await this.quickInputService.input({
				title: localize('connectDialogTitle', "Connect Repository (1/3) — URL"),
				placeHolder: 'https://github.com/owner/repo',
				prompt: localize('connectDialogUrlPrompt', "Enter the GitHub repository URL"),
				ignoreFocusLost: true,
				validateInput: (value) => {
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
				return; // user cancelled
			}

			const githubUsername = await this.quickInputService.input({
				title: localize('connectDialogUsernameTitle', "Connect Repository (2/3) — GitHub Username"),
				placeHolder: 'your-github-username (leave empty for public repositories)',
				prompt: localize('connectDialogUsernamePrompt', "Enter your GitHub username — required for private repositories"),
				ignoreFocusLost: true,
			});

			if (githubUsername === undefined) {
				return; // user cancelled
			}

			const githubToken = await this.quickInputService.input({
				title: localize('connectDialogPatTitle', "Connect Repository (3/3) — Personal Access Token"),
				placeHolder: 'ghp_… (leave empty for public repositories)',
				prompt: localize('connectDialogPatPrompt', "Paste your GitHub PAT — kept in memory for this session only, never written to disk"),
				password: true,
				ignoreFocusLost: true,
			});

			if (githubToken === undefined) {
				return; // user cancelled
			}

			// Build token: prefer explicit PAT; fall back to no auth for public repos.
			// Username is stored alongside the token so recook can reuse the same credentials.
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

	private renderLaneRow(container: HTMLElement, lane: { id: string; title: string; summary: string; coverageLabel: string; files?: readonly string[] }): void {
		const isExpanded = this.expandedLanes.has(lane.id);
		const row = dom.append(container, dom.$('.product-manager-lane-row' + (isExpanded ? '.expanded' : '')));

		// Clickable header
		const header = dom.append(row, dom.$('.product-manager-lane-header'));
		// allow-any-unicode-next-line
		const chevron = dom.append(header, dom.$('.product-manager-chevron', undefined, isExpanded ? '▾' : '▸'));
		dom.append(header, dom.$('span.product-manager-list-title', undefined, lane.title));
		dom.append(header, dom.$('span.product-manager-tag', undefined, lane.coverageLabel));

		// Chat icon — opens Copilot with lane-specific context
		const laneChatIcon = dom.append(header, dom.$('span.product-manager-lane-chat-icon'));
		laneChatIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));
		laneChatIcon.title = localize('askAboutLane', "Ask Copilot about this lane");
		this._register(dom.addDisposableListener(laneChatIcon, dom.EventType.CLICK, (e) => {
			dom.EventHelper.stop(e, true);
			const fileLines = (lane.files ?? []).slice(0, 40).join('\n  - ');
			const prompt = `I am looking at the **${lane.title}** architectural lane of this repository.\n\n${lane.summary}\nCoverage: ${lane.coverageLabel}\n\nFiles in this lane:\n  - ${fileLines || '(none)'}\n\n`;
			void this.commandService.executeCommand('workbench.action.chat.open', { query: prompt, isPartialQuery: true });
		}));

		// Collapsible file list
		const filesContainer = dom.append(row, dom.$('.product-manager-lane-files'));
		dom.append(filesContainer, dom.$('p.product-manager-body', undefined, lane.summary));

		if (lane.files && lane.files.length > 0) {
			const fileList = dom.append(filesContainer, dom.$('ul.product-manager-file-list'));
			for (const filePath of lane.files) {
				dom.append(fileList, dom.$('li.product-manager-file-item', undefined, filePath));
			}
		} else {
			dom.append(filesContainer, dom.$('p.product-manager-body', undefined, localize('noFilesInLane', "No files classified in this lane.")));
		}

		filesContainer.style.display = isExpanded ? '' : 'none';

		this._register(dom.addDisposableListener(header, dom.EventType.CLICK, () => {
			if (this.expandedLanes.has(lane.id)) {
				this.expandedLanes.delete(lane.id);
				row.classList.remove('expanded');
				// allow-any-unicode-next-line
				chevron.textContent = '▸';
				filesContainer.style.display = 'none';
			} else {
				this.expandedLanes.add(lane.id);
				row.classList.add('expanded');
				// allow-any-unicode-next-line
				chevron.textContent = '▾';
				filesContainer.style.display = '';
			}
		}));
	}
}
