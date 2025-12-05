import type { PaginatedPosts, Post, SearchQueryParams } from '@opz-hub/shared';
import type { PostsSearchRepository, SortOption } from '../repositories/search/postsSearchRepository.js';
import type { PostsReadRepository, PostTitle } from '../repositories/db/postsReadRepository.js';

export class PostsService {
  constructor(
    private readonly searchRepository: PostsSearchRepository,
    private readonly readRepository: PostsReadRepository
  ) {}

  private markFollowed(posts: Post[]): Post[] {
    return posts.map((post) => ({ ...post, isFollowedByUser: true }));
  }

  public async listLatest(
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listLatest(limit, offset, includeInvalid, sort);
  }

  public async findByIds(ids: string[], includeInvalid = false): Promise<Post[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.readRepository.findByIds(ids, includeInvalid);
  }

  public async findByThreadOrMessageIds(ids: string[], includeInvalid = false): Promise<Post[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.readRepository.findByThreadOrMessageIds(ids, includeInvalid);
  }

  public async findById(id: string, includeInvalid = false): Promise<Post | null> {
    return this.readRepository.findById(id, includeInvalid);
  }

  public async listByAuthor(
    authorId: string,
    limit = 10,
    offset = 0,
    includeInvalid = false,
    channelId?: string,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByAuthor(authorId, limit, offset, includeInvalid, channelId, sort);
  }

  public async listByAuthors(
    authorIds: string[],
    limit = 10,
    offset = 0,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByAuthors(authorIds, limit, offset, sortByUpdated, includeInvalid, sort);
  }

  public async listByChannel(
    channelId: string,
    limit = 10,
    offset = 0,
    includeInvalid = false
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByChannel(channelId, limit, offset, includeInvalid);
  }

  public async listByTag(tagName: string, limit = 10, offset = 0, includeInvalid = false): Promise<PaginatedPosts> {
    return this.searchRepository.listByTag(tagName, limit, offset, includeInvalid);
  }

  public async listByTags(
    tagNames: string[],
    limit = 10,
    offset = 0,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByTags(tagNames, limit, offset, sortByUpdated, includeInvalid, sort);
  }

  public async listByAuthorsOrTags(
    authorIds: string[],
    tagNames: string[],
    limit = 10,
    offset = 0,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByAuthorsOrTags(
      authorIds,
      tagNames,
      limit,
      offset,
      sortByUpdated,
      includeInvalid,
      sort,
      channelIds
    );
  }

  public async listByIds(ids: string[], limit = 10, offset = 0, includeInvalid = false): Promise<PaginatedPosts> {
    const orderedIds = Array.from(new Set(ids.map((id) => String(id)).filter(Boolean)));
    const posts = await this.readRepository.findByIds(orderedIds, includeInvalid);
    const postMap = new Map(posts.map((post) => [post.id, post]));
    const orderedPosts = orderedIds
      .map((id) => postMap.get(id))
      .filter((post): post is NonNullable<typeof post> => Boolean(post));

    const start = Math.min(offset, orderedPosts.length);
    const end = Math.min(offset + limit, orderedPosts.length);
    return {
      posts: orderedPosts.slice(start, end),
      total: orderedPosts.length,
    };
  }

  public async search(params: SearchQueryParams = {}, includeInvalid = false): Promise<PaginatedPosts> {
    return this.searchRepository.search(params, includeInvalid);
  }

  // 获取热门帖子（按互动倒序）
  public async listTrending(
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listTrendingRecommended(undefined, limit, offset, includeInvalid, sort);
  }

  public async listTrendingRecommended(
    preferences: { tags?: string[]; channelIds?: string[]; orientations?: string[] } | undefined,
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listTrendingRecommended(preferences, limit, offset, includeInvalid, sort);
  }

  public async listNewHot(
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listNewHot(limit, offset, includeInvalid, sort);
  }

  public async listHiddenGems(
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listHiddenGems(limit, offset, includeInvalid, sort);
  }

  public async listFollowingAuthors(
    authorIds: string[],
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByAuthors(authorIds, limit, offset, false, includeInvalid, sort, channelIds);
  }

  public async listFollowingTags(
    tagNames: string[],
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listByTags(tagNames, limit, offset, false, includeInvalid, sort, channelIds);
  }

  public async listFollowingAll(
    authorIds: string[],
    tagNames: string[],
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    return this.listByAuthorsOrTags(authorIds, tagNames, limit, offset, false, includeInvalid, sort, channelIds);
  }

  public async listFollowingRecentUpdates(
    authorIds: string[],
    tagNames: string[],
    limit = 10,
    offset = 0,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const fetchLimit = limit + offset + 20;
    const raw = await this.listByAuthorsOrTags(authorIds, tagNames, fetchLimit, 0, true, includeInvalid, sort, channelIds);
    const filtered = raw.posts.filter((post) => {
      if (!post.updatedAt) return false;
      const updated = new Date(post.updatedAt);
      const created = new Date(post.createdAt);
      return updated.getTime() > created.getTime();
    });

    return {
      posts: filtered.slice(offset, offset + limit),
      total: filtered.length,
    };
  }

  public async listFollowingDiscord(
    postIds: string[],
    limit = 10,
    offset = 0,
    includeInvalid = false,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    if (postIds.length === 0) {
      return { posts: [], total: 0 };
    }
    // 先获取所有帖子，再按频道过滤
    const allPosts = await this.readRepository.findByIds(postIds, includeInvalid);
    const postMap = new Map(allPosts.map((post) => [post.id, post]));
    let orderedPosts = postIds
      .map((id) => postMap.get(id))
      .filter((post): post is NonNullable<typeof post> => Boolean(post));

    // 按频道过滤
    if (channelIds && channelIds.length > 0) {
      const channelSet = new Set(channelIds);
      orderedPosts = orderedPosts.filter((post) => channelSet.has(post.categoryId));
    }

    const start = Math.min(offset, orderedPosts.length);
    const end = Math.min(offset + limit, orderedPosts.length);
    return {
      posts: this.markFollowed(orderedPosts.slice(start, end)),
      total: orderedPosts.length,
    };
  }

  // 自定义订阅流
  public async listCustom(
    params: {
      channels?: string[];
      tags?: string[];
      tagRelation?: 'AND' | 'OR';
      keyword?: string;
      sort?: SortOption;
      timeRange?: string;
      timeFrom?: string;
      timeTo?: string;
    },
    limit = 10,
    offset = 0,
    includeInvalid = false
  ): Promise<PaginatedPosts> {
    return this.searchRepository.listCustom(params, limit, offset, includeInvalid);
  }

  // 批量获取帖子标题
  public async getPostTitlesByIds(ids: string[]): Promise<PostTitle[]> {
    if (ids.length === 0) return [];
    return this.readRepository.getPostTitlesByIds(ids);
  }
}
