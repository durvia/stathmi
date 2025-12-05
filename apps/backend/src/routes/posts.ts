import type { FastifyPluginCallback } from 'fastify';
import type { PostTitlesRequest, PostTitlesResponse } from '@opz-hub/shared';
import { appContext } from '../container.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import { toStringArray } from '../utils/query.js';
import { badRequest } from '../utils/responses.js';
import { parsePagination, parseSort } from './helpers/postsQuery.js';
import { parseTimeRange } from '../utils/timeRange.js';

const normalizeIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((v) => String(v)).filter(Boolean)));
};

const normalizeKeyList = (values: string[]): string =>
  Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort().join(',');

export const postsRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const {
    postsService,
    feedsService,
    followsService,
    tagFollowsService,
    channelFollowsService,
    postMembersRepository,
    snapshotService,
  } = appContext;

  app.get('/', async (request, reply) => {
    const ids = toStringArray((request.query as Record<string, unknown>)?.ids);
    const includeInvalid = (request.query as Record<string, unknown>)?.include_invalid === 'true';
    if (ids.length === 0) {
      return badRequest(reply, 'ids query parameter is required');
    }
    const posts = await postsService.findByIds(ids, includeInvalid);
    return reply.send(posts);
  });

  // 批量获取帖子标题（轻量级）
  app.post<{ Body: PostTitlesRequest; Reply: PostTitlesResponse }>('/titles', async (request, reply) => {
    const body = request.body ?? {};
    const ids = normalizeIds(body.ids);

    if (ids.length === 0) {
      return reply.send({ titles: [] });
    }

    const titles = await postsService.getPostTitlesByIds(ids);
    return reply.send({ titles });
  });

  app.get('/latest', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const cursor = typeof query?.cursor === 'string' ? (query.cursor as string) : undefined;

    if (sort.field === 'weighted') {
      const result = await snapshotService.fetchWithSnapshot({
        limit,
        cursor,
        offset,
        includeInvalid,
        sort,
        extraKey: 'latest',
        fetchSource: (candidateLimit) => postsService.listLatest(candidateLimit, 0, includeInvalid, sort),
      });
      return reply.send(result);
    }

    const result = await postsService.listLatest(limit, offset, includeInvalid, sort);
    return reply.send(result);
  });

  app.get('/trending', { preHandler: optionalAuthMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const cursor = typeof query?.cursor === 'string' ? (query.cursor as string) : undefined;

    if (sort.field === 'weighted') {
      const result = await snapshotService.fetchTrendingWithSnapshot({
        limit,
        cursor,
        offset,
        includeInvalid,
        sort,
      });
      result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
      return reply.send(result);
    }

    const result = await feedsService.listTrending(limit, offset, includeInvalid, sort);
    result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
    return reply.send(result);
  });

  app.get('/trending/recommended', { preHandler: optionalAuthMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const ctx = request.ctx;
    const channelIdsFromQuery = toStringArray(query?.channels);
    const cursor = typeof query?.cursor === 'string' ? (query.cursor as string) : undefined;

    let preferences:
      | {
          tags?: string[];
          channelIds?: string[];
          orientations?: string[];
        }
      | undefined;

    // 显式传入频道筛选时，只按频道筛选（不混合 tags，避免 OR 逻辑干扰）
    const hasExplicitChannelFilter = channelIdsFromQuery.length > 0;

    if (hasExplicitChannelFilter) {
      // 用户显式选择了频道，只按频道筛选
      preferences = {
        channelIds: Array.from(new Set(channelIdsFromQuery)),
      };
    } else if (ctx) {
      // 未显式选择频道，使用用户偏好（关注的频道 + 标签）
      const followedTags = await tagFollowsService.listFollowedTagNames(ctx.userId);
      const channelIds = await channelFollowsService.listFollowedChannelIds(ctx.userId);
      preferences = {
        tags: followedTags,
        channelIds: Array.from(new Set(channelIds)),
        orientations: ctx.session.orientations ?? [],
      };
    }

    if (sort.field === 'weighted') {
      const result = await snapshotService.fetchTrendingWithSnapshot({
        limit,
        cursor,
        offset,
        includeInvalid,
        sort,
        preferences,
      });
      result.posts = await feedsService.markUserParticipation(result.posts, ctx?.userId);
      return reply.send(result);
    }

    const result = await feedsService.listTrendingRecommended(preferences, limit, offset, includeInvalid, sort);
    result.posts = await feedsService.markUserParticipation(result.posts, ctx?.userId);
    return reply.send(result);
  });

  app.get('/trending/new-hot', { preHandler: optionalAuthMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const channelIds = toStringArray(query?.channels);
    const result = await feedsService.listTrendingNewHot(limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
    return reply.send(result);
  });

  app.get('/trending/hidden-gems', { preHandler: optionalAuthMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const channelIds = toStringArray(query?.channels);
    const result = await feedsService.listTrendingHiddenGems(limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
    return reply.send(result);
  });

  app.get('/following', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const userId = request.ctx!.userId;
    const sort = parseSort(query);
    const result = await feedsService.getFollowingFeed(userId, limit, offset, includeInvalid, sort);
    result.posts = await feedsService.markUserParticipation(result.posts, userId);
    return reply.send(result);
  });

  app.get('/following/all', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const userId = request.ctx!.userId;
    const channelIds = toStringArray(query?.channels);
    const authorIds = await followsService.listAuthorIds(userId);
    const tagNames = await tagFollowsService.listFollowedTagNames(userId);
    const result = await feedsService.listFollowingAll(authorIds, tagNames, limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, userId);
    return reply.send(result);
  });

  app.get('/following/authors', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const userId = request.ctx!.userId;
    const channelIds = toStringArray(query?.channels);
    const authorIds = await followsService.listAuthorIds(userId);
    const result = await feedsService.listFollowingAuthors(authorIds, limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, userId);
    return reply.send(result);
  });

  app.get('/following/tags', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const userId = request.ctx!.userId;
    const channelIds = toStringArray(query?.channels);
    const tagNames = await tagFollowsService.listFollowedTagNames(userId);
    const result = await feedsService.listFollowingTags(tagNames, limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, userId);
    return reply.send(result);
  });

  app.get('/following/discord', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const userId = request.ctx!.userId;
    const channelIds = toStringArray(query?.channels);
    // 需要的最大数量：分页窗口 + 缓冲，避免去重后数量不足
    const fetchLimit = limit + offset + 50;
    const { threadIds } = await postMembersRepository.listParticipatedThreadIds(
      userId,
      fetchLimit,
      0,
      includeInvalid
    );
    const result = await feedsService.listFollowingDiscord(threadIds, limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    return reply.send(result);
  });

  app.get('/following/recent-updates', { preHandler: authMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const sort = parseSort(query);
    const userId = request.ctx!.userId;
    const channelIds = toStringArray(query?.channels);
    const authorIds = await followsService.listAuthorIds(userId);
    const tagNames = await tagFollowsService.listFollowedTagNames(userId);
    const result = await feedsService.listFollowingRecentUpdates(authorIds, tagNames, limit, offset, includeInvalid, sort, channelIds.length > 0 ? channelIds : undefined);
    result.posts = await feedsService.markUserParticipation(result.posts, userId);
    return reply.send(result);
  });

  app.get('/custom', { preHandler: optionalAuthMiddleware }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const cursor = typeof query?.cursor === 'string' ? (query.cursor as string) : undefined;
    const sort = parseSort(query);
    const keyword = (query?.q as string) || '';
    const channels = toStringArray(query?.channels);
    const tags = toStringArray(query?.tags);
    const tagRelation = query?.tagRelation === 'AND' ? 'AND' : 'OR';
    const timeRange = typeof query?.timeRange === 'string' ? query.timeRange : undefined;
    const timeFrom = typeof query?.timeFrom === 'string' ? query.timeFrom : undefined;
    const timeTo = typeof query?.timeTo === 'string' ? query.timeTo : undefined;

    const hasKeyword = keyword.trim().length > 0;

    if (sort.field === 'weighted' && !hasKeyword) {
      const parsedTime = parseTimeRange({ timeRange, timeFrom, timeTo });
      const extraKeyParts = [
        'custom',
        `ch=${normalizeKeyList(channels) || 'all'}`,
        `tags=${normalizeKeyList(tags) || 'none'}`,
        `tagRel=${tagRelation}`,
        `time=${parsedTime.preset}`,
        parsedTime.from ? `from=${parsedTime.from}` : '',
        parsedTime.to ? `to=${parsedTime.to}` : '',
      ];
      const extraKey = extraKeyParts.filter(Boolean).join('|');

      const result = await snapshotService.fetchWithSnapshot({
        limit,
        cursor,
        offset,
        includeInvalid,
        sort,
        extraKey,
        fetchSource: (candidateLimit) =>
          feedsService.listCustomFeed(
            {
              keyword,
              channels,
              tags,
              tagRelation,
              sort,
              timeRange,
              timeFrom,
              timeTo,
            },
            candidateLimit,
            0,
            includeInvalid
          ),
      });
      result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
      return reply.send(result);
    }

    const result = await feedsService.listCustomFeed(
      {
        keyword,
        channels,
        tags,
        tagRelation,
        sort,
        timeRange,
        timeFrom,
        timeTo,
      },
      limit,
      offset,
      includeInvalid
    );
    result.posts = await feedsService.markUserParticipation(result.posts, request.ctx?.userId);
    return reply.send(result);
  });

  app.get('/author/:authorId', async (request, reply) => {
    const { authorId } = request.params as { authorId?: string };
    if (!authorId) {
      return badRequest(reply, 'authorId parameter is required');
    }
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const result = await postsService.listByAuthor(authorId, limit, offset, includeInvalid);
    return reply.send(result);
  });

  app.get('/channel/:channelId', async (request, reply) => {
    const { channelId } = request.params as { channelId?: string };
    if (!channelId) {
      return badRequest(reply, 'channelId parameter is required');
    }
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const result = await postsService.listByChannel(channelId, limit, offset, includeInvalid);
    return reply.send(result);
  });

  app.get('/tag/:tagName', async (request, reply) => {
    const { tagName } = request.params as { tagName?: string };
    if (!tagName) {
      return badRequest(reply, 'tagName parameter is required');
    }
    const query = request.query as Record<string, unknown>;
    const { limit, offset, includeInvalid } = parsePagination(query);
    const result = await postsService.listByTag(tagName, limit, offset, includeInvalid);
    return reply.send(result);
  });

  done();
};
