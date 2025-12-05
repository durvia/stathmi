import type { MeiliSearch, SearchParams } from 'meilisearch';
import type { PaginatedPosts, Post, SearchQueryParams } from '@opz-hub/shared';
import type { PostsSearchRepository, SortOption } from './postsSearchRepository.js';
import { rerank, calculateCandidateSize } from '../../utils/smartRanking.js';
import { mapPostToSearchDoc, mapSearchDocToPost, type PostSearchDoc } from '../../domain/post.js';
import type { PostsReadRepository } from '../db/postsReadRepository.js';
import { buildSearchSort, parseSortParam, resolveSort as resolveSortConfig } from '../../sorting/sort.js';

const isMeiliError = (error: unknown): error is { code?: string } => {
  return Boolean(error && typeof error === 'object' && 'code' in error);
};

const escapeFilterValue = (value: string): string => value.replace(/"/g, '\\"');

const parsedCandidateLimit = Number(process.env.RERANK_CANDIDATE_LIMIT ?? 1200);
const RERANK_CANDIDATE_LIMIT = Number.isFinite(parsedCandidateLimit) && parsedCandidateLimit > 0 ? parsedCandidateLimit : 1200;

// 将 ISO 日期字符串转换为 Unix 时间戳（毫秒），用于 Meilisearch 数值比较
const toTimestamp = (isoString: string): number => {
  const parsed = new Date(isoString).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export class MeilisearchPostsSearchRepository implements PostsSearchRepository {
  private readonly indexName: string;
  private readonly enableFallback: boolean;

  constructor(
    private readonly searchClient: MeiliSearch,
    private readonly postsReadRepository: PostsReadRepository,
    indexName?: string
  ) {
    this.indexName = indexName ?? process.env.MEILI_INDEX_POSTS ?? 'posts';
    this.enableFallback = process.env.MEILI_FALLBACK_ENABLED !== 'false';
  }

  private buildBaseFilters(includeInvalid: boolean, extraFilters: string[] = []): string[] {
    const filters = ['isDeleted = false'];
    if (!includeInvalid) {
      filters.push('isValid != false');
    }
    return [...filters, ...extraFilters];
  }

  private buildInExpression(field: string, values: string[]): string | undefined {
    if (!values.length) return undefined;
    const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
    if (!unique.length) {
      return undefined;
    }
    const parts = unique.map((value) => `${field} = "${escapeFilterValue(value)}"`).join(' OR ');
    return `(${parts})`;
  }

  private buildFilterString(filters: string[]): string | undefined {
    const normalized = filters.map((value) => value.trim()).filter(Boolean);
    if (!normalized.length) {
      return undefined;
    }
    return normalized.join(' AND ');
  }

  private resolveDefaultSort(sortByUpdated?: boolean): string[] {
    if (sortByUpdated) {
      return ['lastActiveAt:desc', 'createdAt:desc'];
    }
    return ['createdAt:desc'];
  }

  private async executeSearch(
    query: string,
    filters: string[],
    options: Omit<SearchParams, 'filter'> & { sort?: string[] }
  ): Promise<PaginatedPosts> {
    const index = this.searchClient.index(this.indexName);
    const filterString = this.buildFilterString(filters);
    const searchOptions: SearchParams = {
      ...options,
      filter: filterString,
    };
    const result = await index.search<PostSearchDoc>(query, searchOptions);
    let posts = result.hits.map((hit) => mapSearchDocToPost(hit));

    // 兜底：检测缺失文档并回库修复
    if (this.enableFallback && result.estimatedTotalHits && posts.length < result.estimatedTotalHits) {
      const foundIds = new Set(posts.map((p) => p.id));
      const missingIds = (result.hits ?? [])
        .map((hit) => String(hit.id))
        .filter((id) => !foundIds.has(id));

      if (missingIds.length > 0) {
        const repaired = await this.readAndRepair(missingIds, options.limit ?? missingIds.length, filters);
        // 合并修复后的帖子，保持现有排序顺序（缺失的按追加）
        posts = [...posts, ...repaired];
      }
    }

    // 兜底：Meili 文档存在但 content 为空时，回库修复（常见于历史数据缺字段）
    if (this.enableFallback) {
      const missingContentIds = posts
        .filter((post) => !post.content || post.content.trim().length === 0)
        .map((post) => post.id);

      if (missingContentIds.length > 0) {
        const repaired = await this.readAndRepair(missingContentIds, missingContentIds.length, filters);
        if (repaired.length > 0) {
          const repairedMap = new Map(repaired.map((post) => [post.id, post]));
          posts = posts.map((post) => repairedMap.get(post.id) ?? post);
        }
      }
    }

    return {
      posts,
      total: result.estimatedTotalHits ?? 0,
    };
  }

  /**
   * 执行带智能重排序的搜索（两阶段排序）
   *
   * ⚠️ 重要：智能排序仅适用于无关键词浏览场景
   * 有关键词搜索时应使用 Meilisearch 的相关度排序
   */
  private async executeSearchWithSmartRanking(
    query: string,
    filters: string[],
    limit: number,
    offset: number,
    sort: SortOption | undefined
  ): Promise<PaginatedPosts> {
    const cfg = resolveSortConfig(sort);
    const order = cfg.order === 'asc' ? 'asc' : 'desc';
    const hasKeyword = Boolean(query.trim());

    // 🔍 关键改进：有关键词时，直接使用 Meilisearch 相关度排序
    // 原因：智能排序算法不考虑关键词匹配度，会导致不相关的高互动内容排在前面
    if (hasKeyword) {
      return this.executeSearch(query, filters, {
        sort: undefined, // 使用 Meilisearch 的相关度排序
        limit,
        offset,
      });
    }

    // 超出重排窗口的页直接使用单层排序，保证稳定但避免重复
    if (offset >= RERANK_CANDIDATE_LIMIT) {
      return this.executeSearch(query, filters, {
        sort: [`reactionCount:${order}`, `messageCount:${order}`, `createdAt:${order}`],
        limit,
        offset,
      });
    }

    // 计算候选集大小（固定窗口，避免跨页候选集变化导致重复）
    const candidateSize = Math.min(
      RERANK_CANDIDATE_LIMIT,
      Math.max(calculateCandidateSize(limit, offset), offset + limit)
    );

    // 阶段 1：Meilisearch 粗排（获取候选集）
    // 无关键词场景：按互动+时间获取高质量候选
    const { posts: candidates, total } = await this.executeSearch(query, filters, {
      sort: [`reactionCount:${order}`, `messageCount:${order}`, `createdAt:${order}`],
      limit: candidateSize,
      offset: 0, // 候选集从头开始
    });

    // 阶段 2：应用层精排（综合互动度、时间衰减、推荐加权）
    const reranked = rerank(candidates, order);

    // 分页：从重排序结果中提取目标页
    const start = Math.min(offset, reranked.length);
    const end = Math.min(offset + limit, reranked.length);
    const paginatedPosts = reranked.slice(start, end);

    return {
      posts: paginatedPosts,
      total, // 保持原始总数
    };
  }

  async listLatest(limit: number, offset: number, includeInvalid = false, sort?: SortOption): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid);

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, ['createdAt:desc']);
    return this.executeSearch('', filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async findByIds(ids: string[], includeInvalid = false): Promise<Post[]> {
    if (ids.length === 0) {
      return [];
    }
    const idFilter = this.buildInExpression('id', ids);
    const filters = this.buildBaseFilters(includeInvalid, idFilter ? [idFilter] : []);
    const { posts } = await this.executeSearch('', filters, {
      limit: ids.length,
    });
    const hitMap = new Map(posts.map((post) => [post.id, post]));
    return ids.map((id) => hitMap.get(id)).filter((post): post is Post => Boolean(post));
  }

  async findById(id: string, includeInvalid = false): Promise<Post | null> {
    try {
      const doc = (await this.searchClient.index(this.indexName).getDocument<PostSearchDoc>(id)) as PostSearchDoc;
      if (doc.isDeleted) {
        return null;
      }
      if (!includeInvalid && doc.isValid === false) {
        return null;
      }
      return mapSearchDocToPost(doc);
    } catch (error: unknown) {
      if (isMeiliError(error) && error.code === 'document_not_found') {
        // 回库兜底：读 PG 并即时修复索引
        const post = await this.postsReadRepository.findById(id, includeInvalid);
        if (!post) return null;
        await this.repairIndex([post]);
        return { ...post, isFollowedByUser: post.isFollowedByUser ?? false };
      }
      throw error;
    }
  }

  /**
   * 回库并修复索引（缺失或软删矫正）
   */
  private async readAndRepair(ids: string[], limit: number, filters: string[]): Promise<Post[]> {
    const posts = await this.postsReadRepository.findByIds(ids, true);
    if (!posts.length) return [];

    // 软删矫正：若 PG 已删除/无效，写入 isDeleted=true / isValid=false
    const sanitized = posts.map((post) => {
      if (!post.isValid) {
        return { ...post, isDeleted: true, isValid: false };
      }
      return post;
    });

    await this.repairIndex(sanitized);

    // 过滤 includeInvalid=true 场景下的 isDeleted
    const includeInvalid = !filters.includes('isValid != false');
    return sanitized.filter((p) => includeInvalid || p.isValid !== false);
  }

  private async repairIndex(posts: Post[]): Promise<void> {
    if (!posts.length) return;
    await this.searchClient.index(this.indexName).addDocuments(posts.map(mapPostToSearchDoc), { primaryKey: 'id' });
  }

  async listByAuthor(
    authorId: string,
    limit: number,
    offset: number,
    includeInvalid = false,
    channelId?: string,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid, [`authorId = "${escapeFilterValue(authorId)}"`]);
    if (channelId) {
      filters.push(`categoryId = "${escapeFilterValue(channelId)}"`);
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, ['lastActiveAt:desc', 'createdAt:desc']);
    return this.executeSearch('', filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listByAuthors(
    authorIds: string[],
    limit: number,
    offset: number,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    if (authorIds.length === 0) {
      return { posts: [], total: 0 };
    }
    const authorFilter = this.buildInExpression('authorId', authorIds);
    const filters = this.buildBaseFilters(includeInvalid, authorFilter ? [authorFilter] : []);

    // 频道筛选
    if (channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', channelIds);
      if (channelExpr) {
        filters.push(channelExpr);
      }
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, this.resolveDefaultSort(sortByUpdated));
    return this.executeSearch('', filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listByChannel(
    channelId: string,
    limit: number,
    offset: number,
    includeInvalid = false
  ): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid, [`categoryId = "${escapeFilterValue(channelId)}"`]);
    return this.executeSearch('', filters, {
      sort: ['createdAt:desc'],
      limit,
      offset,
    });
  }

  async listByTag(tagName: string, limit: number, offset: number, includeInvalid = false): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid, [`tags = "${escapeFilterValue(tagName)}"`]);
    return this.executeSearch('', filters, {
      sort: ['createdAt:desc'],
      limit,
      offset,
    });
  }

  async listByTags(
    tagNames: string[],
    limit: number,
    offset: number,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    if (tagNames.length === 0) {
      return { posts: [], total: 0 };
    }
    const tagsFilter = this.buildInExpression('tags', tagNames);
    const filters = this.buildBaseFilters(includeInvalid, tagsFilter ? [tagsFilter] : []);

    // 频道筛选
    if (channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', channelIds);
      if (channelExpr) {
        filters.push(channelExpr);
      }
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, this.resolveDefaultSort(sortByUpdated));
    return this.executeSearch('', filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listByAuthorsOrTags(
    authorIds: string[],
    tagNames: string[],
    limit: number,
    offset: number,
    sortByUpdated = false,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    if (authorIds.length === 0 && tagNames.length === 0) {
      return { posts: [], total: 0 };
    }
    const filters = this.buildBaseFilters(includeInvalid);
    const orParts: string[] = [];
    const authorFilter = this.buildInExpression('authorId', authorIds);
    const tagsFilter = this.buildInExpression('tags', tagNames);
    if (authorFilter) {
      orParts.push(authorFilter);
    }
    if (tagsFilter) {
      orParts.push(tagsFilter);
    }
    if (orParts.length > 0) {
      filters.push(`(${orParts.join(' OR ')})`);
    }

    // 频道筛选
    if (channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', channelIds);
      if (channelExpr) {
        filters.push(channelExpr);
      }
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, this.resolveDefaultSort(sortByUpdated));
    return this.executeSearch('', filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listByIds(ids: string[], limit: number, offset: number, includeInvalid = false): Promise<PaginatedPosts> {
    if (ids.length === 0) {
      return { posts: [], total: 0 };
    }
    const idFilter = this.buildInExpression('id', ids);
    const filters = this.buildBaseFilters(includeInvalid, idFilter ? [idFilter] : []);
    return this.executeSearch('', filters, {
      sort: ['createdAt:desc'],
      limit,
      offset,
    });
  }

  async search(params: SearchQueryParams, includeInvalid = false): Promise<PaginatedPosts> {
    const keyword = typeof params.q === 'string' ? params.q.trim() : '';
    const limit = typeof params.limit === 'number' ? params.limit : 10;
    const offset = typeof params.offset === 'number' ? params.offset : 0;
    const filters = this.buildBaseFilters(includeInvalid);

    if (params.tags?.length) {
      const relation = params.tagRelation === 'AND' ? ' AND ' : ' OR ';
      const tagFilters = params.tags.map((tag) => `tags = "${escapeFilterValue(tag)}"`).join(relation);
      filters.push(`(${tagFilters})`);
    }

    if (params.category) {
      filters.push(`categoryId = "${escapeFilterValue(params.category)}"`);
    }

    if (params.timeFrom) {
      filters.push(`createdAt >= ${toTimestamp(params.timeFrom)}`);
    }

    if (params.timeTo) {
      filters.push(`createdAt <= ${toTimestamp(params.timeTo)}`);
    }

    // 检查是否使用智能排序
    const parsedSort = parseSortParam(params.sort);
    if (parsedSort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking(keyword, filters, limit, offset, parsedSort);
    }

    let sortRules: string[] | undefined;
    if (parsedSort) {
      sortRules = buildSearchSort(parsedSort, ['createdAt:desc']);
    } else if (!keyword) {
      sortRules = ['createdAt:desc'];
    }

    return this.executeSearch(keyword, filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listCustom(
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
    limit: number,
    offset: number,
    includeInvalid = false
  ): Promise<PaginatedPosts> {
    const filters: string[] = this.buildBaseFilters(includeInvalid);

    if (params.channels?.length) {
      const channelFilters = params.channels.map((id) => `categoryId = "${escapeFilterValue(id)}"`).join(' OR ');
      filters.push(`(${channelFilters})`);
    }

    if (params.tags?.length) {
      const relation = params.tagRelation === 'AND' ? ' AND ' : ' OR ';
      const tagFilters = params.tags.map((tag) => `tags = "${escapeFilterValue(tag)}"`).join(relation);
      filters.push(`(${tagFilters})`);
    }

    if (params.timeFrom) {
      filters.push(`createdAt >= ${toTimestamp(params.timeFrom)}`);
    }

    if (params.timeTo) {
      filters.push(`createdAt <= ${toTimestamp(params.timeTo)}`);
    }

    const keyword = params.keyword?.trim() || '';

    // 检查是否使用智能排序
    if (params.sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking(keyword, filters, limit, offset, params.sort);
    }

    const sortRules = buildSearchSort(params.sort, ['messageCount:desc', 'createdAt:desc']);

    return this.executeSearch(keyword, filters, {
      sort: sortRules,
      limit,
      offset,
    });
  }

  async listTrendingRecommended(
    preferences: { tags?: string[]; channelIds?: string[]; orientations?: string[] } | undefined,
    limit: number,
    offset: number,
    includeInvalid = false,
    sort?: SortOption
  ): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid);
    const orParts: string[] = [];

    if (preferences?.channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', preferences.channelIds);
      if (channelExpr) {
        orParts.push(channelExpr);
      }
    }

    if (preferences?.tags?.length) {
      const tagsExpr = this.buildInExpression('tags', preferences.tags);
      if (tagsExpr) {
        orParts.push(tagsExpr);
      }
    }

    if (orParts.length > 0) {
      filters.push(`(${orParts.join(' OR ')})`);
    }

    // orientations 暂无对应字段，预留

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, ['messageCount:desc', 'reactionCount:desc', 'createdAt:desc']);
    return this.executeSearch('', filters, { sort: sortRules, limit, offset });
  }

  async listNewHot(limit: number, offset: number, includeInvalid = false, sort?: SortOption, channelIds?: string[]): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid);
    const sevenDaysAgoTs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    filters.push(`createdAt >= ${sevenDaysAgoTs}`);
    filters.push('(reactionCount > 10 OR messageCount > 5)');

    // 频道筛选
    if (channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', channelIds);
      if (channelExpr) {
        filters.push(channelExpr);
      }
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, ['reactionCount:desc', 'messageCount:desc', 'createdAt:desc']);
    return this.executeSearch('', filters, { sort: sortRules, limit, offset });
  }

  async listHiddenGems(
    limit: number,
    offset: number,
    includeInvalid = false,
    sort?: SortOption,
    channelIds?: string[]
  ): Promise<PaginatedPosts> {
    const filters = this.buildBaseFilters(includeInvalid);
    const thirtyDaysAgoTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSevenDaysTs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    filters.push(`createdAt < ${thirtyDaysAgoTs}`);
    filters.push(`lastActiveAt >= ${recentSevenDaysTs}`);

    // 频道筛选
    if (channelIds?.length) {
      const channelExpr = this.buildInExpression('categoryId', channelIds);
      if (channelExpr) {
        filters.push(channelExpr);
      }
    }

    // 检查是否使用智能排序
    if (sort?.field === 'weighted') {
      return this.executeSearchWithSmartRanking('', filters, limit, offset, sort);
    }

    const sortRules = buildSearchSort(sort, ['lastActiveAt:desc', 'messageCount:desc']);
    return this.executeSearch('', filters, { sort: sortRules, limit, offset });
  }
}
