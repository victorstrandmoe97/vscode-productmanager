/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
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
	private _discoverButton: Button | undefined;

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

		// Dispose old button before clearing
		if (this._discoverButton) {
			this._discoverButton.dispose();
			this._discoverButton = undefined;
		}

		dom.clearNode(this.bodyContainer);
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const features = this.productManagerDataService.getFeatures();
		const architectureReady = artifactsState.status === 'ready';

		// Header card with intro text and "Discover Features" button
		const intro = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(intro, dom.$('.product-manager-section-title', undefined, localize('featureBreakdown', "Feature Breakdown")));

		let introText: string;
		if (features.length > 0) {
			introText = localize('featureDiscoveredBody', "Features were discovered from code analysis. Click Discover again to refresh.");
		} else if (architectureReady) {
			introText = localize('featureReadyToDiscover', "Architecture is loaded. Click \"Discover Features\" to analyse the codebase and generate product features with user stories.");
		} else {
			introText = localize('featurePlaceholderBody', "Load the architecture map first, then use \"Discover Features\" to derive features from code analysis.");
		}
		dom.append(intro, dom.$('p.product-manager-body', undefined, introText));

		const actionsRow = dom.append(intro, dom.$('.product-manager-actions-row'));

		const discoverButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: !architectureReady }));
		discoverButton.label = localize('discoverFeatures', "Discover Features");
		discoverButton.enabled = architectureReady;
		this._discoverButton = discoverButton;

		this._register(discoverButton.onDidClick(async () => {
			discoverButton.enabled = false;
			discoverButton.label = localize('discoverFeaturesAnalysing', "Analysing code…");
			try {
				await this.productManagerDataService.discoverFeatures();
			} finally {
				discoverButton.enabled = architectureReady;
				discoverButton.label = localize('discoverFeatures', "Discover Features");
			}
		}));

		// Feature list
		if (features.length === 0) {
			return;
		}

		const list = dom.append(stack, dom.$('ul.product-manager-list'));
		for (const feature of features) {
			const item = dom.append(list, dom.$('li.product-manager-list-item'));
			dom.append(item, dom.$('span.product-manager-list-title', undefined, feature.title));
			dom.append(item, dom.$('span.product-manager-body', undefined, feature.summary));

			const laneRow = dom.append(item, dom.$('.product-manager-chip-row'));
			for (const lane of feature.lanes) {
				dom.append(laneRow, dom.$('.product-manager-chip', undefined, lane));
			}

			// User stories
			if (feature.userStories && feature.userStories.length > 0) {
				const storiesLabel = dom.append(item, dom.$('p.product-manager-user-story-label', undefined,
					localize('userStoriesLabel', "User Stories:")));
				storiesLabel.setAttribute('aria-label', localize('userStoriesLabelAriaLabel', "User stories for {0}", feature.title));

				const storiesList = dom.append(item, dom.$('ol.product-manager-user-story-list'));
				for (const story of feature.userStories) {
					const storyItem = dom.append(storiesList, dom.$('li.product-manager-user-story'));
					dom.append(storyItem, dom.$('strong.product-manager-user-story-title', undefined, story.title));
					dom.append(storyItem, dom.$('span.product-manager-user-story-description', undefined, ` — ${story.description}`));
				}
			}
		}
	}
}
