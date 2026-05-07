/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
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
import { IProductManagerDataService } from '../../../../services/productManager/common/productManager.js';

export class MarketView extends ViewPane {

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
		const market = this.productManagerDataService.getMarket();
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));

		const intro = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(intro, dom.$('.product-manager-section-title', undefined, localize('marketSignals', "Market Signals")));
		dom.append(intro, dom.$('p.product-manager-body', undefined, market.summary));

		const topics = dom.append(intro, dom.$('.product-manager-chip-row'));
		for (const topic of market.topics) {
			dom.append(topics, dom.$('.product-manager-chip', undefined, topic));
		}

		const placeholder = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(placeholder, dom.$('.product-manager-list-title', undefined, localize('refreshModelLater', "Refresh and scheduled market tracking land in a later phase.")));
		if (artifactsState.status === 'ready') {
			dom.append(placeholder, dom.$('span.product-manager-tag', undefined, localize('marketArtifactsReady', "Project artifacts loaded")));
		}
		dom.append(placeholder, dom.$('p.product-manager-body', undefined, localize('marketEmptyState', "This panel is reserved for competitor blurbs, adjacent market headlines, and changes worth discussing with the product team.")));
	}
}
