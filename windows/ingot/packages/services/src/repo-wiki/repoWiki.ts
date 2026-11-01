import type {
  RepoWikiCancelRequest,
  RepoWikiGenerateRequest,
  RepoWikiGenerateResult,
  RepoWikiModelsRequest,
  RepoWikiModelsResult,
  RepoWikiPageRequest,
  RepoWikiPageResult,
  RepoWikiSnapshot,
  RepoWikiSnapshotRequest,
} from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IRepoWikiService {
  getSnapshot(request: RepoWikiSnapshotRequest): Promise<RepoWikiSnapshot>;
  generate(request: RepoWikiGenerateRequest): Promise<RepoWikiGenerateResult>;
  cancel(request: RepoWikiCancelRequest): Promise<void>;
  readPage(request: RepoWikiPageRequest): Promise<RepoWikiPageResult>;
  listModels(request?: RepoWikiModelsRequest): Promise<RepoWikiModelsResult>;
}

export const IRepoWikiService =
  createServiceDescriptor<IRepoWikiService>(ServiceChannels.RepoWiki);
