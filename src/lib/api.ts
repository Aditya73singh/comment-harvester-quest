import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

// Define the RedditComment interface with additional fields
export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  permalink?: string;
  matchScore?: number;
  score?: number;
  awards?: number;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

// Expanded interface for search parameters
interface SearchParams {
  query: string;
  filterType: 'all' | 'keyword' | 'subreddit' | 'author';
  timeFrame: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  sortBy: 'relevance' | 'upvotes' | 'timestamp' | 'awards';
  minUpvotes: number;
  limit: number;
}

// Reddit API credentials and endpoints
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || 'xmNNjvzBns1KvnjE5M7WEg';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || 'N39e8RHrhC0XhHnxzUEhwkq5tbrJWw';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

// Token management with retry logic
let accessToken: string | null = null;
let tokenExpiration: number = 0;
let tokenRetryCount = 0;

// Enhanced cache system with TTL and size limit
class SearchCache {
  private cache = new Map<string, { timestamp: number; results: RedditComment[] }>();
  private readonly maxSize: number;
  private readonly ttl: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttl = ttlMs;
  }

  get(key: string): RedditComment[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.results;
  }

  set(key: string, results: RedditComment[]): void {
    // Trim cache if it's getting too large
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entries
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, { timestamp: Date.now(), results });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

const searchCache = new SearchCache();

// Utility functions
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCacheKey(params: SearchParams, page: number): string {
  return `${params.query.toLowerCase()}_${params.filterType}_${params.timeFrame}_${params.sortBy}_${params.minUpvotes}_${params.limit}_${page}`;
}

function safeBase64Encode(str: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(str).toString('base64') : btoa(str);
}

// Enhanced token management with exponential backoff
async function getRedditAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiration) return accessToken;
  
  try {
    // Implement exponential backoff for retries
    const backoffTime = tokenRetryCount === 0 ? 0 : Math.min(1000 * Math.pow(2, tokenRetryCount), 30000);
    if (backoffTime > 0) {
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
    
    const authString = safeBase64Encode(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
    const response = await axios({
      method: 'post',
      url: REDDIT_AUTH_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authString}`,
        'User-Agent': 'web:CommentHarvester:v1.1 (by /u/commentharvester)',
      },
      data: 'grant_type=client_credentials',
      timeout: 10000,
    });
    
    accessToken = response.data.access_token;
    tokenExpiration = Date.now() + response.data.expires_in * 1000 - 60000;
    tokenRetryCount = 0; // Reset retry count on success
    return accessToken;
  } catch (error) {
    tokenRetryCount++;
    console.error(`Error getting Reddit access token (attempt ${tokenRetryCount}):`, error);
    
    // If we've tried too many times, clear the token and throw
    if (tokenRetryCount > 3) {
      tokenRetryCount = 0;
      throw new Error('Failed to authenticate with Reddit API after multiple attempts');
    }
    
    // Try again without the backoff (will happen in the next call)
    accessToken = null;
    tokenExpiration = 0;
    throw new Error('Failed to authenticate with Reddit API');
  }
}

// Enhanced API request with rate limiting protection
async function redditApiRequest(url: string, attempt: number = 1): Promise<any> {
  const maxAttempts = 3;
  try {
    const token = await getRedditAccessToken();
    const response = await axios({
      method: 'get',
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'web:CommentHarvester:v1.1 (by /u/commentharvester)',
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      // Handle rate limiting with exponential backoff
      if (error.response.status === 429) {
        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000;
          console.warn(`Rate limited by Reddit API. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return redditApiRequest(url, attempt + 1);
        } else {
          throw new Error('Rate limited by Reddit API. Please try again later.');
        }
      }
      
      // Handle authentication errors
      if (error.response.status === 401) {
        accessToken = null;
        tokenExpiration = 0;
        if (attempt < maxAttempts) {
          return redditApiRequest(url, attempt + 1);
        }
      }
    }
    
    console.error('Error making Reddit API request:', error);
    throw error;
  }
}

// Fetch comments from a post with improved error handling and fallback sorting
async function fetchCommentsFromPost(postId: string, subreddit: string): Promise<RedditComment[]> {
  try {
    // Vary sorting method to get diverse comments
    const sortMethods = ['confidence', 'top', 'new', 'controversial'];
    const sortMethod = sortMethods[Math.floor(Math.random() * sortMethods.length)];
    
    const response = await redditApiRequest(
      `${REDDIT_API_BASE}/r/${subreddit}/comments/${postId}.json?limit=100&depth=5&sort=${sortMethod}`
    );
    
    if (!response || !Array.isArray(response) || response.length < 2) return [];
    return extractComments(response[1].data.children, subreddit, postId);
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error);
    return [];
  }
}

