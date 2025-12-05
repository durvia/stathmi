import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import fastifyOauth2 from '@fastify/oauth2';
import type * as fastifyOauth2Types from '@fastify/oauth2';
import { ErrorCode } from '@opz-hub/shared';
import { createRequestContext, UnauthorizedError } from '../types/request-context.js';
import { OAuthService } from '../services/oauth-service.js';
import type { DiscordOAuthUser } from '../services/oauth-service.js';
import { appContext } from '../container.js';
import type { SessionData } from '../lib/session-store.js';

const buildErrorRedirect = (baseUrl: string, code: string) => {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}error=${code}`;
};

const discordConfiguration = (
  fastifyOauth2 as unknown as { DISCORD_CONFIGURATION: fastifyOauth2Types.ProviderConfiguration }
).DISCORD_CONFIGURATION;

export const authRoutes: FastifyPluginCallback = (app, _opts, done) => {
  const discordClientId = process.env.DISCORD_CLIENT_ID;
  const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:3000/api/auth/discord/callback';
  const successRedirect = process.env.OAUTH_SUCCESS_REDIRECT ?? 'http://localhost:5173/';
  const failureRedirectBase = process.env.OAUTH_FAILURE_REDIRECT ?? 'http://localhost:5173/login?error=oauth';
  const discordServerId = process.env.DISCORD_SERVER_ID;
  const requiredGuildRoles = (process.env.DISCORD_SERVER_ROLES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const scope = ['identify'];
  if (discordServerId) {
    scope.push('guilds', 'guilds.members.read');
  }

  const additionalScopes = (process.env.DISCORD_OAUTH_SCOPE ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const uniqueScope = Array.from(new Set([...scope, ...additionalScopes]));

  const isOAuthConfigured = Boolean(discordClientId && discordClientSecret);

  if (!isOAuthConfigured) {
    app.log.warn('Discord OAuth credentials not configured, OAuth routes disabled');
  } else {
    app.register(fastifyOauth2, {
      name: 'discordOAuth2',
      credentials: {
        client: {
          id: discordClientId!,
          secret: discordClientSecret!,
        },
        auth: discordConfiguration,
      },
      scope: uniqueScope,
      startRedirectPath: '/discord',
      callbackUri: redirectUri,
    });
  }

  const oauthService = new OAuthService(appContext.userRepository, app.log);

  app.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ctx = createRequestContext(request);
      return reply.send(ctx.session);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return reply.code(401).send({
          error: {
            code: ErrorCode.Unauthorized,
            message: error.message,
          },
        });
      }
      throw error;
    }
  });

  app.get('/discord/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isOAuthConfigured || !app.discordOAuth2) {
      return reply.redirect(buildErrorRedirect(failureRedirectBase, 'oauth_disabled'));
    }

    try {
      const { token } = await app.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

      if (!token?.access_token) {
        throw new Error('No access token received from Discord');
      }

      const discordUserResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });

      if (!discordUserResponse.ok) {
        throw new Error(`Discord API error: ${discordUserResponse.statusText}`);
      }

      const discordUser = (await discordUserResponse.json()) as DiscordOAuthUser;

      let guildRoles: string[] = [];

      if (discordServerId) {
        const guildMemberResponse = await fetch(
          `https://discord.com/api/v10/users/@me/guilds/${discordServerId}/member`,
          {
            headers: {
              Authorization: `Bearer ${token.access_token}`,
            },
          }
        );

        if (!guildMemberResponse.ok) {
          app.log.warn(
            { discordUserId: discordUser.id, status: guildMemberResponse.status },
            `User is not a member of guild ${discordServerId}`
          );
          return reply.redirect(buildErrorRedirect(failureRedirectBase, 'not_guild_member'));
        }

        const guildMember = (await guildMemberResponse.json()) as { roles?: string[] };
        guildRoles = Array.isArray(guildMember.roles) ? guildMember.roles : [];

        if (requiredGuildRoles.length > 0) {
          const hasRequiredRole = guildRoles.some((role) => requiredGuildRoles.includes(role));
          if (!hasRequiredRole) {
            app.log.warn({ discordUserId: discordUser.id }, `User missing required role for guild ${discordServerId}`);
            return reply.redirect(buildErrorRedirect(failureRedirectBase, 'missing_role'));
          }
        }
      }

      const sessionUser = await oauthService.handleDiscordUser(discordUser, { guildRoles });

      const session = request.session as SessionData;
      session.user = sessionUser;
      await session.save();

      return reply.redirect(successRedirect);
    } catch (error) {
      app.log.error({ error }, 'Discord OAuth callback failed');
      return reply.redirect(buildErrorRedirect(failureRedirectBase, 'oauth_failed'));
    }
  });

  app.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.session.destroy();
      return reply.send({ success: true });
    } catch (error) {
      app.log.error({ error }, 'Logout failed');
      return reply.code(500).send({
        error: {
          code: ErrorCode.InternalError,
          message: 'Logout failed',
        },
      });
    }
  });

  done();
};
