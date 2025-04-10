import { RedditComment } from './types';

const REDDIT_API_BASE = 'https://www.reddit.com';
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Improved scoring weights
const SCORING_WEIGHTS = {
  EXACT_MATCH: 10,
  PARTIAL_MATCH: 5,
  UPVOTES_WEIGHT: 0.5,
  AWARDS_WEIGHT: 2,
  COMMENT_LENGTH_WEIGHT: 0.1,
  COMMENT_AGE_WEIGHT: -0.1, // Newer comments get slight preference
};

// Enhanced word matching using natural language processing concepts
function getWordVariations(word: string): string[] {
  const variations = [word.toLowerCase()];
  
  // Add plural/singular forms
  variations.push(word + 's', word.endsWith('s') ? word.slice(0, -1) : word);
  
  // Add common prefixes/suffixes
  const prefixes = ['re', 'un', 'in', 'dis'];
  const suffixes = ['ing', 'ed', 'er', 'est'];
  
  prefixes.forEach(prefix => variations.push(prefix + word));
  suffixes.forEach(suffix => variations.push(word + suffix));
  
  return [...new Set(variations)]; // Remove duplicates
}

// Calculate semantic score for a comment
function calculateCommentScore(comment: RedditComment, searchTerms: string[]): number {
  let score = 0;
  const commentText = comment.body.toLowerCase();
  const commentAge = (Date.now() - new Date(comment.timestamp).getTime()) / (1000 * 60 * 60); // Hours
  
  // Process each search term and its variations
  searchTerms.forEach(term => {
    const variations = getWordVariations(term);
    
    // Check for exact matches
    variations.forEach(variant => {
      const regex = new RegExp(`\\b${escapeRegex(variant)}\\b`, 'gi');
      const matches = commentText.match(regex);
      if (matches) {
        score += matches.length * SCORING_WEIGHTS.EXACT_MATCH;
      }
    });
    
    // Check for partial matches
    variations.forEach(variant => {
      if (commentText.includes(variant)) {
        score += SCORING_WEIGHTS.PARTIAL_MATCH;
      }
    });
  });
  
  // Factor in comment metrics
  score += comment.upvotes * SCORING_WEIGHTS.UPVOTES_WEIGHT;
  score += (comment.awards || 0) * SCORING_WEIGHTS.AWARDS_WEIGHT;
  score += comment.body.length * SCORING_WEIGHTS.COMMENT_LENGTH_WEIGHT;
  score += commentAge * SCORING_WEIGHTS.COMMENT_AGE_WEIGHT;
  
  return score;
}

// Cache implementation
const cache: { [key: string]: { data: RedditComment[]; timestamp: number } } = {};

function saveToCache(key: string, data: RedditComment[]): void {
  cache[key] = {
    data,
    timestamp: Date.now()
  };
}

async function getFromCache(key: string): Promise<RedditComment[] | null> {
  const cached = cache[key];
  if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
    return cached.data;
  }
  return null;
}

// Enhanced Reddit API request with error handling and rate limiting
async function redditApiRequest(url: string, retries = 3): Promise<any> {
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) { // Rate limit
        const waitTime = parseInt(response.headers.get('X-Ratelimit-Reset') || '60') * 1000;
        await delay(waitTime);
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(1000 * (i + 1)); // Exponential backoff
    }
  }
}

export async function searchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 50
): Promise<RedditComment[]> {
  try {
    // Check cache first
    const cacheKey = `${query}-${filterType}`;
    const cachedResults = await getFromCache(cacheKey);
    if (cachedResults) {
      return cachedResults.slice(0, limit);
    }

    // Parse search terms
    const searchTerms = query.toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(term => term.length > 2); // Ignore very short terms

    // Determine subreddits to search
    let subreddits: string[] = [];
    
    if (filterType === 'subreddit' && query) {
      subreddits = [query];
    } else {
      // Search across a wider range of subreddits
      subreddits = [
        'all', // Include r/all for maximum coverage
        'popular', // Include popular posts
        'technology',
        'programming',
        'AskReddit',
        'science',
        'explainlikeimfive',
        'todayilearned',
        'worldnews',
        'JEE',
        'btechtards',
        'TeenIndia',
        // Add more relevant subreddits based on query context
        ...await suggestRelevantSubreddits(query)
      ];
    }

    // Fetch comments from all subreddits in parallel
    const commentPromises = subreddits.map(async (subreddit) => {
      try {
        // Fetch hot posts first
        const hotPosts = await redditApiRequest(
          `${REDDIT_API_BASE}/r/${subreddit}/hot.json?limit=25`
        );

        // Fetch comments for each post
        const commentThreads = await Promise.all(
          hotPosts.data.children.map((post: any) =>
            redditApiRequest(`${REDDIT_API_BASE}${post.data.permalink}.json`)
          )
        );

        // Extract and process comments
        return commentThreads.flatMap((thread: any) => {
          if (!thread[1]?.data?.children) return [];
          
          return thread[1].data.children
            .filter((comment: any) => 
              comment.kind === 't1' && 
              comment.data.body &&
              comment.data.author !== 'AutoModerator' &&
              comment.data.author !== '[deleted]'
            )
            .map((comment: any) => ({
              id: comment.data.id,
              author: comment.data.author,
              body: comment.data.body,
              subreddit: comment.data.subreddit,
              upvotes: comment.data.ups,
              awards: comment.data.total_awards_received || 0,
              timestamp: new Date(comment.data.created_utc * 1000).toISOString(),
              permalink: comment.data.permalink
            }));
        });
      } catch (error) {
        console.warn(`Error fetching from r/${subreddit}:`, error);
        return [];
      }
    });

    // Wait for all comment fetching to complete
    const allComments = (await Promise.all(commentPromises)).flat();

    // Score and filter comments
    let processedComments = allComments;

    if (query) {
      processedComments = allComments
        .map(comment => ({
          ...comment,
          score: calculateCommentScore(comment, searchTerms)
        }))
        .filter(comment => comment.score > 0)
        .sort((a, b) => b.score - a.score);
    } else {
      // If no query, sort by a combination of upvotes and recency
      processedComments = allComments
        .sort((a, b) => {
          const scoreA = a.upvotes + (Date.now() - new Date(a.timestamp).getTime()) * -0.00001;
          const scoreB = b.upvotes + (Date.now() - new Date(b.timestamp).getTime()) * -0.00001;
          return scoreB - scoreA;
        });
    }

    // Cache results
    saveToCache(cacheKey, processedComments);

    // Return limited results
    return processedComments.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    throw error;
  }
}

// Helper function to suggest relevant subreddits based on query
async function suggestRelevantSubreddits(query: string): Promise<string[]> {
  try {
    // Search for relevant subreddits based on query
    const response = await redditApiRequest(
      `${REDDIT_API_BASE}/subreddits/search.json?q=${encodeURIComponent(query)}&limit=5`
    );
    
    return response.data.children
      .map((child: any) => child.data.display_name)
      .filter((name: string) => name.length > 0);
  } catch (error) {
    console.warn('Error suggesting subreddits:', error);
    return [];
  }
}

// Helper function to escape regex special characters
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { RedditComment };