// Extract comments recursively with enhanced metadata
function extractComments(commentData: any[], subreddit: string, postId: string): RedditComment[] {
  const comments: RedditComment[] = [];
  
  function processComments(data: any[], depth: number = 0) {
    if (!data || depth > 10) return; // Prevent infinite recursion
    
    for (const item of data) {
      if (item.kind === 't1' && item.data) {
        // Skip deleted/removed comments
        if (item.data.body === '[deleted]' || item.data.body === '[removed]') continue;
        if (item.data.author === '[deleted]') continue;
        
        const comment: RedditComment = {
          id: item.data.id,
          author: item.data.author || '[deleted]',
          body: item.data.body || '',
          subreddit,
          upvotes: item.data.ups || 0,
          timestamp: new Date(item.data.created_utc * 1000).toISOString(),
          permalink: `/r/${subreddit}/comments/${postId}/${item.data.id}`,
          awards: item.data.total_awards_received || 0,
        };
        
        // Simple sentiment analysis based on keywords
        const text = comment.body.toLowerCase();
        if (/\b(great|good|love|awesome|excellent|amazing|best|nice|perfect|happy)\b/.test(text)) {
          comment.sentiment = 'positive';
        } else if (/\b(bad|awful|hate|terrible|worst|sucks|horrible|poor|sad|angry)\b/.test(text)) {
          comment.sentiment = 'negative';
        } else {
          comment.sentiment = 'neutral';
        }
        
        comments.push(comment);
      }
      
      // Process replies (with depth tracking to prevent stack overflow)
      if (item.data?.replies?.data?.children) {
        processComments(item.data.replies.data.children, depth + 1);
      }
    }
  }
  
  processComments(commentData);
  return comments;
}

// Enhanced mock comments for fallback
const mockComments: RedditComment[] = [
  { 
    id: 'mock1', 
    author: 'tech_enthusiast', 
    body: 'Modern programming languages like Rust and Go are gaining popularity for their performance characteristics and safety features.',
    subreddit: 'programming', 
    upvotes: 128, 
    timestamp: new Date().toISOString(),
    sentiment: 'positive',
    awards: 2
  },
  { 
    id: 'mock2', 
    author: 'science_lover', 
    body: 'The James Webb Space Telescope has revolutionized our understanding of distant galaxies. The images are absolutely stunning!',
    subreddit: 'science', 
    upvotes: 243, 
    timestamp: new Date().toISOString(),
    sentiment: 'positive',
    awards: 5
  },
  { 
    id: 'mock3', 
    author: 'design_thinker', 
    body: 'Apple prioritizes simplicity and user experience over feature bloat, which is why their products remain popular despite the premium pricing.',
    subreddit: 'technology', 
    upvotes: 87, 
    timestamp: new Date().toISOString(),
    sentiment: 'neutral',
    awards: 1
  },
  { 
    id: 'mock4', 
    author: 'movie_critic', 
    body: 'The latest superhero movie was terrible. The CGI looked cheap and the plot had more holes than Swiss cheese.',
    subreddit: 'movies', 
    upvotes: 54, 
    timestamp: new Date().toISOString(),
    sentiment: 'negative',
    awards: 0
  },
  { 
    id: 'mock5', 
    author: 'health_advisor', 
    body: 'Regular exercise and a balanced diet are still the best ways to maintain long-term health, despite all the fad diets that come and go.',
    subreddit: 'health', 
    upvotes: 176, 
    timestamp: new Date().toISOString(),
    sentiment: 'positive',
    awards: 3
  },
];

