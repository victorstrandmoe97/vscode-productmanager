/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ViewPaneContainer } from '../../../../workbench/browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, WindowEnablement } from '../../../../workbench/common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../../workbench/services/layout/browser/layoutService.js';
import { IPaneCompositePartService } from '../../../../workbench/services/panecomposite/browser/panecomposite.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IPreferencesService } from '../../../../workbench/services/preferences/common/preferences.js';
import { IsAuxiliaryWindowContext } from '../../../../workbench/common/contextkeys.js';
import { Menus } from '../../../browser/menus.js';
import { ProductManagerModeContext } from '../../../common/contextkeys.js';
import { JiraApiClient } from '../../../services/productManager/browser/jiraApiClient.js';
import { JiraAuthService } from '../../../services/productManager/browser/jiraAuthService.js';
import { JiraMappingService } from '../../../services/productManager/browser/jiraMappingService.js';
import { GITHUB_REMOTE_FILE_SCHEME } from '../../../services/sessions/common/session.js';
import { JiraSyncService } from '../../../services/productManager/browser/jiraSyncService.js';
import { IJiraApiClient, IJiraAuthService, IJiraMappingService, IJiraSyncService } from '../../../services/productManager/common/jira.js';
import { isProductManagerEnabled, ASK_COPILOT_ABOUT_JIRA_ISSUE_COMMAND_ID, CONFIGURE_CLAUDE_COMMAND_ID, CONFIGURE_OPENAI_AZURE_COMMAND_ID, CONNECT_CRM_COMMAND_ID, CONNECT_JIRA_COMMAND_ID, CONNECT_SNYK_COMMAND_ID, DISCONNECT_JIRA_COMMAND_ID, IProductManagerDataService, OPEN_DISCOVER_CHAT_COMMAND_ID, OPEN_JIRA_ISSUE_COMMAND_ID, OPEN_LOCAL_CHAT_COMMAND_ID, PRODUCT_MANAGER_MODE_SETTING, PRODUCT_MANAGER_REPO_URL_SETTING, REFRESH_JIRA_COMMAND_ID } from '../../../services/productManager/common/productManager.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
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
import { NewChatViewPane, SessionsViewId } from '../../chat/browser/newChatViewPane.js';
import { COPILOT_PROVIDER_ID } from '../../copilotChatSessions/browser/copilotChatSessionsProvider.js';
import { IViewsService } from '../../../../workbench/services/views/common/viewsService.js';

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

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const productManagerDataService = accessor.get(IProductManagerDataService);

		const siteUrl = await quickInputService.input({
			title: localize('connectJiraStepOneTitle', "Connect Jira (1/5) — Site URL"),
			placeHolder: 'https://your-company.atlassian.net',
			prompt: localize('connectJiraStepOnePrompt', "Enter your Jira Cloud site URL"),
			ignoreFocusLost: true,
			validateInput: value => {
				if (!value.trim()) {
					return Promise.resolve(localize('connectJiraSiteRequired', "Jira site URL is required."));
				}
				if (!/atlassian\.net/i.test(value)) {
					return Promise.resolve(localize('connectJiraSiteInvalid', "Enter a Jira Cloud URL such as https://your-company.atlassian.net."));
				}
				return Promise.resolve(undefined);
			},
		});
		if (!siteUrl) {
			return;
		}

		const email = await quickInputService.input({
			title: localize('connectJiraStepTwoTitle', "Connect Jira (2/5) — Email"),
			placeHolder: 'name@company.com',
			prompt: localize('connectJiraStepTwoPrompt', "Enter the Atlassian account email for your Jira API token"),
			ignoreFocusLost: true,
			validateInput: value => Promise.resolve(value.trim() ? undefined : localize('connectJiraEmailRequired', "Email is required.")),
		});
		if (!email) {
			return;
		}

		const apiToken = await quickInputService.input({
			title: localize('connectJiraStepThreeTitle', "Connect Jira (3/5) — API Token"),
			placeHolder: 'Paste Jira API token',
			prompt: localize('connectJiraStepThreePrompt', "Paste your Jira API token. It will be stored securely in secret storage."),
			password: true,
			ignoreFocusLost: true,
			validateInput: value => Promise.resolve(value.trim() ? undefined : localize('connectJiraTokenRequired', "API token is required.")),
		});
		if (!apiToken) {
			return;
		}

		const projectKeysInput = await quickInputService.input({
			title: localize('connectJiraStepFourTitle', "Connect Jira (4/5) — Project Keys"),
			placeHolder: 'PROJ, CORE',
			prompt: localize('connectJiraStepFourPrompt', "Enter one or more Jira project keys separated by commas."),
			ignoreFocusLost: true,
			validateInput: value => Promise.resolve(parseProjectKeys(value).length > 0 ? undefined : localize('connectJiraProjectsRequired', "Enter at least one Jira project key.")),
		});
		if (!projectKeysInput) {
			return;
		}

		const jql = await quickInputService.input({
			title: localize('connectJiraStepFiveTitle', "Connect Jira (5/5) — Optional Extra JQL"),
			placeHolder: 'statusCategory != Done',
			prompt: localize('connectJiraStepFivePrompt', "Optional extra JQL used to narrow the Product Mode Jira sync."),
			ignoreFocusLost: true,
		});
		if (jql === undefined) {
			return;
		}

		await productManagerDataService.connectJira({
			siteUrl: siteUrl.trim(),
			email: email.trim(),
			apiToken: apiToken.trim(),
			projectKeys: parseProjectKeys(projectKeysInput),
			jql: jql.trim() || undefined,
		});
	}
}

