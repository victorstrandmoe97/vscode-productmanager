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

export class FeaturesView extends ViewPane {

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
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));
		const artifactsState = this.productManagerDataService.getArtifactsState();

		const intro = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(intro, dom.$('.product-manager-section-title', undefined, localize('featureBreakdown', "Feature Breakdown")));
		dom.append(intro, dom.$('p.product-manager-body', undefined, artifactsState.status === 'ready'
			? localize('featureReadyBody', "Feature rows were restored from persisted repository artifacts.")
			: localize('featurePlaceholderBody', "Feature rows are stubbed for phase 1. Later phases will derive them from code-only analysis and persist them inside `.vscode/product-manager/features.json`.")));

		const list = dom.append(stack, dom.$('ul.product-manager-list'));
		for (const feature of this.productManagerDataService.getFeatures()) {
			const item = dom.append(list, dom.$('li.product-manager-list-item'));
			dom.append(item, dom.$('span.product-manager-list-title', undefined, feature.title));
			dom.append(item, dom.$('span.product-manager-body', undefined, feature.summary));
			const laneRow = dom.append(item, dom.$('.product-manager-chip-row'));
			for (const lane of feature.lanes) {
				dom.append(laneRow, dom.$('.product-manager-chip', undefined, lane));
			}
		}
	}
}
