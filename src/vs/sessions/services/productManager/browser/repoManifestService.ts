/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductManagerRepoManifest, IRepoManifestReference, IRepoManifestService, IRepoToolBinding, IRepoToolConfig, PRODUCT_MANAGER_LOCAL_MANIFEST_PATH, ProductManagerJsonObject } from '../common/repoManifest.js';

const LOG_PREFIX = '[RepoManifestService]';

export class RepoManifestService extends Disposable implements IRepoManifestService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getManifest(reference: IRepoManifestReference): Promise<IProductManagerRepoManifest | undefined> {
		const manifestUri = this.getManifestUri(reference);
		if (!await this.fileService.exists(manifestUri)) {
			return undefined;
		}

		try {
			const content = await this.fileService.readFile(manifestUri);
			const parsed = JSON.parse(content.value.toString()) as unknown;
			return this.validateManifest(parsed);
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} getManifest: failed to load %s`, manifestUri.toString(), error);
			throw new Error(`Failed to load Product Mode manifest from ${manifestUri.fsPath}`);
		}
	}

	async saveManifest(reference: IRepoManifestReference, manifest: IProductManagerRepoManifest): Promise<void> {
		const manifestUri = this.getManifestUri(reference);
		await this.fileService.createFolder(joinPath(URI.file(reference.repoRootPath), '.vscode'));
		await this.fileService.writeFile(manifestUri, VSBuffer.fromString(JSON.stringify(manifest, null, '\t')));
	}

	private getManifestUri(reference: IRepoManifestReference): URI {
		return joinPath(URI.file(reference.repoRootPath), PRODUCT_MANAGER_LOCAL_MANIFEST_PATH);
	}

	private validateManifest(value: unknown): IProductManagerRepoManifest {
		if (!value || typeof value !== 'object') {
			throw new Error('Manifest must be a JSON object.');
		}

		const candidate = value as { version?: number; productManager?: { tools?: Record<string, unknown> } };
		const tools = candidate.productManager?.tools ?? {};
		return {
			version: 1,
			productManager: {
				tools: {
					features: this.readToolConfig(tools['features']),
					jira: this.readToolConfig(tools['jira']),
				},
			},
		};
	}

	private readToolConfig(value: unknown): IRepoToolConfig | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}

		const candidate = value as { enabled?: boolean; autoRefresh?: boolean; binding?: unknown };
		return {
			enabled: candidate.enabled !== false,
			autoRefresh: candidate.autoRefresh !== false,
			binding: this.readBinding(candidate.binding),
		};
	}

	private readBinding(value: unknown): IRepoToolBinding | undefined {
		if (!value || typeof value !== 'object') {
			return undefined;
		}

		const candidate = value as { profileId?: string; selectors?: ProductManagerJsonObject };
		return {
			profileId: typeof candidate.profileId === 'string' && candidate.profileId ? candidate.profileId : undefined,
			selectors: this.readSelectors(candidate.selectors),
		};
	}

	private readSelectors(value: unknown): ProductManagerJsonObject | undefined {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return undefined;
		}

		return value as ProductManagerJsonObject;
	}
}