// Enhanced search function with additional parameters and optimizations
export async function searchComments(
  params: SearchParams,
  page: number = 1
): Promise<RedditComment[]> {
  const { query, filterType, timeFrame, sortBy, minUpvotes, limit } = params;
  const timeout = 8000;
  
  try {
    // Check cache first
    const cacheKey = getCacheKey(params, page);
    const cachedResults = searchCache.get(cacheKey);
    if (cachedResults) return cachedResults;

    if (typeof query !== 'string') throw new Error('Query must be a string');
    
    // Process search terms
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    const regexes = searchTerms.map(term => new RegExp(escapeRegex(term), 'gi'));
    
    // Determine subreddits to search
    let subreddits: string[];
    if (filterType === 'subreddit' && query.trim()) {
      subreddits = [query.trim()];
    } else {
      // Get a mix of general and topic-specific subreddits based on search terms
      subreddits = ['all'];
      
      // Add popular subreddits on first page
      if (page === 1) {
        subreddits.push('popular', 'trending');
        
        // Add topic-specific subreddits if we can infer topics from search terms
        const topics: Record<string, string[]> = {
          tech: ['technology', 'programming', 'webdev', 'coding', 'compsci'],
          science: ['science', 'askscience', 'physics', 'chemistry', 'biology'],
          news: ['news', 'worldnews', 'politics', 'currentevents'],
          entertainment: ['movies', 'television', 'music', 'gaming'],
          sports: ['sports', 'nba', 'soccer', 'nfl', 'baseball']
        };
        
        // Check if search terms match topic keywords
        for (const [topic, relatedTerms] of Object.entries(topics)) {
          for (const term of searchTerms) {
            if (relatedTerms.some(rt => rt.includes(term) || term.includes(rt))) {
              // Add one random subreddit from this topic
              subreddits.push(relatedTerms[Math.floor(Math.random() * relatedTerms.length)]);
              break;
            }
          }
        }
      }
    }
    
    // Limit to unique subreddits
    subreddits = [...new Set(subreddits)];
    
    // Calculate posts per subreddit
    const postsPerSubreddit = Math.ceil(limit / subreddits.length);
    const allComments: RedditComment[] = [];
    
    // Process each subreddit
    const subredditPromises = subreddits.map(async (subreddit) => {
      const sortMethods = subreddit === 'all' ? ['hot', 'top', 'rising', 'new'] : ['hot', 'top'];
      
      // Map timeFrame to Reddit's t parameter
      const getTimeParam = () => {
        switch (timeFrame) {
          case 'hour': return 'hour';
          case 'day': return 'day';
          case 'week': return 'week';
          case 'month': return 'month';
          case 'year': return 'year';
          case 'all': return 'all';
          default: return page === 1 ? 'week' : 'month';
        }
      };
      
      for (const sortMethod of sortMethods) {
        try {
          const timeParam = sortMethod === 'top' ? `&t=${getTimeParam()}` : '';
          const postsData = await redditApiRequest(
            `${REDDIT_API_BASE}/r/${subreddit}/${sortMethod}.json?limit=${Math.ceil(postsPerSubreddit / sortMethods.length)}${timeParam}`
          );
          
          if (postsData?.data?.children) {
            const postsToProcess = postsData.data.children.slice(0, postsPerSubreddit);
            
            // Process posts in parallel with concurrency limit
            const chunkSize = 3; // process 3 posts at a time to avoid rate limits
            for (let i = 0; i < postsToProcess.length; i += chunkSize) {
              const chunk = postsToProcess.slice(i, i + chunkSize);
              const chunkPromises = chunk.map(async (post: any) => {
                if (post.kind === 't3' && post.data?.id) {
                  return fetchCommentsFromPost(post.data.id, subreddit);
                }
                return [];
              });
              
              const commentsArrays = await Promise.all(chunkPromises);
              commentsArrays.flat().forEach(comment => {
                if (!allComments.some(c => c.id === comment.id)) {
                  allComments.push(comment);
                }
              });
              
              // Rate limit delay between chunks
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        } catch (error) {
          console.error(`Error fetching ${sortMethod} posts from r/${subreddit}:`, error);
        }
      }
    });
    
    // Wait for all subreddit requests with a timeout
    const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, timeout));
    await Promise.race([Promise.all(subredditPromises), timeoutPromise]);
    
    // Add direct comment search for better results when we have specific search terms
    if (allComments.length < limit * 2 && searchTerms.length > 0) {
      try {
        const searchQuery = searchTerms.join('+');
        const searchData = await redditApiRequest(
          `${REDDIT_API_BASE}/search.json?q=${encodeURIComponent(searchQuery)}&type=comment&limit=25&sort=relevance&t=${timeFrame}`
        );
        
        if (searchData?.data?.children) {
          searchData.data.children.forEach((item: any) => {
            if (item.kind === 't1' && item.data) {
              // Skip if comment is deleted/removed or we already have it
              if (item.data.body === '[deleted]' || item.data.body === '[removed]') return;
              if (item.data.author === '[deleted]') return;
              if (allComments.some(c => c.id === item.data.id)) return;
              
              const comment: RedditComment = {
                id: item.data.id,
                author: item.data.author || '[deleted]',
                body: item.data.body || '',
                subreddit: item.data.subreddit || '',
                upvotes: item.data.ups || 0,
                timestamp: new Date(item.data.created_utc * 1000).toISOString(),
                permalink: item.data.permalink,
                awards: item.data.total_awards_received || 0
              };
              
              allComments.push(comment);
            }
          });
        }
      } catch (error) {
        console.error('Error with direct comment search:', error);
      }
    }
    
    // Process all comments, apply filters and scoring
    const processedComments = allComments.length > 0 
      ? processCommentsWithSearchTerms(allComments, searchTerms, regexes, filterType, query, sortBy, minUpvotes) 
      : mockComments;
    
    // Cache results
    searchCache.set(cacheKey, processedComments);
    
    // Return the requested number of comments
    return processedComments.slice(0, limit);
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    return mockComments.slice(0, limit);
  }
}

