/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/productManagerViews.css';
import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
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
import { IProductManagerDataService, IProductManagerFeatureModel } from '../../../../services/productManager/common/productManager.js';


export class FeaturesView extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private _discoverButton: Button | undefined;
	private _isDiscovering = false;

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

		// Dispose old button before clearing
		if (this._discoverButton) {
			this._discoverButton.dispose();
			this._discoverButton = undefined;
		}

		dom.clearNode(this.bodyContainer);
		const stack = dom.append(this.bodyContainer, dom.$('.product-manager-stack'));
		const artifactsState = this.productManagerDataService.getArtifactsState();
		const features = this.productManagerDataService.getFeatures();
		const featuresMetadata = this.productManagerDataService.getFeaturesMetadata();
		const architectureReady = artifactsState.status === 'ready';
		const hasFeatures = features.length > 0;

		// Header card with intro text and action buttons
		const intro = dom.append(stack, dom.$('.product-manager-card'));
		dom.append(intro, dom.$('.product-manager-section-title', undefined, localize('featureBreakdown', "Feature Breakdown")));

		let introText: string;
		if (hasFeatures && featuresMetadata) {
			const ts = this._formatTimestamp(featuresMetadata.discoveredAt);
			introText = localize('featureDiscoveredBody', "{0} features · {1} user stories · discovered {2} via {3}",
				featuresMetadata.featureCount, featuresMetadata.userStoryCount, ts, featuresMetadata.llmModel);
		} else if (hasFeatures) {
			introText = localize('featureDiscoveredBodySimple', "Features were discovered from code analysis. Click Refresh to re-run.");
		} else if (architectureReady) {
			introText = localize('featureReadyToDiscover', "Architecture is loaded. Click \"Discover Features\" to analyse the codebase and generate product features with user stories.");
		} else {
			introText = localize('featurePlaceholderBody', "Load the architecture map first, then use \"Discover Features\" to derive features from code analysis.");
		}
		dom.append(intro, dom.$('p.product-manager-body', undefined, introText));

		const actionsRow = dom.append(intro, dom.$('.product-manager-actions-row'));

		const isRunning = this._isDiscovering;
		const primaryLabel = isRunning
			? localize('discoverFeaturesAnalysing', "Analysing code…")
			: hasFeatures
				? localize('refreshFeatures', "Refresh Features")
				: localize('discoverFeatures', "Discover Features");

		const discoverButton = this._register(new Button(actionsRow, { ...defaultButtonStyles, secondary: hasFeatures && !isRunning }));
		discoverButton.label = primaryLabel;
		discoverButton.enabled = architectureReady && !isRunning;
		this._discoverButton = discoverButton;

		this._register(discoverButton.onDidClick(async () => {
			if (this._isDiscovering) { return; }
			this._isDiscovering = true;
			this.renderContent();
			try {
				await this.productManagerDataService.discoverFeatures();
			} finally {
				this._isDiscovering = false;
				this.renderContent();
			}
		}));

		// Feature list
		if (features.length === 0) {
			return;
		}

		const list = dom.append(stack, dom.$('ul.product-manager-list'));
		for (const feature of features) {
			const item = dom.append(list, dom.$('li.product-manager-list-item'));

			// Title row with chat icon
			const titleRow = dom.append(item, dom.$('.product-manager-list-title-row'));
			dom.append(titleRow, dom.$('span.product-manager-list-title', undefined, feature.title));
			const featureChatIcon = dom.append(titleRow, dom.$('span.product-manager-lane-chat-icon'));
			featureChatIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.commentDiscussion));
			featureChatIcon.title = localize('askAboutFeature', "Ask Copilot about this feature");
			this._register(dom.addDisposableListener(featureChatIcon, dom.EventType.CLICK, () => {
				void this.commandService.executeCommand('workbench.action.chat.open', {
					query: this._buildFeatureChatPrompt(feature),
					isPartialQuery: true,
				});
			}));

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

	private _formatTimestamp(iso: string): string {
		try {
			return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
		} catch {
			return iso;
		}
	}

	private _buildFeatureChatPrompt(feature: IProductManagerFeatureModel): string {
		const laneList = feature.lanes.join(', ') || 'none';
		let prompt = `I am looking at the **${feature.title}** feature in this repository.\n\n${feature.summary}\n\nArchitectural lanes: ${laneList}\n`;

		if (feature.userStories && feature.userStories.length > 0) {
			const storiesBlock = feature.userStories.map((s, i) =>
				`${i + 1}. **${s.title}** — ${s.description}`
			).join('\n');
			prompt += `\nUser stories discovered from the code:\n${storiesBlock}\n`;
		}

		prompt += '\n';
		return prompt;
	}
}
