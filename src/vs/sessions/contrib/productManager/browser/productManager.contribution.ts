/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, WindowEnablement } from '../../../../workbench/common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../../workbench/services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IsAuxiliaryWindowContext } from '../../../../workbench/common/contextkeys.js';
import { Menus } from '../../../browser/menus.js';
import { ProductManagerModeContext } from '../../../common/contextkeys.js';
import { isProductManagerEnabled, CONNECT_CRM_COMMAND_ID, CONNECT_JIRA_COMMAND_ID, IProductManagerDataService, PRODUCT_MANAGER_MODE_SETTING } from '../../../services/productManager/common/productManager.js';
import { ProductManagerDataService } from '../../../services/productManager/browser/productManagerDataService.js';
import {
	PRODUCT_MANAGER_ARCHITECTURE_VIEW_ID,
	PRODUCT_MANAGER_AUXILIARY_CONTAINER_ID,
	PRODUCT_MANAGER_FEATURES_VIEW_ID,
	PRODUCT_MANAGER_JIRA_VIEW_ID,
	PRODUCT_MANAGER_MARKET_VIEW_ID,
	PRODUCT_MANAGER_OVERVIEW_VIEW_ID,
	PRODUCT_MANAGER_SIDEBAR_CONTAINER_ID,
} from './productManager.js';
import { ProductOverviewView } from './views/productOverviewView.js';
import { ArchitectureView } from './views/architectureView.js';
import { FeaturesView } from './views/featuresView.js';
import { JiraView } from './views/jiraView.js';
import { MarketView } from './views/marketView.js';

const productManagerSidebarIcon = registerIcon('product-manager-sidebar-icon', Codicon.repo, localize2('productManagerSidebarIcon', 'View icon for Product Mode.').value);
const productManagerAuxiliaryIcon = registerIcon('product-manager-auxiliary-icon', Codicon.listTree, localize2('productManagerAuxiliaryIcon', 'View icon for the Product Map.').value);

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

const productManagerSidebarContainer = viewContainerRegistry.registerViewContainer({
	id: PRODUCT_MANAGER_SIDEBAR_CONTAINER_ID,
	title: localize2('productSidebarContainer', "Product"),
	icon: productManagerSidebarIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PRODUCT_MANAGER_SIDEBAR_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: PRODUCT_MANAGER_SIDEBAR_CONTAINER_ID,
	hideIfEmpty: true,
	windowEnablement: WindowEnablement.Sessions,
}, ViewContainerLocation.Sidebar);

const productManagerAuxiliaryContainer = viewContainerRegistry.registerViewContainer({
	id: PRODUCT_MANAGER_AUXILIARY_CONTAINER_ID,
	title: localize2('productAuxiliaryContainer', "Product"),
	icon: productManagerAuxiliaryIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PRODUCT_MANAGER_AUXILIARY_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: false }]),
	storageId: PRODUCT_MANAGER_AUXILIARY_CONTAINER_ID,
	hideIfEmpty: true,
	windowEnablement: WindowEnablement.Sessions,
}, ViewContainerLocation.AuxiliaryBar);

viewsRegistry.registerViews([{
	id: PRODUCT_MANAGER_OVERVIEW_VIEW_ID,
	name: localize2('productOverview', "Product Overview"),
	containerIcon: productManagerSidebarIcon,
	ctorDescriptor: new SyncDescriptor(ProductOverviewView),
	canToggleVisibility: false,
	canMoveView: false,
	when: ProductManagerModeContext,
	windowEnablement: WindowEnablement.Sessions,
}], productManagerSidebarContainer);

viewsRegistry.registerViews([{
	id: PRODUCT_MANAGER_ARCHITECTURE_VIEW_ID,
	name: localize2('architecture', "Architecture"),
	containerIcon: productManagerAuxiliaryIcon,
	ctorDescriptor: new SyncDescriptor(ArchitectureView),
	canToggleVisibility: false,
	canMoveView: false,
	when: ProductManagerModeContext,
	windowEnablement: WindowEnablement.Sessions,
}, {
	id: PRODUCT_MANAGER_FEATURES_VIEW_ID,
	name: localize2('features', "Features"),
	containerIcon: productManagerAuxiliaryIcon,
	ctorDescriptor: new SyncDescriptor(FeaturesView),
	canToggleVisibility: false,
	canMoveView: false,
	when: ProductManagerModeContext,
	windowEnablement: WindowEnablement.Sessions,
}, {
	id: PRODUCT_MANAGER_JIRA_VIEW_ID,
	name: localize2('jira', "Jira"),
	containerIcon: productManagerAuxiliaryIcon,
	ctorDescriptor: new SyncDescriptor(JiraView),
	canToggleVisibility: false,
	canMoveView: false,
	when: ProductManagerModeContext,
	windowEnablement: WindowEnablement.Sessions,
}, {
	id: PRODUCT_MANAGER_MARKET_VIEW_ID,
	name: localize2('market', "Market"),
	containerIcon: productManagerAuxiliaryIcon,
	ctorDescriptor: new SyncDescriptor(MarketView),
	canToggleVisibility: false,
	canMoveView: false,
	when: ProductManagerModeContext,
	windowEnablement: WindowEnablement.Sessions,
}], productManagerAuxiliaryContainer);

class ConnectJiraAction extends Action2 {
	constructor() {
		super({
			id: CONNECT_JIRA_COMMAND_ID,
			title: localize2('connectJiraAction', "Connect Jira"),
			category: Categories.View,
			icon: Codicon.linkExternal,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 0,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override run(accessor: ServicesAccessor): void {
		const notificationService = accessor.get(INotificationService);
		notificationService.info(localize('connectJiraPhaseOne', "Jira connection is stubbed in phase 1. The Product Mode shell is ready for the integration workflow."));
	}
}

class ConnectCrmAction extends Action2 {
	constructor() {
		super({
			id: CONNECT_CRM_COMMAND_ID,
			title: localize2('connectCrmAction', "Connect CRM (Coming Soon)"),
			category: Categories.View,
			icon: Codicon.history,
			precondition: ContextKeyExpr.false(),
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 1,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override run(): void {
		// Intentionally disabled in phase 1.
	}
}

class ProductManagerModeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.productManagerMode';

	private readonly productManagerModeContext;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IPaneCompositePartService private readonly paneCompositePartService: IPaneCompositePartService,
	) {
		super();
		this.productManagerModeContext = ProductManagerModeContext.bindTo(this.contextKeyService);
		this.updateMode();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PRODUCT_MANAGER_MODE_SETTING)) {
				this.updateMode();
			}
		}));
	}

	private updateMode(): void {
		const enabled = isProductManagerEnabled(this.configurationService);
		this.productManagerModeContext.set(enabled);
		this.layoutService.mainContainer.classList.toggle('product-manager-workbench', enabled);

		if (!enabled) {
			return;
		}

		this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		void this.paneCompositePartService.openPaneComposite(PRODUCT_MANAGER_SIDEBAR_CONTAINER_ID, ViewContainerLocation.Sidebar);
		void this.paneCompositePartService.openPaneComposite(PRODUCT_MANAGER_AUXILIARY_CONTAINER_ID, ViewContainerLocation.AuxiliaryBar);
	}
}

registerSingleton(IProductManagerDataService, ProductManagerDataService, InstantiationType.Delayed);
registerAction2(ConnectJiraAction);
registerAction2(ConnectCrmAction);
registerWorkbenchContribution2(ProductManagerModeContribution.ID, ProductManagerModeContribution, WorkbenchPhase.AfterRestored);