// Enhanced comment processing with advanced filtering and sorting
function processCommentsWithSearchTerms(
  comments: RedditComment[],
  searchTerms: string[],
  regexes: RegExp[],
  filterType: string,
  query: string,
  sortBy: string = 'relevance',
  minUpvotes: number = 0
): RedditComment[] {
  // First apply minimum upvotes filter to all comments
  let filteredComments = comments.filter(comment => comment.upvotes >= minUpvotes);
  
  // Apply specific filtering based on filter type
  if (searchTerms.length === 0 && filterType === 'all') {
    // No search terms, just score based on upvotes
    filteredComments = filteredComments.map(comment => ({ 
      ...comment, 
      score: calculateBaseScore(comment)
    }));
  } else {
    switch (filterType) {
      case 'keyword':
        filteredComments = filteredComments.filter(comment => {
          let matchCount = 0;
          regexes.forEach(re => {
            const matches = comment.body.match(re);
            if (matches) matchCount += matches.length;
          });
          
          if (matchCount > 0) {
            comment.matchScore = matchCount;
            comment.score = calculateScore(comment, matchCount);
            return true;
          }
          return false;
        });
        break;
        
      case 'subreddit':
        filteredComments = filteredComments.filter(comment => 
          comment.subreddit.toLowerCase() === query.toLowerCase()
        ).map(comment => ({
          ...comment,
          score: calculateBaseScore(comment)
        }));
        break;
        
      case 'author':
        filteredComments = filteredComments.filter(comment => 
          comment.author.toLowerCase().includes(query.toLowerCase())
        ).map(comment => ({
          ...comment,
          score: calculateBaseScore(comment)
        }));
        break;
        
      case 'all':
      default:
        filteredComments = filteredComments.filter(comment => {
          if (searchTerms.length === 0) return true;
          
          const commentText = comment.body.toLowerCase();
          const authorText = comment.author.toLowerCase();
          const subredditText = comment.subreddit.toLowerCase();
          
          let matchCount = 0;
          let exactPhraseBonus = 0;
          
          // Check for exact phrase match (big bonus)
          if (query.length > 3 && commentText.includes(query.toLowerCase())) {
            exactPhraseBonus = 10;
          }
          
          // Check for individual term matches
          regexes.forEach(re => {
            const bodyMatches = comment.body.match(re);
            if (bodyMatches) matchCount += bodyMatches.length;
            if (re.test(authorText)) matchCount += 2; // Author match worth more
            if (re.test(subredditText)) matchCount += 3; // Subreddit match worth even more
          });
          
          // Calculate final match score with bonus
          const finalMatchCount = matchCount + exactPhraseBonus;
          
          if (finalMatchCount > 0) {
            comment.matchScore = finalMatchCount;
            comment.score = calculateScore(comment, finalMatchCount);
            return true;
          }
          
          return false;
        });
        break;
    }
  }
  
  // Apply sorting based on sortBy parameter
  switch (sortBy) {
    case 'upvotes':
      filteredComments.sort((a, b) => b.upvotes - a.upvotes);
      break;
    case 'timestamp':
      filteredComments.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      break;
    case 'awards':
      filteredComments.sort((a, b) => (b.awards || 0) - (a.awards || 0));
      break;
    case 'relevance':
    default:
      // Default sorting is by the calculated score which combines relevance and upvotes
      filteredComments.sort((a, b) => (b.score || 0) - (a.score || 0));
      break;
  }
  
  // Remove duplicates
  return filteredComments.filter((c, i, self) => i === self.findIndex(d => d.id === c.id));
}

