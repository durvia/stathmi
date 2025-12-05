import type { PaginatedPosts, Post } from '@opz-hub/shared';
import type { SortOption } from '../repositories/search/postsSearchRepository.js';
import type { PostsService } from './postsService.js';
import type { FavoritesService } from './favoritesService.js';
import type { KyselyPostMembersRepository } from '../repositories/db/PostMembersRepository.kysely.js';
import { sortPosts as sortPostsByOption } from '../domain/post.sort.js';
import { parseTimeRange } from '../utils/timeRange.js';
import type { PostsSearchRepository } from '../repositories/search/postsSearchRepository.js';

export class FeedsService {
  constructor(
    private readonly postsService: PostsService,
    private readonly favoritesService: FavoritesService,
    private readonly postMembersRepository: KyselyPostMembersRepository,
    private readonly postsSearchRepository: PostsSearchRepository
  ) {}

  private sortResult(result: PaginatedPosts, sort: SortOption | undefined): PaginatedPosts {
    return { ...result, posts: sortPostsByOption(result.posts, sort) };
  }

  // 标记用户在 Discord 参与的帖子
  async markUserParticipation(posts: Post[], userId: string | undefined): Promise<Post[]> {
    if (!userId || posts.length === 0) return posts;

    const postIds = posts.map((p) => p.id);
    const participatedSet = await this.postMembersRepository.filterParticipatedThreadIds(userId, postIds);

    return posts.map((post) => ({
      ...post,
      isFollowedByUser: participatedSet.has(post.id),
    }));
  }

  async getFollowingFeed(
    userId: string,
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined
  ): Promise<PaginatedPosts> {
    const favorites = await this.favoritesService.list(userId, includeInvalid);
    const favoritePosts = favorites.map((item) => item.post);
    const favoriteIds = new Set(favoritePosts.map((post) => post.id));

    // 需要的最大数量：分页窗口 + 已有收藏数量 + 缓冲，避免去重后数量不足
    const fetchLimit = limit + offset + favoritePosts.length + 50;
    const participated = await this.postMembersRepository.listParticipatedThreadIds(
      userId,
      fetchLimit,
      0,
      includeInvalid
    );
    const missingParticipatedIds = participated.threadIds.filter((id) => !favoriteIds.has(id));
    const participatedPosts =
      missingParticipatedIds.length > 0
        ? await this.postsService.findByIds(missingParticipatedIds, includeInvalid)
        : [];

    const combined = sortPostsByOption([...favoritePosts, ...participatedPosts], sort);
    const sliced = combined.slice(offset, offset + limit);
    return {
      posts: sliced,
      total: combined.length,
    };
  }

  async listFollowingAll(
    authorIds: string[],
    tagNames: string[],
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsService.listFollowingAll(authorIds, tagNames, limit, offset, includeInvalid, sort, channelIds);
    return this.sortResult(result, sort);
  }

  async listFollowingAuthors(
    authorIds: string[],
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsService.listFollowingAuthors(authorIds, limit, offset, includeInvalid, sort, channelIds);
    return this.sortResult(result, sort);
  }

  async listFollowingTags(
    tagNames: string[],
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsService.listFollowingTags(tagNames, limit, offset, includeInvalid, sort, channelIds);
    return this.sortResult(result, sort);
  }

  async listFollowingDiscord(
    postIds: string[],
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsService.listFollowingDiscord(postIds, limit, offset, includeInvalid, channelIds);
    return this.sortResult(result, sort);
  }

  async listFollowingRecentUpdates(
    authorIds: string[],
    tagNames: string[],
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsService.listFollowingRecentUpdates(
      authorIds,
      tagNames,
      limit,
      offset,
      includeInvalid,
      sort,
      channelIds
    );
    return this.sortResult(result, sort);
  }

  async listCustomFeed(
    params: {
      keyword?: string;
      channels?: string[];
      tags?: string[];
      tagRelation?: 'AND' | 'OR';
      sort?: SortOption;
      timeRange?: string;
      timeFrom?: string;
      timeTo?: string;
    },
    limit: number,
    offset: number,
    includeInvalid: boolean
  ): Promise<PaginatedPosts> {
    const time = parseTimeRange(params);
    const result = await this.postsService.listCustom(
      {
        keyword: params.keyword,
        channels: params.channels,
        tags: params.tags,
        tagRelation: params.tagRelation,
        sort: params.sort,
        timeRange: time.preset,
        timeFrom: time.from,
        timeTo: time.to,
      },
      limit,
      offset,
      includeInvalid
    );
    return this.sortResult(result, params.sort);
  }

  async listTrending(
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined
  ): Promise<PaginatedPosts> {
    const result = await this.postsSearchRepository.listTrendingRecommended(
      undefined,
      limit,
      offset,
      includeInvalid,
      sort
    );
    return this.sortResult(result, sort);
  }

  async listTrendingRecommended(
    preferences:
      | {
          tags?: string[];
          channelIds?: string[];
          orientations?: string[];
        }
      | undefined,
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined
  ): Promise<PaginatedPosts> {
    const result = await this.postsSearchRepository.listTrendingRecommended(
      preferences,
      limit,
      offset,
      includeInvalid,
      sort
    );
    return this.sortResult(result, sort);
  }

  async listTrendingNewHot(
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsSearchRepository.listNewHot(limit, offset, includeInvalid, sort, channelIds);
    return this.sortResult(result, sort);
  }

  async listTrendingHiddenGems(
    limit: number,
    offset: number,
    includeInvalid: boolean,
    sort: SortOption | undefined,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const result = await this.postsSearchRepository.listHiddenGems(limit, offset, includeInvalid, sort, channelIds);
    return this.sortResult(result, sort);
  }
}
