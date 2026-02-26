import type { Chat } from '@adiwajshing/baileys';
import { SqlKVRepository } from '@waha/core/storage/sql/SqlKVRepository';
import { OverviewFilter } from '@waha/structures/chats.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';
import { Knex } from 'knex';

export class SqlChatMethods {
  constructor(private repository: SqlKVRepository<any>) {}

  async getAllWithMessages(
    pagination: PaginationParams,
    broadcast: boolean,
    filter?: OverviewFilter,
  ): Promise<Chat[]> {
    const knex = this.repository.getKnex();
    const tableName = this.repository.table;
    const baseQuery = this.repository
      .select()
      .whereNotNull(`${tableName}.conversationTimestamp`);

    const annotatedQuery = this.annotateWithPnJid(knex, baseQuery, {
      tableName,
      broadcast,
      filter,
    }).as('annotated_chats');

    const dedupedQuery = knex
      .select('*')
      .from(
        knex
          .select(
            'annotated_chats.*',
            knex.raw(
              'ROW_NUMBER() OVER (PARTITION BY annotated_chats.primary_jid ORDER BY annotated_chats."conversationTimestamp" DESC, annotated_chats.primary_priority ASC) as __rownum',
            ),
          )
          .from(annotatedQuery)
          .as('ranked_chats'),
      )
      .where('__rownum', 1);

    const pagedQuery = this.repository.pagination(dedupedQuery, pagination);
    const rows = await pagedQuery;

    return rows.map((row) => {
      const chat = this.repository.parse(row);
      if (row.primary_jid) {
        chat.id = row.primary_jid;
      }
      return chat;
    });
  }

  private annotateWithPnJid(
    knex: Knex,
    query: Knex.QueryBuilder,
    opts: {
      tableName: string;
      broadcast: boolean;
      filter?: OverviewFilter;
    },
  ) {
    const pnExpr = this.buildPnJidExpr(opts.tableName);
    let annotated = query
      .leftJoin('lid_map', 'lid_map.id', `${opts.tableName}.id`)
      .select(
        knex.raw(`${pnExpr} as primary_jid`),
        knex.raw(
          `CASE WHEN ${opts.tableName}.id LIKE '%@lid' THEN 1 ELSE 0 END as primary_priority`,
        ),
      );

    if (!opts.broadcast) {
      annotated = annotated
        .andWhereNot(`${opts.tableName}.id`, 'like', '%@broadcast')
        .andWhereNot(`${opts.tableName}.id`, 'like', '%@newsletter');
    }

    if (opts.filter?.ids && opts.filter.ids.length > 0) {
      annotated = annotated.andWhere((builder) => {
        builder
          .whereIn(`${opts.tableName}.id`, opts.filter.ids)
          .orWhereIn('lid_map.pn', opts.filter.ids);
      });
    }

    return annotated.select(`${opts.tableName}.*`);
  }

  private buildPnJidExpr(tableName: string) {
    const column = `"${tableName}"."id"`;
    return `CASE WHEN ${column} LIKE '%@lid' THEN COALESCE(lid_map.pn, ${column}) ELSE ${column} END`;
  }
}
