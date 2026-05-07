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
import { CONNECT_JIRA_COMMAND_ID, IProductManagerDataService } from '../../../../services/productManager/common/productManager.js';

export class JiraView extends ViewPane {

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
		const jira = this.productManagerDataService.getJira();
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));

		const hero = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(hero, dom.$('.product-manager-section-title', undefined, localize('jiraImport', "Jira Import")));
		dom.append(hero, dom.$('p.product-manager-body', undefined, jira.summary));

		const button = this._register(new Button(dom.append(hero, dom.$('.product-manager-actions')), defaultButtonStyles));
		button.label = localize('connectJiraButton', "Connect Jira");
		this._register(button.onDidClick(() => this.commandService.executeCommand(CONNECT_JIRA_COMMAND_ID)));

		const checklistCard = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(checklistCard, dom.$('.product-manager-list-title', undefined, jira.callToAction));
		if (artifactsState.status === 'ready') {
			dom.append(checklistCard, dom.$('p.product-manager-body', undefined, localize('jiraArtifactReadyHint', "Repository artifacts are available, so imported Jira issues can be mapped onto the current product structure.")));
		}
		const list = dom.append(checklistCard, dom.$('ul.product-manager-list'));
		for (const entry of jira.checklist) {
			const item = dom.append(list, dom.$('li.product-manager-list-item'));
			dom.append(item, dom.$('span.product-manager-body', undefined, entry));
		}
	}
}
