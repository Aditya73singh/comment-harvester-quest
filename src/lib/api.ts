import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// Define the RedditComment interface
export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  matchScore?: number; // Score for matching search terms
  score?: number; // Combined score for sorting
}

// Reddit API credentials and endpoints
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || 'xmNNjvzBns1KvnjE5M7WEg';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || 'N39e8RHrhC'strings N39e8RHrhC0XhHnxzUEhwkq5tbrJWw';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

// Store OAuth token
let accessToken: string | null = null;
let tokenExpiration: number = 0;

// Cache system for search results
const searchCache = new Map<string, { timestamp: number; results: RedditComment[] }>();
const CACHE_DURATION = process.env.CACHE_DURATION_MS ? parseInt(process.env.CACHE_DURATION_MS) : 5 * 60 * 1000; // 5 minutes

// Escape regex special characters
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Generate cache key
function getCacheKey(query: string, filterType: string, page: number): string {
  return `${query.toLowerCase()}_${filterType}_${page}`;
}

// Retrieve cached results
async function getFromCache(query: string, filterType: string, page: number): Promise<RedditComment[] | null> {
  const key = getCacheKey(query, filterType, page);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.results;
  }
  return null;
}

// Save to cache
function saveToCache(query: string, filterType: string, page: number, results: RedditComment[]): void {
  const key = getCacheKey(query, filterType, page);
  searchCache.set(key, { timestamp: Date.now(), results });
}

// Base64 encoding utility
function safeBase64Encode(str: string): string {
  return typeof Buffer !== 'undefined' ? Buffer.from(str).toString('base64') : btoa(str);
}