// Helper functions for scoring
function calculateBaseScore(comment: RedditComment): number {
  const upvoteScore = Math.log10(comment.upvotes + 1) * 2;
  const awardScore = Math.log10((comment.awards || 0) + 1) * 3;
  const recency = calculateRecencyScore(comment.timestamp);
  
  return upvoteScore + awardScore + recency;
}

function calculateScore(comment: RedditComment, matchCount: number): number {
  const baseScore = calculateBaseScore(comment);
  const matchScore = Math.log10(matchCount + 1) * 5;
  
  return baseScore + matchScore;
}

function calculateRecencyScore(timestamp: string): number {
  const commentDate = new Date(timestamp).getTime();
  const now = Date.now();
  const ageInHours = (now - commentDate) / (1000 * 60 * 60);
  
  // Comments in the last 24 hours get a recency bonus
  if (ageInHours < 24) {
    return 5 * (1 - ageInHours / 24);
  }
  return 0;
}

// Enhanced comment component with improved rendering and features
const CommentCard: React.FC<{ 
  comment: RedditComment; 
  query: string;
  onVote: (id: string, direction: 'up' | 'down') => void;
}> = ({ comment, query, onVote }) => {
  const [expanded, setExpanded] = useState(false);
  const commentDate = new Date(comment.timestamp);
  
  // Format relative time
  const getRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.round(diffMs / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHour = Math.round(diffMin / 60);
    const diffDay = Math.round(diffHour / 24);
    
    if (diffSec < 60) return `${diffSec} seconds ago`;
    if (diffMin < 60) return `${diffMin} minutes ago`;
    if (diffHour < 24) return `${diffHour} hours ago`;
    if (diffDay < 30) return `${diffDay} days ago`;
    
    return date.toLocaleDateString();
  };
  
  // Highlight search terms in text
  const highlightSearchTerms = (text: string, query: string): JSX.Element => {
    if (!query.trim()) return <>{text}</>;
    
    const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term.length > 0);
    if (terms.length === 0) return <>{text}</>;
    
    const parts: JSX.Element[] = [];
    let lastIndex = 0;
    
    // Combine terms into a single regex for efficiency
    const combinedRegex = new RegExp(terms.map(escapeRegex).join('|'), 'gi');
    const matches = Array.from(text.matchAll(combinedRegex));
    
    for (const match of matches) {
      const matchIndex = match.index || 0;
      
      if (matchIndex > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, matchIndex)}</span>);
      }
      
      parts.push(
        <span key={`highlight-${matchIndex}`} className="highlight-term">
          {match[0]}
        </span>
      );
      
      lastIndex = matchIndex + match[0].length;
    }
    
    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }
    
    return <>{parts}</>;
  };
  
  // Get sentiment color class
  const getSentimentClass = (): string => {
    switch(comment.sentiment) {
      case 'positive': return 'sentiment-positive';
      case 'negative': return 'sentiment-negative';
      default: return 'sentiment-neutral';
    }
  };
  
  // Format the body text, truncating if needed
  const formatBody = (): JSX.Element => {
    const maxLength = 300;
    const text = comment.body;
    
    if (!expanded && text.length > maxLength) {
      return (
        <>
          {highlightSearchTerms(text.substring(0, maxLength), query)}
          <span className="truncated">...</span>
          <button className="expand-btn" onClick={() => setExpanded(true)}>Read more</button>
        </>
      );
    }
    
    return (
      <>
        {highlightSearchTerms(text, query)}
        {expanded && text.length > maxLength && (
          <button className="expand-btn" onClick={() => setExpanded(false)}>Show less</button>
        )}
      </>
    );
  };
  
  return (
    <div className={`comment-card ${getSentimentClass()}`}>
      <div className="comment-header">
        <div className="author-info">
          <span className="author-name">{comment.author}</span>
          <span className="subreddit-name">r/{comment.subreddit}</span>
          <span className="comment-time">{getRelativeTime(commentDate)}</span>
        </div>
        {comment.awards && comment.awards > 0 && (
          <div className="awards">
            <span className="award-icon">🏆</span>
            <span>{comment.awards}</span>
          </div>
        )}
      </div>
      
      <div className="comment-body">
        {formatBody()}
      </div>
      
      <div className="comment-footer">
        <div className="vote-controls">
          <button 
            className="vote-btn upvote" 
            onClick={() => onVote(comment.id, 'up')}
            aria-label="Upvote"
          >
            ▲
          </button>
          <span className="vote-count">{comment.upvotes}</span>
          <button 
            className="vote-btn downvote" 
            onClick={() => onVote(comment.id, 'down')}
            aria-label="Downvote"
          >
            ▼
          </button>
        </div>
        
        {comment.permalink && (
          <a 
            href={`https://reddit.com${comment.permalink}`} 
            target="_blank" 
            rel="noopener noreferrer"
            className="permalink"
          >
            View on Reddit
          </a>
        )}
      </div>
    </div>
  );
};

