export type ChatwootKnowledgeArticle = {
  id: number;
  slug: string;
  title: string;
  content: string;
  status: string;
  updatedAt: string | number;
  position: number;
};

export type KnowledgeDocument = {
  sourceArticleId: number;
  slug: string;
  title: string;
  content: string;
  sourceUpdatedAt: string;
  position: number;
};

export type ChatwootHelpCenterClient = {
  listPublishedArticles(): Promise<ChatwootKnowledgeArticle[]>;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type ClientOptions = {
  baseUrl: string;
  accountId: number;
  apiToken: string;
  portalSlug: string;
  locale: string;
  fetcher?: typeof fetch;
};

type ArticlePayload = Record<string, unknown>;

type Page = {
  payload: ChatwootKnowledgeArticle[];
  currentPage: number;
  totalPages?: number;
  articlesCount?: number;
  publishedCount?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseArticle(value: unknown): ChatwootKnowledgeArticle {
  if (typeof value !== 'object' || value === null) throw new Error('chatwoot_knowledge_invalid_article');
  const candidate = value as ArticlePayload;
  if (
    !isFiniteNumber(candidate.id) || candidate.id <= 0 ||
    typeof candidate.slug !== 'string' || candidate.slug.trim().length === 0 ||
    typeof candidate.title !== 'string' || candidate.title.trim().length === 0 ||
    typeof candidate.content !== 'string' ||
    typeof candidate.status !== 'string' || candidate.status.trim().length === 0 ||
    !(typeof candidate.updated_at === 'string' || isFiniteNumber(candidate.updated_at)) ||
    !isFiniteNumber(candidate.position) || candidate.position < 0
  ) throw new Error('chatwoot_knowledge_invalid_article');
  return {
    id: candidate.id,
    slug: candidate.slug,
    title: candidate.title,
    content: candidate.content,
    status: candidate.status,
    updatedAt: candidate.updated_at,
    position: candidate.position,
  };
}

function positiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

function parsePage(body: unknown): Page {
  if (typeof body !== 'object' || body === null) throw new Error('chatwoot_knowledge_invalid_json');
  const candidate = body as { payload?: unknown; meta?: unknown };
  if (!Array.isArray(candidate.payload)) throw new Error('chatwoot_knowledge_missing_payload');
  if (typeof candidate.meta !== 'object' || candidate.meta === null) throw new Error('chatwoot_knowledge_incomplete_page');
  const meta = candidate.meta as Record<string, unknown>;
  if (!positiveInteger(meta.current_page)) throw new Error('chatwoot_knowledge_incomplete_page');
  const payload = candidate.payload.map(parseArticle);
  const totalPagesValue = meta.total_pages ?? meta.pages ?? meta.page_count;
  const totalPages = totalPagesValue === undefined ? undefined : totalPagesValue;
  if (totalPages !== undefined && (!positiveInteger(totalPages) || totalPages < meta.current_page)) {
    throw new Error('chatwoot_knowledge_incomplete_page');
  }
  const articlesCount = meta.articles_count;
  const publishedCount = meta.published_count;
  if (articlesCount !== undefined && (!Number.isInteger(articlesCount) || !isFiniteNumber(articlesCount) || articlesCount < 0)) throw new Error('chatwoot_knowledge_incomplete_page');
  if (publishedCount !== undefined && (!Number.isInteger(publishedCount) || !isFiniteNumber(publishedCount) || publishedCount < 0)) throw new Error('chatwoot_knowledge_incomplete_page');
  if (totalPages === undefined && articlesCount === undefined && publishedCount === undefined) {
    throw new Error('chatwoot_knowledge_incomplete_page');
  }
  const publishedOnPage = payload.filter((article) => article.status === 'published').length;
  if (publishedCount !== undefined && (publishedOnPage > publishedCount || (payload.length === 0 && publishedCount > 0))) {
    throw new Error('chatwoot_knowledge_incomplete_page');
  }
  if (articlesCount !== undefined && payload.length > articlesCount) throw new Error('chatwoot_knowledge_incomplete_page');
  if (payload.length === 0 && articlesCount !== undefined && articlesCount > 0) throw new Error('chatwoot_knowledge_incomplete_page');
  const page: Page = { payload, currentPage: meta.current_page };
  if (totalPages !== undefined) page.totalPages = totalPages;
  if (articlesCount !== undefined) page.articlesCount = articlesCount;
  if (publishedCount !== undefined) page.publishedCount = publishedCount;
  return page;
}

function inferredTotalPages(page: Page): number {
  if (page.totalPages !== undefined) return page.totalPages;
  const publishedOnPage = page.payload.filter((article) => article.status === 'published').length;
  const count = page.publishedCount ?? page.articlesCount;
  if (count !== undefined && publishedOnPage > 0) return Math.max(page.currentPage, Math.ceil(count / publishedOnPage));
  return page.currentPage;
}

function removeKnownWrappers(content: string): string {
  const fence = content.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  return fence ? fence[1]!.trim() : content;
}

export function normalizeKnowledgeArticle(article: ChatwootKnowledgeArticle): KnowledgeDocument {
  const content = removeKnownWrappers(article.content);
  if (!content.trim()) throw new Error('chatwoot_knowledge_empty_content');
  return {
    sourceArticleId: article.id,
    slug: article.slug,
    title: article.title,
    content,
    sourceUpdatedAt: String(article.updatedAt),
    position: article.position,
  };
}

export function createChatwootHelpCenterClient(options: ClientOptions): ChatwootHelpCenterClient {
  const fetcher: Fetcher = options.fetcher ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const path = `/api/v1/accounts/${options.accountId}/portals/${encodeURIComponent(options.portalSlug)}/articles`;

  async function getPage(page: number): Promise<Page> {
    const url = `${baseUrl}${path}?locale=${encodeURIComponent(options.locale)}&page=${page}`;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: { api_access_token: options.apiToken, Accept: 'application/json' },
      });
    } catch {
      throw new Error('chatwoot_knowledge_request_failed');
    }
    if (!response.ok) throw new Error(`chatwoot_knowledge_http_${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('chatwoot_knowledge_invalid_json');
    }
    return parsePage(body);
  }

  return {
    async listPublishedArticles(): Promise<ChatwootKnowledgeArticle[]> {
      const articles: ChatwootKnowledgeArticle[] = [];
      let pageNumber = 1;
      let page: Page;
      do {
        page = await getPage(pageNumber);
        if (page.currentPage !== pageNumber) throw new Error('chatwoot_knowledge_incomplete_page');
        const expectedPages = inferredTotalPages(page);
        if (page.currentPage < expectedPages && page.payload.length === 0) throw new Error('chatwoot_knowledge_incomplete_page');
        articles.push(...page.payload.filter((article) => article.status === 'published'));
        pageNumber += 1;
        if (pageNumber > expectedPages) break;
      } while (true);
      return articles;
    },
  };
}
