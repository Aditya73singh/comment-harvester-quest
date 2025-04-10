import { RedditComment } from './types';

const REDDIT_API_BASE = 'https://www.reddit.com';
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Enhanced scoring weights for better results
const SCORING_WEIGHTS = {
  EXACT_MATCH: 8,
  PARTIAL_MATCH: 4,
  WORD_PROXIMITY: 3,    // New: Consider words that appear close together
  UPVOTES_WEIGHT: 0.3,
  AWARDS_WEIGHT: 1.5,
  COMMENT_LENGTH_WEIGHT: 0.05,
  COMMENT_AGE_WEIGHT: -0.05
};

// Improved word matching
function getWordVariations(word: string): string[] {
  const variations = [word.toLowerCase()];
  
  // Add plural/singular forms
  variations.push(
    word + 's', 
    word.endsWith('s') ? word.slice(0, -1) : word,
    word + 'es',
    word.endsWith('y') ? word.slice(0, -1) + 'ies' : word
  );
  
  // Add common prefixes/suffixes
  const prefixes = ['re', 'un', 'in', 'dis', 'pre', 'post', 'sub', 'super'];
  const suffixes = ['ing', 'ed', 'er', 'est', 'able', 'ible', 'ful', 'less'];
  
  prefixes.forEach(prefix => variations.push(prefix + word));
  suffixes.forEach(suffix => {
    // Handle basic spelling rules
    if (word.endsWith('e') && suffix.startsWith('ing')) {
      variations.push(word.slice(0, -1) + suffix);
    } else {
      variations.push(word + suffix);
    }
  });
  
  return [...new Set(variations)];
}

// Enhanced score calculation
function calculateCommentScore(comment: RedditComment, searchTerms: string[]): number {
  let score = 0;
  const commentText = comment.body.toLowerCase();
  const commentAge = (Date.now() - new Date(comment.timestamp).getTime()) / (1000 * 60 * 60);
  
  // Process search terms
  searchTerms.forEach(term => {
    const variations = getWordVariations(term);
    
    // Check for exact matches with context
    variations.forEach(variant => {
      const regex = new RegExp(`\\b${escapeRegex(variant)}\\b`, 'gi');
      const matches = commentText.match(regex);
      if (matches) {
        score += matches.length * SCORING_WEIGHTS.EXACT_MATCH;
        
        // Bonus for matches in the first sentence
        const firstSentence = commentText.split(/[.!?]/, 1)[0];
        if (firstSentence.includes(variant)) {
          score += SCORING_WEIGHTS.EXACT_MATCH * 0.5;
        }
      }
    });
    
    // Check for partial matches
    variations.forEach(variant => {
      if (commentText.includes(variant)) {
        score += SCORING_WEIGHTS.PARTIAL_MATCH;
      }
    });
  });
  
  // Word proximity scoring
  if (searchTerms.length > 1) {
    const words = commentText.split(/\s+/);
    let minDistance = Infinity;
    
    for (let i = 0; i < words.length; i++) {
      const matchIndices = searchTerms
        .map(term => words.findIndex((word, idx) => 
          idx >= i && getWordVariations(term).some(v => word.includes(v))
        ))
        .filter(idx => idx !== -1);
      
      if (matchIndices.length === searchTerms.length) {
        const distance = Math.max(...matchIndices) - Math.min(...matchIndices);
        minDistance = Math.min(minDistance, distance);
      }
    }
    
    if (minDistance !== Infinity) {
      score += SCORING_WEIGHTS.WORD_PROXIMITY * (1 / (minDistance + 1));
    }
  }
  
  // Factor in comment metrics with diminishing returns
  score += Math.log(comment.upvotes + 1) * SCORING_WEIGHTS.UPVOTES_WEIGHT;
  score += (comment.awards || 0) * SCORING_WEIGHTS.AWARDS_WEIGHT;
  score += Math.log(comment.body.length + 1) * SCORING_WEIGHTS.COMMENT_LENGTH_WEIGHT;
  score += commentAge * SCORING_WEIGHTS.COMMENT_AGE_WEIGHT;
  
  return score;
}

export async function searchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 100  // Increased default limit
): Promise<RedditComment[]> {
  try {
    const cacheKey = `${query}-${filterType}`;
    const cachedResults = await getFromCache(cacheKey);
    if (cachedResults) {
      return cachedResults.slice(0, limit);
    }

    // Parse search terms more intelligently
    const searchTerms = query.toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(term => term.length > 1); // Reduced minimum length to 2

    // Expanded subreddit list
    let subreddits: string[] = [];
    
    if (filterType === 'subreddit' && query) {
      subreddits = [query];
    } else {
      // Get both hot and rising posts from more subreddits
      subreddits = [
        'all',
        'popular',
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
        'india',
        'developersindia',
        'learnprogramming',
        'coding',
        'webdev',
        'tech',
        'education',
        'cscareerquestions',
        ...await suggestRelevantSubreddits(query)
      ];
    }

    // Fetch from both hot and rising posts
    const commentPromises = subreddits.flatMap(async (subreddit) => {
      try {
        const [hotPosts, risingPosts] = await Promise.all([
          redditApiRequest(`${REDDIT_API_BASE}/r/${subreddit}/hot.json?limit=50`),
          redditApiRequest(`${REDDIT_API_BASE}/r/${subreddit}/rising.json?limit=25`)
        ]);

        const allPosts = [
          ...hotPosts.data.children,
          ...risingPosts.data.children
        ];

        // Fetch comments for each post
        const commentThreads = await Promise.all(
          allPosts.map((post: any) =>
            redditApiRequest(`${REDDIT_API_BASE}${post.data.permalink}.json`)
          )
        );

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

    const allComments = (await Promise.all(commentPromises)).flat();

    // Process and score comments
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
      processedComments = allComments.sort((a, b) => {
        const scoreA = a.upvotes + (Date.now() - new Date(a.timestamp).getTime()) * -0.00001;
        const scoreB = b.upvotes + (Date.now() - new Date(b.timestamp).getTime()) * -0.00001;
        return scoreB - scoreA;
      });
    }

    saveToCache(cacheKey, processedComments);
    return processedComments.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    throw error;
  }
}

// Rest of the helper functions remain the same...