// Main Reddit Comment Search Component
const RedditCommentSearch: React.FC = () => {
  const [searchParams, setSearchParams] = useState<SearchParams>({
    query: '',
    filterType: 'all',
    timeFrame: 'week',
    sortBy: 'relevance',
    minUpvotes: 5,
    limit: 20
  });
  
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [searchInputValue, setSearchInputValue] = useState<string>('');
  const [userVotes, setUserVotes] = useState<Record<string, 'up' | 'down' | null>>({});
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    
    if (observerRef.current) observerRef.current.disconnect();
    
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        loadMoreComments();
      }
    });
    
    if (node) observerRef.current.observe(node);
  }, [loading, hasMore]);
  
  // Handle form submission with debounce
  const handleSubmit = useCallback((e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    setPage(1);
    setComments([]);
    setHasMore(true);
    setError(null);
    
    // Update query from input value
    setSearchParams(prev => ({
      ...prev,
      query: searchInputValue.trim()
    }));
    
  }, [searchInputValue]);
  
  // Handle parameter changes
  const handleParamChange = useCallback((param: keyof SearchParams, value: any) => {
    setSearchParams(prev => ({
      ...prev,
      [param]: value
    }));
    
    // Reset results when changing parameters
    setPage(1);
    setComments([]);
    setHasMore(true);
  }, []);
  
  // Load more comments (infinite scroll)
  const loadMoreComments = useCallback(() => {
    setPage(prevPage => prevPage + 1);
  }, []);
  
  // Handle voting on comments
  const handleVote = useCallback((id: string, direction: 'up' | 'down') => {
    setUserVotes(prev => {
      const currentVote = prev[id];
      
      // If same vote direction, remove vote
      if (currentVote === direction) {
        const newVotes = { ...prev };
        delete newVotes[id];
        return newVotes;
      }
      
      // Otherwise set the new vote direction
      return {
        ...prev,
        [id]: direction
      };
    });
    
    // Update local vote count
    setComments(prevComments => 
      prevComments.map(comment => {
        if (comment.id !== id) return comment;
        
        const currentVote = userVotes[id];
        let updatedUpvotes = comment.upvotes;
        
        // Remove previous vote effect if any
        if (currentVote === 'up') updatedUpvotes--;
        if (currentVote === 'down') updatedUpvotes++;
        
        // Add new vote effect
        if (direction === 'up') updatedUpvotes++;
        if (direction === 'down') updatedUpvotes--;
        
        return {
          ...comment,
          upvotes: updatedUpvotes
        };
      })
    );
  }, [userVotes]);
  
  // Fetch comments when search parameters or page changes
  useEffect(() => {
    const fetchComments = async () => {
      if (!searchParams.query && page === 1) {
        // Don't search on first load without a query
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        const results = await searchComments(searchParams, page);
        
        setComments(prevComments => {
          // For page 1, replace comments. For other pages, append
          const newComments = page === 1 ? results : [...prevComments, ...results];
          
          // Filter duplicates
          return newComments.filter((c, i, self) => 
            i === self.findIndex(comment => comment.id === c.id)
          );
        });
        
        // If we get fewer results than the limit, there are no more to load
        setHasMore(results.length >= searchParams.limit);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch comments');
        console.error('Error fetching comments:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchComments();
  }, [searchParams, page]);
  
  // Filter tags component
  const FilterTags: React.FC = () => {
    const filters = [];
    
    if (searchParams.filterType !== 'all') {
      filters.push(`Filter: ${searchParams.filterType}`);
    }
    
    if (searchParams.timeFrame !== 'all') {
      filters.push(`Time: ${searchParams.timeFrame}`);
    }
    
    if (searchParams.sortBy !== 'relevance') {
      filters.push(`Sort: ${searchParams.sortBy}`);
    }
    
    if (searchParams.minUpvotes > 0) {
      filters.push(`Min votes: ${searchParams.minUpvotes}`);
    }
    
    if (filters.length === 0) return null;
    
    return (
      <div className="filter-tags">
        {filters.map(filter => (
          <span key={filter} className="filter-tag">{filter}</span>
        ))}
        <button 
          className="clear-filters" 
          onClick={() => {
            setSearchParams({
              query: searchParams.query,
              filterType: 'all',
              timeFrame: 'week',
              sortBy: 'relevance',
              minUpvotes: 5,
              limit: 20
            });
            setPage(1);
            setComments([]);
          }}
        >
          Reset filters
        </button>
      </div>
    );
  };
  
  return (
    <div className="reddit-comment-search">
      <h1 className="app-title">Reddit Comment Harvester</h1>
      
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-input-container">
          <input
            type="text"
            value={searchInputValue}
            onChange={(e) => setSearchInputValue(e.target.value)}
            placeholder="Search for comments..."
            className="search-input"
          />
          <button type="submit" className="search-button">
            Search
          </button>
        </div>
        
        <div className="search-options">
          <div className="option-group">
            <label htmlFor="filter-type">Filter by:</label>
            <select
              id="filter-type"
              value={searchParams.filterType}
              onChange={(e) => handleParamChange('filterType', e.target.value)}
            >
              <option value="all">All</option>
              <option value="keyword">Keyword</option>
              <option value="subreddit">Subreddit</option>
              <option value="author">Author</option>
            </select>
          </div>
          
          <div className="option-group">
            <label htmlFor="time-frame">Time frame:</label>
            <select
              id="time-frame"
              value={searchParams.timeFrame}
              onChange={(e) => handleParamChange('timeFrame', e.target.value)}
            >
              <option value="hour">Past hour</option>
              <option value="day">Past day</option>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
              <option value="year">Past year</option>
              <option value="all">All time</option>
            </select>
          </div>
          
          <div className="option-group">
            <label htmlFor="sort-by">Sort by:</label>
            <select
              id="sort-by"
              value={searchParams.sortBy}
              onChange={(e) => handleParamChange('sortBy', e.target.value)}
            >
              <option value="relevance">Most relevant</option>
              <option value="upvotes">Most upvoted</option>
              <option value="timestamp">Newest</option>
              <option value="awards">Most awarded</option>
            </select>
          </div>
          
          <div className="option-group">
            <label htmlFor="min-upvotes">Min upvotes:</label>
            <input
              type="number"
              id="min-upvotes"
              min="0"
              step="1"
              value={searchParams.minUpvotes}
              onChange={(e) => handleParamChange('minUpvotes', parseInt(e.target.value) || 0)}
              className="number-input"
            />
          </div>
        </div>
      </form>
      
      <FilterTags />
      
      <div className="results-container">
        {searchParams.query && <h2>Results for "{searchParams.query}"</h2>}
        
        {error && (
          <div className="error-message">
            <p>{error}</p>
            <button onClick={handleSubmit}>Try again</button>
          </div>
        )}
        
        {comments.length > 0 ? (
          <div className="comments-list">
            {comments.map(comment => (
              <CommentCard 
                key={comment.id} 
                comment={comment} 
                query={searchParams.query}
                onVote={handleVote}
              />
            ))}
            
            {hasMore && (
              <div className="loading-indicator" ref={loadingRef}>
                {loading ? 'Loading more comments...' : 'Scroll to load more'}
              </div>
            )}
          </div>
        ) : (
          <div className="no-results">
            {loading ? (
              <div className="loading-spinner">Loading comments...</div>
            ) : searchParams.query ? (
              <p>No comments found for "{searchParams.query}". Try different search terms or filters.</p>
            ) : (
              <p>Enter a search term to find Reddit comments.</p>
            )}
          </div>
        )}
      </div>
      
      <footer className="app-footer">
        <p>© {new Date().getFullYear()} Comment Harvester | Data from Reddit API</p>
        <p className="disclaimer">This app is not affiliated with Reddit Inc.</p>
      </footer>
      
      {/* Add CSS for the components */}
      <style jsx>{`
        .reddit-comment-search {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
        }
        
        .app-title {
          text-align: center;
          margin-bottom: 30px;
          color: #ff4500;
        }
        
        .search-form {
          margin-bottom: 20px;
        }
        
        .search-input-container {
          display: flex;
          margin-bottom: 15px;
        }
        
        .search-input {
          flex: 1;
          padding: 12px 15px;
          font-size: 16px;
          border: 2px solid #ddd;
          border-radius: 4px 0 0 4px;
          transition: border-color 0.3s;
        }
        
        .search-input:focus {
          border-color: #ff4500;
          outline: none;
        }
        
        .search-button {
          padding: 12px 20px;
          background-color: #ff4500;
          color: white;
          border: none;
          border-radius: 0 4px 4px 0;
          cursor: pointer;
          font-size: 16px;
          transition: background-color 0.3s;
        }
        
        .search-button:hover {
          background-color: #ff6a33;
        }
        
        .search-options {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
          margin-bottom: 15px;
        }
        
        .option-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .option-group select,
        .option-group input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .option-group label {
          font-size: 14px;
          font-weight: 500;
        }
        
        .number-input {
          width: 80px;
        }
        
        .filter-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .filter-tag {
          background-color: #f0f0f0;
          padding: 5px 10px;
          border-radius: 15px;
          font-size: 12px;
        }
        
        .clear-filters {
          background: none;
          border: none;
          color: #ff4500;
          font-size: 12px;
          cursor: pointer;
          text-decoration: underline;
        }
        
        .results-container h2 {
          margin-bottom: 20px;
          font-size: 20px;
        }
        
        .comments-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .comment-card {
          background-color: white;
          border-radius: 6px;
          padding: 15px;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .comment-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
        }
        
        .sentiment-positive {
          border-left: 4px solid #4CAF50;
        }
        
        .sentiment-negative {
          border-left: 4px solid #F44336;
        }
        
        .sentiment-neutral {
          border-left: 4px solid #9E9E9E;
        }
        
        .comment-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        
        .author-info {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .author-name {
          font-weight: 600;
          color: #0079d3;
        }
        
        .subreddit-name {
          color: #1a1a1b;
          background-color: #f6f7f8;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 12px;
        }
        
        .comment-time {
          color: #787c7e;
          font-size: 12px;
        }
        
        .awards {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #d7b614;
          font-weight: 500;
        }
        
        .comment-body {
          margin-bottom: 15px;
          line-height: 1.5;
          overflow-wrap: break-word;
          white-space: pre-line;
        }
        
        .highlight-term {
          background-color: #ffeb3b;
          padding: 0 2px;
          border-radius: 2px;
        }
        
        .truncated {
          color: #787c7e;
        }
        
        .expand-btn {
          background: none;
          border: none;
          color: #0079d3;
          font-size: 12px;
          cursor: pointer;
          margin-left: 5px;
        }
        
        .comment-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .vote-controls {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .vote-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          padding: 2px 5px;
          color: #878a8c;
          transition: color 0.2s;
        }
        
        .upvote:hover, .upvote:focus {
          color: #ff4500;
        }
        
        .downvote:hover, .downvote:focus {
          color: #7193ff;
        }
        
        .vote-count {
          font-weight: 600;
          min-width: 20px;
          text-align: center;
        }
        
        .permalink {
          color: #878a8c;
          font-size: 12px;
          text-decoration: none;
          transition: color 0.2s;
        }
        
        .permalink:hover {
          color: #0079d3;
          text-decoration: underline;
        }
        
        .loading-indicator {
          text-align: center;
          padding: 20px;
          color: #878a8c;
        }
        
        .error-message {
          background-color: #ffebee;
          color: #c62828;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .error-message button {
          background-color: #c62828;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .no-results {
          text-align: center;
          padding: 40px 0;
          color: #666;
        }
        
        .loading-spinner {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 30px;
        }
        
        .app-footer {
          margin-top: 40px;
          text-align: center;
          color: #878a8c;
          font-size: 12px;
        }
        
        .disclaimer {
          margin-top: 5px;
        }
        
        @media (max-width: 768px) {
          .search-options {
            flex-direction: column;
            gap: 10px;
          }
          
          .option-group {
            width: 100%;
            justify-content: space-between;
          }
          
          .author-info {
            flex-direction: column;
            align-items: flex-start;
            gap: 5px;
          }
        }
      `}</style>
    </div>
  );
};

export default RedditCommentSearch;
