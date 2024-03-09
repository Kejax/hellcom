import {ChannelType, DiscordAPIError, EmbedBuilder} from 'discord.js';
import {and, eq} from 'drizzle-orm';
import {config, isProd} from '../config';
import {db, persistentMessages} from '../db';
import {client} from './client';
import {warStatusEmbeds} from './embed';
import {logger} from './logging';

const FOOTER_MESSAGE = config.FOOTER_MESSAGE;

export async function updateMessages() {
  // measure time taken to update all persistent messages
  const start = Date.now();

  const embeds = {
    curr_war: warStatusPersistentMessage(),
  };

  const messages = await db.query.persistentMessages.findMany({
    where: and(
      eq(persistentMessages.deleted, false),
      eq(persistentMessages.production, isProd)
    ),
  });

  const promises: Promise<any>[] = [];
  for (const message of messages) {
    const {messageId, channelId, type: messageType} = message;

    try {
      // try fetching the channel, may throw '50001', bot can't see channel
      const messageChannel = await client.channels.fetch(channelId);
      if (
        messageChannel &&
        (messageChannel.type === ChannelType.GuildText ||
          messageChannel.type === ChannelType.PublicThread)
      ) {
        // try fetching the message, may throw '10008', message doesn't exist (deleted?)
        const discordMsg = await messageChannel.messages.fetch(messageId);
        if (discordMsg)
          switch (messageType) {
            case 'war_status':
              promises.push(
                discordMsg.edit({
                  embeds: embeds.curr_war,
                })
              );
              break;
          }
      }
    } catch (err) {
      const discordErr = err as DiscordAPIError;
      // discord API error codes
      // https://github.com/meew0/discord-api-docs-1/blob/master/docs/topics/RESPONSE_CODES.md#json-error-response
      switch (discordErr.code) {
        case 10003: // Unknown channel
          promises.push(
            db
              .update(persistentMessages)
              .set({deleted: true})
              .where(eq(persistentMessages.messageId, messageId))
          );
          break;
        case 10008: // Unknown message
          promises.push(
            db
              .update(persistentMessages)
              .set({deleted: true})
              .where(eq(persistentMessages.messageId, messageId))
          );
          break;
        case 50001: // Missing access
          promises.push(
            db
              .update(persistentMessages)
              .set({deleted: true})
              .where(eq(persistentMessages.messageId, messageId))
          );
          break;
        case 50005: // Cannot edit a message authored by another user
          break;
      }
    }
  }

  // await all message edits completion
  await Promise.all(promises);
  const time = `${Date.now() - start}ms`;
  logger.info(`Updated ${messages.length} messages in ${time}`, {
    type: 'info',
  });
}

export function warStatusPersistentMessage() {
  const timestamp = Math.round(Date.now() / 1000);

  const updateEmbed = new EmbedBuilder()
    .setDescription(
      `This message is updated every 10 minutes! It was last updated <t:${timestamp}:R>.`
    )
    .setFooter({text: FOOTER_MESSAGE})
    .setTimestamp();

  return [...warStatusEmbeds(), updateEmbed];
}