/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
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
import { ASK_COPILOT_ABOUT_JIRA_ISSUE_COMMAND_ID, CONNECT_JIRA_COMMAND_ID, CONNECT_SNYK_COMMAND_ID, DISCONNECT_JIRA_COMMAND_ID, IProductManagerDataService, OPEN_JIRA_ISSUE_COMMAND_ID, REFRESH_JIRA_COMMAND_ID } from '../../../../services/productManager/common/productManager.js';

const snykButtonStyles = {
	...defaultButtonStyles,
	buttonBackground: '#4C4A73',
	buttonHoverBackground: '#362F78',
	buttonForeground: '#FFFFFF',
	buttonBorder: '#FF69C6',
};

export class JiraView extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private readonly renderDisposables = this._register(new DisposableStore());

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

		this.renderDisposables.clear();
		dom.clearNode(this.bodyContainer);
		const jira = this.productManagerDataService.getJira();
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));

		const hero = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(hero, dom.$('.product-manager-section-title', undefined, localize('jiraImport', "Jira Import")));
		dom.append(hero, dom.$('p.product-manager-body', undefined, jira.summary));
		if (jira.connection.siteName) {
			dom.append(hero, dom.$('p.product-manager-body', undefined, localize('jiraConnectedSite', "Connected Site: {0}", jira.connection.siteName)));
		}

		const actions = dom.append(hero, dom.$('.product-manager-actions.product-manager-actions--stacked'));
		if (jira.connection.status === 'connected') {
			const refreshButton = this.renderDisposables.add(new Button(actions, defaultButtonStyles));
			refreshButton.label = jira.sync.status === 'syncing' ? localize('refreshJiraLoading', "Refreshing Jira…") : localize('refreshJiraButton', "Refresh Jira");
			this.renderDisposables.add(refreshButton.onDidClick(() => this.commandService.executeCommand(REFRESH_JIRA_COMMAND_ID)));

			const changeProjectsButton = this.renderDisposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
			changeProjectsButton.label = localize('changeJiraProjectsButton', "Change Jira Projects");
			this.renderDisposables.add(changeProjectsButton.onDidClick(() => this.commandService.executeCommand(CONNECT_JIRA_COMMAND_ID)));

			const disconnectButton = this.renderDisposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
			disconnectButton.label = localize('disconnectJiraButton', "Disconnect Jira");
			this.renderDisposables.add(disconnectButton.onDidClick(() => this.commandService.executeCommand(DISCONNECT_JIRA_COMMAND_ID)));
		} else {
			const button = this.renderDisposables.add(new Button(actions, defaultButtonStyles));
			button.label = localize('connectJiraButton', "Connect Jira");
			this.renderDisposables.add(button.onDidClick(() => this.commandService.executeCommand(CONNECT_JIRA_COMMAND_ID)));
		}

		const connectSnykButton = this.renderDisposables.add(new Button(actions, snykButtonStyles));
		connectSnykButton.label = localize('connectSnykButton', "Connect Snyk");
		connectSnykButton.element.classList.add('product-manager-snyk-button');
		this.renderDisposables.add(connectSnykButton.onDidClick(() => this.commandService.executeCommand(CONNECT_SNYK_COMMAND_ID)));

		const syncCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(syncCard, dom.$('.product-manager-list-title', undefined, jira.callToAction));
		const syncStatusClass = jira.sync.status === 'success'
			? 'product-manager-status-chip--ready'
			: jira.sync.status === 'syncing'
				? 'product-manager-status-chip--loading'
				: jira.sync.status === 'error'
					? 'product-manager-status-chip--error'
					: 'product-manager-status-chip--pending';
		const syncChipRow = dom.append(syncCard, dom.$('.product-manager-status-chip-row'));
		dom.append(syncChipRow, dom.$(`span.product-manager-status-chip.${syncStatusClass}`, undefined, localize('jiraConnectionChip', "Connection · {0}", jira.connection.status)));
		dom.append(syncChipRow, dom.$(`span.product-manager-status-chip.${syncStatusClass}`, undefined, localize('jiraSyncChip', "Sync · {0}", jira.sync.status)));
		dom.append(syncChipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined, localize('jiraIssueCountChip', "Issues · {0}", jira.issueCount)));
		if (jira.selectedProjects.length > 0) {
			dom.append(syncChipRow, dom.$('span.product-manager-status-chip.product-manager-status-chip--ready', undefined, localize('jiraProjectsChip', "Projects · {0}", jira.selectedProjects.join(', '))));
		}
		if (jira.sync.message) {
			dom.append(syncCard, dom.$('p.product-manager-body', undefined, jira.sync.message));
		}
		if (jira.sync.lastError) {
			dom.append(syncCard, dom.$('p.product-manager-body.product-manager-jira-error', undefined, jira.sync.lastError));
		}
		if (artifactsState.status === 'ready') {
			dom.append(syncCard, dom.$('p.product-manager-body', undefined, localize('jiraArtifactReadyHint', "Repository artifacts are available, so imported Jira issues can be mapped onto the current product structure.")));
		}

		const checklistCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(checklistCard, dom.$('.product-manager-list-title', undefined, localize('jiraWorkflowChecklist', "Integration Workflow")));
		const list = dom.append(checklistCard, dom.$('ul.product-manager-list'));
		for (const entry of jira.checklist) {
			const item = dom.append(list, dom.$('li.product-manager-list-item'));
			dom.append(item, dom.$('span.product-manager-body', undefined, entry));
		}

		const issuesCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(issuesCard, dom.$('.product-manager-list-title', undefined, localize('jiraImportedIssuesTitle', "Imported Issues")));
		if (jira.issues.length === 0) {
			dom.append(issuesCard, dom.$('p.product-manager-body', undefined, localize('jiraNoIssues', "No Jira issues have been imported yet.")));
			return;
		}

		const issueList = dom.append(issuesCard, dom.$('ul.product-manager-list'));
		for (const issueModel of jira.issues) {
			const item = dom.append(issueList, dom.$('li.product-manager-list-item'));
			const titleRow = dom.append(item, dom.$('.product-manager-list-title-row'));
			dom.append(titleRow, dom.$('span.product-manager-list-title', undefined, `${issueModel.issue.key} · ${issueModel.issue.summary}`));
			const mappingLabel = issueModel.mapping?.featureTitle
				? localize('jiraIssueMappedTag', "Mapped · {0}", issueModel.mapping.featureTitle)
				: localize('jiraIssueUnmappedTag', "Unmapped");
			dom.append(titleRow, dom.$('span.product-manager-tag', undefined, mappingLabel));
			dom.append(item, dom.$('span.product-manager-body', undefined, localize('jiraIssueMeta', "{0} · {1} · Updated {2}", issueModel.issue.issueType, issueModel.issue.status, issueModel.issue.updated || 'n/a')));
			if (issueModel.mapping?.reason) {
				dom.append(item, dom.$('span.product-manager-body', undefined, issueModel.mapping.reason));
			}

			const issueActions = dom.append(item, dom.$('.product-manager-actions-row'));
			const openIssueButton = this.renderDisposables.add(new Button(issueActions, { ...defaultButtonStyles, secondary: true }));
			openIssueButton.label = localize('openJiraIssueButton', "Open in Jira");
			this.renderDisposables.add(openIssueButton.onDidClick(() => this.commandService.executeCommand(OPEN_JIRA_ISSUE_COMMAND_ID, issueModel.issue.key)));

			const askCopilotButton = this.renderDisposables.add(new Button(issueActions, defaultButtonStyles));
			askCopilotButton.label = localize('askCopilotAboutIssueButton', "Ask Copilot");
			this.renderDisposables.add(askCopilotButton.onDidClick(() => this.commandService.executeCommand(ASK_COPILOT_ABOUT_JIRA_ISSUE_COMMAND_ID, issueModel.issue.key)));
		}
	}
}