// Get OAuth token
async function getRedditAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiration) return accessToken;
  try {
    const authString = safeBase64Encode(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
    const response = await axios({
      method: 'post',
      url: REDDIT_AUTH_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authString}`,
        'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)',
      },
      data: 'grant_type=client_credentials',
      timeout: 10000,
    });
    accessToken = response.data.access_token;
    tokenExpiration = Date.now() + response.data.expires_in * 1000 - 60000;
    return accessToken;
  } catch (error) {
    console.error('Error getting Reddit access token:', error);
    throw new Error('Failed to authenticate with Reddit API');
  }
}

// Make authenticated Reddit API request
async function redditApiRequest(url: string): Promise<any> {
  try {
    const token = await getRedditAccessToken();
    const response = await axios({
      method: 'get',
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)',
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 429) console.error('Rate limited by Reddit API');
      if (error.response.status === 401) {
        accessToken = null;
        tokenExpiration = 0;
      }
    }
    console.error('Error making Reddit API request:', error);
    throw error;
  }
}

// Fetch comments from a post
async function fetchCommentsFromPost(postId: string, subreddit: string): Promise<RedditComment[]> {
  try {
    const sortMethod = postId.charCodeAt(0) % 3 === 0 ? 'confidence' : postId.charCodeAt(0) % 3 === 1 ? 'top' : 'new';
    const response = await redditApiRequest(
      `${REDDIT_API_BASE}/r/${subreddit}/comments/${postId}.json?limit=100&depth=5&sort=${sortMethod}`
    );
    if (!response || !Array.isArray(response) || response.length < 2) return [];
    return extractComments(response[1].data.children, subreddit);
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error);
    return [];
  }
}

// Extract comments recursively
function extractComments(commentData: any[], subreddit: string): RedditComment[] {
  const comments: RedditComment[] = [];
  function processComments(data: any[]) {
    for (const item of data) {
      if (item.kind === 't1' && item.data) {
        const comment: RedditComment = {
          id: item.data.id,
          author: item.data.author || '[deleted]',
          body: item.data.body || '',
          subreddit,
          upvotes: item.data.ups || 0,
          timestamp: new Date(item.data.created_utc * 1000).toISOString(),
        };
        if (comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]') comments.push(comment);
      }
      if (item.data?.replies?.data?.children) processComments(item.data.replies.data.children);
    }
  }
  processComments(commentData);
  return comments;
}

// Mock comments for fallback
const mockComments: RedditComment[] = [
  { id: 'mock1', author: 'tech_enthusiast', body: 'Modern programming languages like Rust and Go are gaining popularity.', subreddit: 'programming', upvotes: 128, timestamp: new Date().toISOString() },
  { id: 'mock2', author: 'science_lover', body: 'The James Webb Space Telescope has revolutionized our understanding of distant galaxies.', subreddit: 'science', upvotes: 243, timestamp: new Date().toISOString() },
  { id: 'mock3', author: 'design_thinker', body: 'Apple prioritizes simplicity and user experience over feature bloat.', subreddit: 'technology', upvotes: 87, timestamp: new Date().toISOString() },
];

// Search Reddit comments
export async function searchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 20,
  timeout: number = 8000,
  page: number = 1
): Promise<RedditComment[]> {
  try {
    const cachedResults = await getFromCache(query, filterType, page);
    if (cachedResults) return cachedResults.slice(0, limit);

    if (typeof query !== 'string') throw new Error('Query must be a string');
    limit = Math.max(1, Math.min(limit, 100));
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    const regexes = searchTerms.map(term => new RegExp(escapeRegex(term), 'gi'));

    const subreddits = filterType === 'subreddit' && query.trim() ? [query.trim()] : ['all', ...(page === 1 ? ['popular', 'trending'] : [])];
    const postsPerSubreddit = Math.ceil(limit / subreddits.length);
    const allComments: RedditComment[] = [];

    for (const subreddit of subreddits) {
      const sortMethods = subreddit === 'all' ? ['hot', 'top', 'rising', 'new'] : ['hot', 'top'];
      for (const sortMethod of sortMethods) {
        const timeParam = sortMethod === 'top' ? (page === 1 ? '&t=week' : '&t=month') : '';
        const postsData = await redditApiRequest(
          `${REDDIT_API_BASE}/r/${subreddit}/${sortMethod}.json?limit=${Math.ceil(postsPerSubreddit / sortMethods.length)}${timeParam}`
        );
        if (postsData?.data?.children) {
          const postsToProcess = postsData.data.children.slice(0, postsPerSubreddit);
          const commentPromises = postsToProcess.map((post: any) =>
            post.kind === 't3' && post.data?.id ? fetchCommentsFromPost(post.data.id, subreddit) : []
          );
          const commentsArrays = await Promise.all(commentPromises);
          commentsArrays.flat().forEach(comment => allComments.push(comment));
          await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit delay
        }
      }
    }

    if (allComments.length < limit * 2 && searchTerms.length > 0) {
      const searchQuery = searchTerms.join('+');
      const searchData = await redditApiRequest(
        `${REDDIT_API_BASE}/search.json?q=${encodeURIComponent(searchQuery)}&type=comment&limit=25&sort=relevance`
      );
      if (searchData?.data?.children) {
        searchData.data.children.forEach((item: any) => {
          if (item.kind === 't1' && item.data) {
            const comment: RedditComment = {
              id: item.data.id,
              author: item.data.author || '[deleted]',
              body: item.data.body || '',
              subreddit: item.data.subreddit || '',
              upvotes: item.data.ups || 0,
              timestamp: new Date(item.data.created_utc * 1000).toISOString(),
            };
            if (comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]') allComments.push(comment);
          }
        });
      }
    }

    return new Promise(resolve => {
      const timeoutId = setTimeout(() => {
        const processedComments = allComments.length > 0 ? processCommentsWithSearchTerms(allComments, searchTerms, regexes, filterType, query) : mockComments;
        saveToCache(query, filterType, page, processedComments);
        resolve(processedComments.slice(0, limit));
      }, timeout);

      setTimeout(() => {
        clearTimeout(timeoutId);
        const results = allComments.length > 0 ? processCommentsWithSearchTerms(allComments, searchTerms, regexes, filterType, query).slice(0, limit) : mockComments.slice(0, limit);
        resolve(results);
      }, timeout + 5000);
    });
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    return mockComments.slice(0, limit);
  }
}

// Process comments with search terms
function processCommentsWithSearchTerms(
  comments: RedditComment[],
  searchTerms: string[],
  regexes: RegExp[],
  filterType: string,
  query: string
): RedditComment[] {
  let filteredComments = [...comments];
  if (searchTerms.length === 0 && filterType === 'all') {
    filteredComments = filteredComments.map(comment => ({ ...comment, score: comment.upvotes / 100 }));
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
            comment.score = matchCount + comment.upvotes / 100;
            return true;
          }
          return false;
        });
        break;
      case 'subreddit':
        filteredComments = filteredComments.filter(comment => comment.subreddit.toLowerCase() === query.toLowerCase()).map(comment => ({
          ...comment,
          score: comment.upvotes / 100,
        }));
        break;
      case 'author':
        filteredComments = filteredComments.filter(comment => comment.author.toLowerCase().includes(query.toLowerCase())).map(comment => ({
          ...comment,
          score: comment.upvotes / 100,
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
          regexes.forEach(re => {
            const bodyMatches = comment.body.match(re);
            if (bodyMatches) matchCount += bodyMatches.length;
            if (re.test(authorText)) matchCount++;
            if (re.test(subredditText)) matchCount++;
          });
          if (matchCount > 0) {
            comment.matchScore = matchCount;
            comment.score = matchCount + comment.upvotes / 100;
            return true;
          }
          return false;
        });
        break;
    }
  }
  return filteredComments.sort((a, b) => (b.score || 0) - (a.score || 0)).filter((c, i, self) => i === self.findIndex(d => d.id === c.id));
}

// CommentList Component
const CommentList = ({ fetchComments, query, filterType }: { fetchComments: (page: number) => Promise<RedditComment[]>; query: string; filterType: string }) => {
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    setComments([]);
    setPage(1);
    setHasMore(true);
    loadMoreComments();
  }, [query, filterType]);

  const loadMoreComments = async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const newComments = await fetchComments(page);
      if (newComments.length === 0) setHasMore(false);
      else {
        setComments(prev => [...prev, ...newComments.filter(c => !prev.some(p => p.id === c.id))]);
        setPage(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error loading comments:', error);
      setError('Failed to load comments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const highlightSearchTerms = (text: string, query: string): JSX.Element => {
    if (!query.trim()) return <>{text}</>;
    const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term.length > 0);
    if (terms.length === 0) return <>{text}</>;
    const parts = [];
    let lastIndex = 0;
    const combinedRegex = new RegExp(terms.map(escapeRegex).join('|'), 'gi');
    const matches = Array.from(text.matchAll(combinedRegex));
    for (const match of matches) {
      const matchIndex = match.index || 0;
      if (matchIndex > lastIndex) parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, matchIndex)}</span>);
      parts.push(<span key={`highlight-${matchIndex}`} style={{ backgroundColor: '#FFFF00' }}>{match[0]}</span>);
      lastIndex = matchIndex + match[0].length;
    }
    if (lastIndex < text.length) parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    return <>{parts}</>;
  };

  return (
    <div className="comment-list">
      {comments.length === 0 && !loading ? (
        <div>No comments found. Try a different search.</div>
      ) : (
        comments.map(comment => (
          <div key={comment.id} className="comment-card">
            <div className="comment-header">
              <span>u/{comment.author}</span> <span>r/{comment.subreddit}</span> <span>↑ {comment.upvotes}</span>
            </div>
            <div>{highlightSearchTerms(comment.body, query)}</div>
            {comment.matchScore !== undefined && <div>Match score: {comment.matchScore}</div>}
          </div>
        ))
      )}
      {error && <div className="error">{error}</div>}
      <div>
        {hasMore ? (
          <button onClick={loadMoreComments} disabled={loading}>
            {loading ? 'Loading...' : 'Load More'}
          </button>
        ) : (
          <div>No more comments to load.</div>
        )}
      </div>
    </div>
  );
};

// Main App Component
const App = () => {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = useCallback(
    async (currentPage: number) => {
      setIsSearching(true);
      try {
        return await searchComments(query, filterType, 20, 5000, currentPage);
      } catch (error) {
        console.error('Search failed:', error);
        return [];
      } finally {
        setIsSearching(false);
      }
    },
    [query, filterType]
  );

  return (
    <div className="reddit-comment-app">
      <div className="search-container">
        <h1>Reddit Comment Search</h1>
        <p>Search across all of Reddit for matching comments</p>
        <div className="search-controls">
          <input
            type="text"
            placeholder="Search for comments..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && handleSearch(1)}
          />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All Fields</option>
            <option value="keyword">Comment Text</option>
            <option value="subreddit">Subreddit</option>
            <option value="author">Author</option>
          </select>
          <button onClick={() => handleSearch(1)} disabled={isSearching}>
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>
      <div className="results-container">
        <CommentList fetchComments={handleSearch} query={query} filterType={filterType} />
      </div>
    </div>
  );
};

export default App;
