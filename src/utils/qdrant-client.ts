const QDRANT_COLLECTION = 'agent_memories';
const VECTOR_SIZE = 768;
const REQUEST_TIMEOUT_MS = 10_000;

type QdrantFilter = {
  must: Array<{ key: string; match: { value: string } }>;
};

type QdrantPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

type QdrantSearchResult = {
  payload: { content: string };
  score: number;
};

type QdrantScrollResult = {
  id: string;
  payload: Record<string, unknown>;
};

type QdrantSearchResponse = {
  result: QdrantSearchResult[];
};

type QdrantCountResponse = {
  result: { count: number };
};

type QdrantScrollResponse = {
  result: {
    points: Array<{ id: string; payload: Record<string, unknown> }>;
  };
};

const handleResponse = async (response: Response): Promise<unknown> => {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Qdrant request failed with status ${response.status}: ${body}`);
  }
  return response.json();
};

export const ensureCollection = async (qdrantUrl: string): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const checkUrl = `${qdrantUrl}/collections/${QDRANT_COLLECTION}`;
    const checkResponse = await fetch(checkUrl, { signal: controller.signal });
    if (checkResponse.ok) {
      return;
    }

    const createUrl = `${qdrantUrl}/collections/${QDRANT_COLLECTION}`;
    const createResponse = await fetch(createUrl, {
      method: 'PUT',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: {
          size: VECTOR_SIZE,
          distance: 'Cosine',
        },
      }),
    });
    await handleResponse(createResponse);

    const indexFields = ['user_id', 'embeddingProvider', 'embeddingModel'];
    for (const fieldName of indexFields) {
      const indexUrl = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/index`;
      const indexResponse = await fetch(indexUrl, {
        method: 'PUT',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field_name: fieldName,
          field_schema: 'keyword',
        }),
      });
      await handleResponse(indexResponse);
    }
  } finally {
    clearTimeout(timeout);
  }
};

export const upsertPoint = async (qdrantUrl: string, point: QdrantPoint): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points`;
    const response = await fetch(url, {
      method: 'PUT',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: [point] }),
    });
    await handleResponse(response);
  } finally {
    clearTimeout(timeout);
  }
};

export const searchPoints = async (
  qdrantUrl: string,
  vector: number[],
  filter: QdrantFilter,
  topK: number,
  scoreThreshold: number,
): Promise<Array<{ payload: { content: string }; score: number }>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points/search`;
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector,
        limit: topK,
        score_threshold: scoreThreshold,
        filter,
        with_payload: ['content'],
      }),
    });
    const data = (await handleResponse(response)) as QdrantSearchResponse;
    return data.result;
  } finally {
    clearTimeout(timeout);
  }
};

export const countPoints = async (qdrantUrl: string, filter: QdrantFilter): Promise<number> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points/count`;
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
    });
    const data = (await handleResponse(response)) as QdrantCountResponse;
    return data.result.count;
  } finally {
    clearTimeout(timeout);
  }
};

export const scrollPoints = async (
  qdrantUrl: string,
  filter: QdrantFilter,
  limit: number,
  orderByCreatedAtAsc: boolean,
): Promise<QdrantScrollResult[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points/scroll`;
    const body: Record<string, unknown> = {
      filter,
      limit,
      with_payload: true,
      with_vector: false,
    };

    if (orderByCreatedAtAsc) {
      body.order_by = {
        key: 'createdAt',
        direction: 'asc',
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await handleResponse(response)) as QdrantScrollResponse;
    return data.result.points.map((p) => ({
      id: p.id,
      payload: p.payload,
    }));
  } finally {
    clearTimeout(timeout);
  }
};

export const deletePointsByIds = async (qdrantUrl: string, ids: string[]): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${qdrantUrl}/collections/${QDRANT_COLLECTION}/points/delete`;
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: ids }),
    });
    await handleResponse(response);
  } finally {
    clearTimeout(timeout);
  }
};

export { QDRANT_COLLECTION };
