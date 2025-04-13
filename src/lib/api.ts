import axios from 'axios';

// Enhanced RedditComment interface
export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  matchScore?: number;
  score?: number;
  url?: string;
}

// Configuration
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const PUSHSHIFT_API = 'https://api.pushshift.io/reddit/comment/search';
const MAX_RESULTS = 500; // Maximum comments to process
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Cache system
const searchCache = new Map<string, { timestamp: number, results: RedditComment[] }>();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Helper functions
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCacheKey(query: string, filterType: string, source: string): string {
  return `${source}_${query.toLowerCase()}_${filterType}`;
}

async function getFromCache(query: string, filterType: string, source: string): Promise<RedditComment[] | null> {
  const key = getCacheKey(query, filterType, source);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.results;
  }
  return null;
}

function saveToCache(query: string, filterType: string, source: string, results: RedditComment[]): void {
  const key = getCacheKey(query, filterType, source);
  searchCache.set(key, { timestamp: Date.now(), results });
}

// Enhanced scoring algorithm
function calculateMatchScore(comment: RedditComment, terms: string[]): number {
  let score = 0;
  const fields = [
    { text: comment.body, weight: 1.5 },
    { text: comment.subreddit, weight: 1.2 },
    { text: comment.author, weight: 1.0 }
  ];

  terms.forEach(term => {
    // Exact match bonus
    if (comment.body.toLowerCase().includes(term.toLowerCase())) {
      score += 5;
    }

    // Partial matches
    fields.forEach(field => {
      const matches = field.text.toLowerCase().match(new RegExp(term, 'gi'));
      if (matches) score += matches.length * field.weight;
    });
  });

  // Upvote weighting (logarithmic to prevent domination by popular posts)
  score += Math.log10(comment.upvotes + 1);

  return score;
}

// Pushshift.io search implementation
async function searchWithPushshift(
  query: string,
  limit: number = 25,
  timeFilter: string = 'year'
): Promise<RedditComment[]> {
  const cacheKey = `pushshift_${query}_${timeFilter}`;
  const cached = await getFromCache(query, 'all', 'pushshift');
  if (cached) return cached.slice(0, limit);

  try {
    const params = {
      q: query,
      size: Math.min(limit, 500),
      sort_type: 'score',
      sort: 'desc',
      after: timeFilter === 'all' ? '0' : `${timeFilter}d`
    };

    const response = await axios.get(PUSHSHIFT_API, { params, timeout: 10000 });
    const comments = response.data.data.map((item: any) => ({
      id: item.id,
      author: item.author,
      body: item.body,
      subreddit: item.subreddit,
      upvotes: item.score,
      timestamp: new Date(item.created_utc * 1000).toISOString(),
      url: `https://reddit.com${item.permalink}`
    }));

    saveToCache(query, 'all', 'pushshift', comments);
    return comments.slice(0, limit);
  } catch (error) {
    console.error('Pushshift search error:', error);
    return [];
  }
}

// Enhanced Reddit API search
async function searchWithRedditAPI(
  query: string,
  limit: number = 25,
  filterType: string = 'all',
  timeFilter: string = 'year'
): Promise<RedditComment[]> {
  const cacheKey = `reddit_${query}_${filterType}_${timeFilter}`;
  const cached = await getFromCache(query, filterType, 'reddit');
  if (cached) return cached.slice(0, limit);

  try {
    let url = `${REDDIT_API_BASE}/search.json?q=${encodeURIComponent(query)}&type=comment&limit=${limit}`;
    
    if (timeFilter !== 'all') {
      url += `&t=${timeFilter}`;
    }

    if (filterType === 'subreddit') {
      url = `${REDDIT_API_BASE}/r/${query}/comments.json?limit=${limit}`;
    } else if (filterType === 'author') {
      url = `${REDDIT_API_BASE}/user/${query}/comments.json?limit=${limit}`;
    }

    const response = await redditApiRequest(url);
    const comments = response.data.children.map((item: any) => ({
      id: item.data.id,
      author: item.data.author,
      body: item.data.body,
      subreddit: item.data.subreddit,
      upvotes: item.data.score,
      timestamp: new Date(item.data.created_utc * 1000).toISOString(),
      url: `https://reddit.com${item.data.permalink}`
    }));

    saveToCache(query, filterType, 'reddit', comments);
    return comments;
  } catch (error) {
    console.error('Reddit API search error:', error);
    return [];
  }
}

