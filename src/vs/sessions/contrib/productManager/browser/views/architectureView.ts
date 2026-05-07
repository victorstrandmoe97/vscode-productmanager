/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
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

		if (!hasRepoId) {
			// No repo connected yet — show primary connect button
			const connectButton = this._register(new Button(actionsRow, defaultButtonStyles));
			connectButton.label = localize('connectRepository', "Connect Repository");
			connectButton.element.title = localize('connectRepositoryTooltip', "Enter a GitHub repository URL and optional PAT to load the architecture map");
			this._register(connectButton.onDidClick(() => void this.runConnectDialog(connectButton)));
		} else {
			// Repo already connected — show load + reconnect options
			const loadButton = this._register(new Button(actionsRow, defaultButtonStyles));
			loadButton.label = localize('loadArchitecture', "Load Architecture");
			this._register(loadButton.onDidClick(async () => {
				loadButton.enabled = false;
				loadButton.label = localize('loadingArchitecture', "Loading…");
				try {
					await this.productManagerDataService.fetchArchitectureFromApi();
				} finally {
					loadButton.enabled = true;
					loadButton.label = localize('loadArchitecture', "Load Architecture");
				}
			}));

			const reconnectButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: true }));
			reconnectButton.label = localize('reconnectRepository', "Change Repository");
			reconnectButton.element.title = localize('reconnectRepositoryTooltip', "Connect a different repository");
			this._register(reconnectButton.onDidClick(() => void this.runConnectDialog(reconnectButton)));
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
	}

	private async runConnectDialog(triggerButton: Button): Promise<void> {
		triggerButton.enabled = false;

		try {
			const repoUrl = await this.quickInputService.input({
				title: localize('connectDialogTitle', "Connect Repository"),
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

			const githubToken = await this.quickInputService.input({
				title: localize('connectDialogPatTitle', "GitHub Personal Access Token"),
				placeHolder: 'ghp_… (leave empty for public repositories)',
				prompt: localize('connectDialogPatPrompt', "Paste your GitHub PAT — used only to clone the repository, never stored"),
				password: true,
				ignoreFocusLost: true,
			});

			// githubToken can be undefined (cancelled) or '' (skipped); treat both as no auth
			await this.productManagerDataService.connectRepository(repoUrl.trim(), githubToken?.trim() || undefined);
		} finally {
			triggerButton.enabled = true;
		}
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
