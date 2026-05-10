/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ProductManagerToolId } from './toolProfiles.js';

export const PRODUCT_MANAGER_LOCAL_MANIFEST_PATH = '.vscode/product-manager.local.json';

export type ProductManagerJsonPrimitive = string | number | boolean | null;
export type ProductManagerJsonValue = ProductManagerJsonPrimitive | ProductManagerJsonObject | readonly ProductManagerJsonValue[];

export interface ProductManagerJsonObject {
	readonly [key: string]: ProductManagerJsonValue | undefined;
}

export interface IRepoToolBinding {
	readonly profileId?: string;
	readonly selectors?: ProductManagerJsonObject;
}

export interface IRepoToolConfig {
	readonly enabled: boolean;
	readonly autoRefresh: boolean;
	readonly binding?: IRepoToolBinding;
}

export interface IProductManagerRepoManifest {
	readonly version: 1;
	readonly productManager: {
		readonly tools: Partial<Record<ProductManagerToolId, IRepoToolConfig>>;
	};
}

export interface IRepoManifestReference {
	readonly repoId: string;
	readonly repoUrl: string;
	readonly repoRootPath: string;
}

export interface IRepoManifestService {
	readonly _serviceBrand: undefined;

	getManifest(reference: IRepoManifestReference): Promise<IProductManagerRepoManifest | undefined>;
	saveManifest(reference: IRepoManifestReference, manifest: IProductManagerRepoManifest): Promise<void>;
}

export const IRepoManifestService = createDecorator<IRepoManifestService>('repoManifestService');