// Combined search with all improvements
export async function enhancedSearchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 25,
  timeout: number = 5000
): Promise<RedditComment[]> {
  const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
  if (searchTerms.length === 0) return [];

  // Time filters to try (most recent first)
  const timeFilters = ['hour', 'day', 'week', 'month', 'year', 'all'];

  try {
    // Start all search strategies concurrently
    const searchStrategies = [
      // Pushshift searches (historical data)
      ...timeFilters.map(time => 
        searchWithPushshift(query, Math.ceil(limit / 3), time)
          .catch(() => [] as RedditComment[])
      ),
      
      // Reddit API searches (real-time data)
      searchWithRedditAPI(query, limit, filterType, 'year'),
      searchWithRedditAPI(query, limit, filterType, 'month'),
      
      // Alternative search endpoints
      ...['hot', 'new', 'top', 'rising', 'controversial'].map(endpoint =>
        redditApiRequest(`${REDDIT_API_BASE}/search.json?q=${query}&sort=${endpoint}&limit=${Math.ceil(limit / 5)}`)
          .then(res => res.data.children.map(convertRedditItemToComment))
          .catch(() => [] as RedditComment[])
      )
    ];

    // Execute with timeout
    const results = await Promise.race([
      Promise.all(searchStrategies).then(arrays => arrays.flat()),
      new Promise<RedditComment[]>(resolve => 
        setTimeout(() => resolve([]), timeout)
    ]);

    // Process and score all comments
    let allComments = results
      .filter((comment): comment is RedditComment => !!comment)
      .reduce((unique, comment) => {
        if (!unique.some(c => c.id === comment.id)) {
          unique.push(comment);
        }
        return unique;
      }, [] as RedditComment[]);

    // Apply scoring
    allComments = allComments.map(comment => {
      const score = calculateMatchScore(comment, searchTerms);
      return { ...comment, score, matchScore: score };
    });

    // Sort by score (descending) and limit
    allComments.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allComments.slice(0, limit);

  } catch (error) {
    console.error('Enhanced search error:', error);
    return [];
  }
}

// Helper function to convert Reddit API items
function convertRedditItemToComment(item: any): RedditComment {
  return {
    id: item.data.id,
    author: item.data.author,
    body: item.data.body,
    subreddit: item.data.subreddit,
    upvotes: item.data.score,
    timestamp: new Date(item.data.created_utc * 1000).toISOString(),
    url: `https://reddit.com${item.data.permalink}`
  };
}

// Usage example
async function exampleUsage() {
  const results = await enhancedSearchComments('typescript react', 'all', 50);
  console.log(`Found ${results.length} comments:`);
  results.forEach((comment, i) => {
    console.log(`#${i + 1} [r/${comment.subreddit}] ${comment.author}: ${comment.body.substring(0, 60)}... (Score: ${comment.score?.toFixed(2)})`);
  });
}

// Debug stats
function logSearchStats(query: string, results: RedditComment[]) {
  console.log(`Search Statistics:
  Query: "${query}"
  Total results: ${results.length}
  Top score: ${results[0]?.score?.toFixed(2) || 'N/A'}
  Average score: ${(results.reduce((sum, c) => sum + (c.score || 0), 0) / results.length).toFixed(2)}
  Subreddits: ${[...new Set(results.map(c => c.subreddit))].join(', ')}`);
}
