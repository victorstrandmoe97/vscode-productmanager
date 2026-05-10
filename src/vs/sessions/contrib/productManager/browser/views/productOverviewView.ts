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
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../../../workbench/browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../../../workbench/common/views.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { localize } from '../../../../../nls.js';
import { CONNECT_JIRA_COMMAND_ID, CONNECT_SNYK_COMMAND_ID, IProductManagerDataService } from '../../../../services/productManager/common/productManager.js';

export class ProductOverviewView extends ViewPane {

	private bodyContainer: HTMLElement | undefined;

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
		const overview = this.productManagerDataService.getOverview();
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const featuresMetadata = this.productManagerDataService.getFeaturesMetadata();
		const jira = this.productManagerDataService.getJira();
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));

		// Hero card
		const hero = dom.append(stack, dom.$('.product-manager-card.product-manager-hero'));
		dom.append(hero, dom.$('.product-manager-kicker', undefined, localize('productModeKicker', "Product Mode")));
		dom.append(hero, dom.$('h2.product-manager-title', undefined, overview.title));
		dom.append(hero, dom.$('p.product-manager-body', undefined, overview.summary));

		const actions = dom.append(hero, dom.$('.product-manager-actions'));
		const connectJiraButton = this._register(new Button(actions, defaultButtonStyles));
		connectJiraButton.label = localize('connectJira', "Connect Jira");
		this._register(connectJiraButton.onDidClick(() => this.commandService.executeCommand(CONNECT_JIRA_COMMAND_ID)));

		const connectSnykButton = this._register(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		connectSnykButton.label = localize('connectSnyk', "Connect Snyk");
		this._register(connectSnykButton.onDidClick(() => this.commandService.executeCommand(CONNECT_SNYK_COMMAND_ID)));

		const connectCrmButton = this._register(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		connectCrmButton.label = localize('connectCrmComingSoon', "Connect CRM (Coming Soon)");
		connectCrmButton.enabled = false;
		connectCrmButton.element.setAttribute('title', localize('connectCrmComingSoonTooltip', "Coming Soon"));

		// "What Product Mode Sets Up" — rewritten to reflect what's actually here
		const highlightsCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(highlightsCard, dom.$('.product-manager-section-title', undefined, localize('highlights', "What Product Mode Sets Up")));
		const highlights = dom.append(highlightsCard, dom.$('ul.product-manager-list'));
		for (const highlight of overview.highlights) {
			const item = dom.append(highlights, dom.$('li.product-manager-list-item'));
			dom.append(item, dom.$('span.product-manager-body', undefined, highlight));
		}

		// Artifacts Status — compact chip summary
		const artifactsCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(artifactsCard, dom.$('.product-manager-section-title', undefined, localize('productArtifactsStatus', "Status")));

		const chipRow = dom.append(artifactsCard, dom.$('.product-manager-status-chip-row'));

		// Architecture chip
		if (artifactsState.status === 'ready' && artifactsState.generatedAt) {
			const label = artifactsState.fileCount !== undefined
				? localize('archChipReady', "Architecture · {0} files · {1}", artifactsState.fileCount, this._formatTimestamp(artifactsState.generatedAt))
				: localize('archChipReadyNoCount', "Architecture · {0}", this._formatTimestamp(artifactsState.generatedAt));
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined, label));
		} else if (artifactsState.status === 'loading') {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--loading', undefined,
				localize('archChipLoading', "Architecture · loading…")));
		} else if (artifactsState.status === 'error') {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--error', undefined,
				localize('archChipError', "Architecture · error")));
		} else {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--pending', undefined,
				localize('archChipPending', "Architecture · not loaded")));
		}

		// Features chip
		if (featuresMetadata) {
			const featLabel = localize('featChipReady', "Features · {0} features · {1} stories · {2}",
				featuresMetadata.featureCount, featuresMetadata.userStoryCount, featuresMetadata.llmModel);
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined, featLabel));

			const symbolLabel = localize('symbolChipReady', "Symbols · {0} symbols · {1} files",
				featuresMetadata.symbolsProcessed, featuresMetadata.filesProcessed);
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined, symbolLabel));
		} else {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--pending', undefined,
				localize('featChipPending', "Features · not discovered")));
		}

		if (jira.connection.status === 'connected') {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined,
				localize('jiraChipReady', "Jira · {0} issues · {1} unmapped", jira.issueCount, jira.unmappedIssueCount)));
		} else if (jira.connection.status === 'connecting' || jira.sync.status === 'syncing') {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--loading', undefined,
				localize('jiraChipLoading', "Jira · syncing…")));
		} else if (jira.connection.status === 'error' || jira.connection.status === 'expired' || jira.sync.status === 'error') {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--error', undefined,
				localize('jiraChipError', "Jira · attention needed")));
		} else {
			dom.append(chipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--pending', undefined,
				localize('jiraChipPending', "Jira · not connected")));
		}
	}

	private _formatTimestamp(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		} catch {
			return iso;
		}
	}
}