class RefreshJiraAction extends Action2 {
	constructor() {
		super({
			id: REFRESH_JIRA_COMMAND_ID,
			title: localize2('refreshJiraAction', "Refresh Jira"),
			category: Categories.View,
			icon: Codicon.refresh,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 1,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IProductManagerDataService).refreshJira();
	}
}

class DisconnectJiraAction extends Action2 {
	constructor() {
		super({
			id: DISCONNECT_JIRA_COMMAND_ID,
			title: localize2('disconnectJiraAction', "Disconnect Jira"),
			category: Categories.View,
			icon: Codicon.debugDisconnect,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 2,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IProductManagerDataService).disconnectJira();
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

class ConnectSnykAction extends Action2 {
	constructor() {
		super({
			id: CONNECT_SNYK_COMMAND_ID,
			title: localize2('connectSnykAction', "Connect Snyk"),
			category: Categories.View,
			icon: Codicon.shield,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 2,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const openerService = accessor.get(IOpenerService);
		const logService = accessor.get(ILogService);
		const snykUri = URI.parse('https://app.snyk.io/login');

		logService.info('[ProductManager] connectSnyk: opening %s', snykUri.toString());

		try {
			await openerService.open(snykUri, { openExternal: true });
			notificationService.info(localize('connectSnykOpened', "Opened Snyk in your browser to start the connection flow."));
		} catch (error) {
			logService.error('[ProductManager] connectSnyk: failed to open Snyk', error);
			notificationService.error(localize('connectSnykFailed', "Failed to open Snyk: {0}", error instanceof Error ? error.message : String(error)));
		}
	}
}

class OpenJiraIssueAction extends Action2 {
	constructor() {
		super({
			id: OPEN_JIRA_ISSUE_COMMAND_ID,
			title: localize2('openJiraIssueAction', "Open Jira Issue"),
			category: Categories.View,
			icon: Codicon.linkExternal,
		});
	}

	override async run(accessor: ServicesAccessor, issueKey: string): Promise<void> {
		await accessor.get(IProductManagerDataService).openJiraIssue(issueKey);
	}
}

class AskCopilotAboutJiraIssueAction extends Action2 {
	constructor() {
		super({
			id: ASK_COPILOT_ABOUT_JIRA_ISSUE_COMMAND_ID,
			title: localize2('askCopilotAboutJiraIssueAction', "Ask Copilot About Jira Issue"),
			category: Categories.View,
			icon: Codicon.commentDiscussion,
		});
	}

	override async run(accessor: ServicesAccessor, issueKey: string): Promise<void> {
		await accessor.get(IProductManagerDataService).askCopilotAboutJiraIssue(issueKey);
	}
}

function parseProjectKeys(value: string): string[] {
	return [...new Set(value.split(',').map(part => part.trim().toUpperCase()).filter(Boolean))];
}

function parseGitHubOwnerRepo(repoUrl: string): { owner: string; repo: string } | undefined {
	const match = repoUrl.trim().replace(/\.git$/, '').match(/github\.com[/:](?<owner>[^/]+)\/(?<repo>[^/]+)/i);
	if (!match?.groups) {
		return undefined;
	}

	return {
		owner: match.groups.owner,
		repo: match.groups.repo,
	};
}

class OpenDiscoverChatAction extends Action2 {
	constructor() {
		super({
			id: OPEN_DISCOVER_CHAT_COMMAND_ID,
			title: localize2('openDiscoverChatAction', "Open Discover Chat"),
			category: Categories.View,
			icon: Codicon.commentDiscussion,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 3,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor, options?: { query?: string }): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const sessionsManagementService = accessor.get(ISessionsManagementService);
		const sessionsProvidersService = accessor.get(ISessionsProvidersService);
		const viewsService = accessor.get(IViewsService);

		const repoUrl = (configurationService.getValue<string>(PRODUCT_MANAGER_REPO_URL_SETTING) || '').trim();
		if (!repoUrl) {
			notificationService.info(localize('openDiscoverChatNoRepo', "Connect a GitHub repository before opening Discover Chat."));
			return;
		}

		const repoInfo = parseGitHubOwnerRepo(repoUrl);
		if (!repoInfo) {
			notificationService.error(localize('openDiscoverChatInvalidRepo', "The connected repository URL is not a supported GitHub repository: {0}", repoUrl));
			return;
		}

		const repoUri = URI.from({
			scheme: GITHUB_REMOTE_FILE_SCHEME,
			authority: 'github',
			path: `/${encodeURIComponent(repoInfo.owner)}/${encodeURIComponent(repoInfo.repo)}/HEAD`,
		});

		const provider = sessionsProvidersService.getProvider(COPILOT_PROVIDER_ID);
		const workspace = provider?.resolveWorkspace(repoUri);
		if (!provider || !workspace) {
			logService.error('[ProductManager] openDiscoverChat: failed to resolve workspace for %s', repoUri.toString());
			notificationService.error(localize('openDiscoverChatResolveFailed', "Couldn't open Discover Chat for {0}.", `${repoInfo.owner}/${repoInfo.repo}`));
			return;
		}

		sessionsManagementService.openNewSessionView();
		const view = await viewsService.openView<NewChatViewPane>(SessionsViewId, true);
		view?.selectWorkspace({ providerId: provider.id, workspace });
		if (options?.query) {
			view?.prefillInput(options.query);
		}
	}
}

class OpenLocalChatAction extends Action2 {
	constructor() {
		super({
			id: OPEN_LOCAL_CHAT_COMMAND_ID,
			title: localize2('openLocalChatAction', "Use Local Checkout"),
			category: Categories.View,
			icon: Codicon.folderLibrary,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 4,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const sessionsManagementService = accessor.get(ISessionsManagementService);
		const sessionsProvidersService = accessor.get(ISessionsProvidersService);
		const viewsService = accessor.get(IViewsService);

		const selected = await fileDialogService.showOpenDialog({
			title: localize('openLocalChatFolderTitle', "Choose a Local Checkout"),
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			openLabel: localize('openLocalChatFolderButton', "Use Checkout"),
		});
		const folder = selected?.[0];
		if (!folder) {
			return;
		}

		const provider = sessionsProvidersService.getProvider(COPILOT_PROVIDER_ID);
		const workspace = provider?.resolveWorkspace(folder);
		if (!provider || !workspace) {
			logService.error('[ProductManager] openLocalChat: failed to resolve local workspace for %s', folder.toString());
			notificationService.error(localize('openLocalChatResolveFailed', "Couldn't open a local chat for {0}.", folder.fsPath || folder.path));
			return;
		}

		sessionsManagementService.openNewSessionView();
		const view = await viewsService.openView<NewChatViewPane>(SessionsViewId, true);
		view?.selectWorkspace({ providerId: provider.id, workspace });
	}
}

class ConfigureOpenAIAzureAction extends Action2 {
	constructor() {
		super({
			id: CONFIGURE_OPENAI_AZURE_COMMAND_ID,
			title: localize2('configureOpenAIAzureAction', "Configure OpenAI / Azure"),
			category: Categories.View,
			icon: Codicon.openai,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 5,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const preferencesService = accessor.get(IPreferencesService);
		const notificationService = accessor.get(INotificationService);

		await preferencesService.openUserSettings({
			jsonEditor: false,
			query: '@id:github.copilot.chat.azureModels @id:github.copilot.chat.customOAIModels',
		});

		notificationService.info(localize(
			'configureOpenAIAzureHint',
			"Configure Azure in 'github.copilot.chat.azureModels' or OpenAI-compatible hosts in 'github.copilot.chat.customOAIModels'."
		));
	}
}

class ConfigureClaudeAction extends Action2 {
	constructor() {
		super({
			id: CONFIGURE_CLAUDE_COMMAND_ID,
			title: localize2('configureClaudeAction', "Configure Claude"),
			category: Categories.View,
			icon: Codicon.claude,
			menu: {
				id: Menus.TitleBarSessionMenu,
				group: '0_product',
				order: 6,
				when: ContextKeyExpr.and(ProductManagerModeContext, IsAuxiliaryWindowContext.toNegated()),
			},
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const notificationService = accessor.get(INotificationService);

		await commandService.executeCommand('workbench.action.openSettings', '@id:chat.agentHost.enabled @id:chat.agentHost.claudeAgent.path');
		notificationService.info(localize(
			'configureClaudeHint',
			"Enable 'chat.agentHost.enabled' and set 'chat.agentHost.claudeAgent.path' to a local Claude SDK install to expose Claude in local chat."
		));
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

class ProductManagerSetupTakeoverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.productManagerSetupTakeover';

	private _didEnforceInitialSetup = false;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
	) {
		super();

		this._register(autorun(reader => {
			if (this._didEnforceInitialSetup) {
				return;
			}

			if (!isProductManagerEnabled(this.configurationService)) {
				this._didEnforceInitialSetup = true;
				return;
			}

			const activeSession = this.sessionsManagementService.activeSession.read(reader);
			const workspace = activeSession?.workspace.read(reader);
			const repoUri = workspace?.repositories[0]?.uri;

			this._didEnforceInitialSetup = true;
			if (repoUri?.scheme !== GITHUB_REMOTE_FILE_SCHEME && repoUri?.scheme !== Schemas.file) {
				this.sessionsManagementService.openNewSessionView();
			}
		}));
	}
}

registerSingleton(IJiraAuthService, JiraAuthService, InstantiationType.Delayed);
registerSingleton(IJiraApiClient, JiraApiClient, InstantiationType.Delayed);
registerSingleton(IJiraSyncService, JiraSyncService, InstantiationType.Delayed);
registerSingleton(IJiraMappingService, JiraMappingService, InstantiationType.Delayed);
registerSingleton(IProductManagerDataService, ProductManagerDataService, InstantiationType.Delayed);
registerAction2(ConnectJiraAction);
registerAction2(RefreshJiraAction);
registerAction2(DisconnectJiraAction);
registerAction2(ConnectCrmAction);
registerAction2(ConnectSnykAction);
registerAction2(OpenJiraIssueAction);
registerAction2(AskCopilotAboutJiraIssueAction);
registerAction2(OpenDiscoverChatAction);
registerAction2(OpenLocalChatAction);
registerAction2(ConfigureOpenAIAzureAction);
registerAction2(ConfigureClaudeAction);
registerWorkbenchContribution2(ProductManagerModeContribution.ID, ProductManagerModeContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ProductManagerSetupTakeoverContribution.ID, ProductManagerSetupTakeoverContribution, WorkbenchPhase.AfterRestored);
