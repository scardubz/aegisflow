import { FastifyInstance, FastifyPluginAsync } from 'fastify';

interface CursorPayload {
  createdAt: string;
  id: string;
}

// Helper to encode/decode cursor strings safely
function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursorStr: string): CursorPayload {
  const jsonStr = Buffer.from(cursorStr, 'base64url').toString('utf8');
  return JSON.parse(jsonStr);
}

const cursorPaginationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  
  fastify.get('/documents/cursor', async (request, reply) => {
    const { limit = '20', cursor } = request.query as { limit?: string; cursor?: string };
    const take = Math.min(parseInt(limit, 10), 100); // Enforce max page size cap

    let cursorData: CursorPayload | null = null;
    if (cursor) {
      try {
        cursorData = decodeCursor(cursor);
      } catch {
        return reply.code(400).send({ error: 'Invalid pagination cursor format' });
      }
    }

    const documents = await request.withTenantTransaction(async (client) => {
      let query = `
        SELECT id, title, content, created_at 
        FROM documents
      `;
      const params: any[] = [];

      // If a cursor is provided, seek past the last seen tuple (created_at, id)
      if (cursorData) {
        params.push(cursorData.createdAt, cursorData.id);
        query += ` WHERE (created_at, id) < ($1, $2)`;
      }

      // Order descending by created_at with id as deterministic tie-breaker
      query += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1}`;
      params.push(take + 1); // Fetch +1 item to check if there is a next page

      const { rows } = await client.query(query, params);
      return rows;
    });

    // Determine if a next page exists
    let nextCursor: string | null = null;
    if (documents.length > take) {
      documents.pop(); // Remove the extra +1 lookahead item
      const lastItem = documents[documents.length - 1];
      nextCursor = encodeCursor(lastItem.created_at, lastItem.id);
    }

    return {
      data: documents,
      pagination: {
        nextCursor,
        hasMore: nextCursor !== null,
      },
    };
  });
};

export default cursorPaginationRoutes;
