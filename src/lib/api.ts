import React, { useState, useEffect } from 'react';
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
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || 'N39e8RHrhC0XhHnxzUEhwkq5tbrJWw';
const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_URL = 'https://www.reddit.com/api/v1/access_token';

// Store OAuth token
let accessToken: string | null = null;
let tokenExpiration: number = 0;

// Add a simple cache system for search results
const searchCache = new Map<string, { timestamp: number, results: RedditComment[] }>();
const CACHE_DURATION = process.env.CACHE_DURATION_MS ? parseInt(process.env.CACHE_DURATION_MS) : 5 * 60 * 1000; // 5 minutes

// Helper function to escape regex special characters in user input
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cache key generation
function getCacheKey(query: string, filterType: string): string {
  return `${query.toLowerCase()}_${filterType}`;
}

// Retrieve cached results
async function getFromCache(query: string, filterType: string): Promise<RedditComment[] | null> {
  const key = getCacheKey(query, filterType);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.results;
  }
  return null;
}

// Save results to cache
function saveToCache(query: string, filterType: string, results: RedditComment[]): void {
  const key = getCacheKey(query, filterType);
  searchCache.set(key, { timestamp: Date.now(), results });
}

// Base64 encoding utility
function safeBase64Encode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }
  return btoa(str);
}

// Get OAuth token for Reddit API
async function getRedditAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiration) {
    return accessToken;
  }
  try {
    const authString = safeBase64Encode(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
    const response = await axios({
      method: 'post',
      url: REDDIT_AUTH_URL,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${authString}` },
      data: 'grant_type=client_credentials',
      timeout: 10000,
    });
    accessToken = response.data.access_token;
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 60000;
    console.log('Successfully obtained Reddit access token');
    return accessToken;
  } catch (error) {
    console.error('Error getting Reddit access token:', error);
    throw new Error('Failed to authenticate with Reddit API');
  }
}

// Make an authenticated request to Reddit API
async function redditApiRequest(url: string): Promise<any> {
  try {
    const token = await getRedditAccessToken();
    const response = await axios({
      method: 'get',
      url,
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)' },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 429) {
        console.error('Rate limited by Reddit API, consider adding delay between requests');
      } else if (error.response.status === 401) {
        accessToken = null;
        tokenExpiration = 0;
        console.error('Authentication error, will refresh token on next request');
      }
    }
    console.error('Error making Reddit API request:', error);
    throw error;
  }
}

// Mock comments for fallback
const mockComments: RedditComment[] = [
  { id: 'mock1', author: 'tech_enthusiast', body: 'Modern programming languages like Rust and Go are gaining popularity.', subreddit: 'programming', upvotes: 128, timestamp: new Date().toISOString() },
  { id: 'mock2', author: 'science_lover', body: 'The James Webb Space Telescope has revolutionized our understanding of distant galaxies.', subreddit: 'science', upvotes: 243, timestamp: new Date().toISOString() },
  { id: 'mock3', author: 'design_thinker', body: 'Apple prioritizes simplicity and user experience over feature bloat.', subreddit: 'technology', upvotes: 87, timestamp: new Date().toISOString() },
];

// Search for Reddit comments based on query and filter type
export async function searchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 20,
  timeout: number = 2000
): Promise<RedditComment[]> {
  try {
    const cachedResults = await getFromCache(query, filterType);
    if (cachedResults) {
      return cachedResults.slice(0, limit);
    }

    if (typeof query !== 'string') {
      throw new Error('Query must be a string');
    }
    limit = Math.max(1, Math.min(limit, 100));

    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    const regexes = searchTerms.map(term => new RegExp(escapeRegex(term), 'gi'));

    let subreddits: string[] = [];
    let useDefaultSubreddits = true;

    if (filterType === 'subreddit' && query) {
      subreddits = [query];
      useDefaultSubreddits = false;
    }

    if (useDefaultSubreddits) {
      subreddits = ['technology', 'programming', 'science', 'AskReddit', 'worldnews'];
      if (filterType !== 'subreddit') {
        subreddits.push('all');
      }
    }

    const MAX_CONCURRENT_REQUESTS = 3;
    const chunks = [];
    for (let i = 0; i < subreddits.length; i += MAX_CONCURRENT_REQUESTS) {
      chunks.push(subreddits.slice(i, i + MAX_CONCURRENT_REQUESTS));
    }

    const allComments: RedditComment[] = [];
    const commentRequests: Promise<void>[] = [];

    for (const chunk of chunks) {
      const requests = chunk.map(subreddit =>
        redditApiRequest(`${REDDIT_API_BASE}/r/${subreddit}/hot.json?limit=${Math.min(25, limit)}`)
          .catch(err => {
            console.warn(`Error fetching from r/${subreddit}:`, err);
            return { data: { children: [] } };
          })
      );
      const chunkResponses = await Promise.allSettled(requests);
      allResponses.push(...chunkResponses);

      if (chunks.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(async () => {
        try {
          if (commentRequests.length > 0) {
            await Promise.allSettled(commentRequests.slice(0, 5));
          }

          if (allComments.length === 0) {
            console.log('Using mock data as fallback since API returned no comments');
            let filteredMockComments = [...mockComments];
            if (searchTerms.length > 0) {
              filteredMockComments = mockComments.filter(comment => {
                const commentText = comment.body.toLowerCase();
                const authorText = comment.author.toLowerCase();
                const subredditText = comment.subreddit.toLowerCase();
                let matchCount = 0;
                searchTerms.forEach(term => {
                  if (commentText.includes(term)) matchCount++;
                  if (authorText.includes(term)) matchCount++;
                  if (subredditText.includes(term)) matchCount++;
                });
                if (matchCount > 0) {
                  comment.matchScore = matchCount;
                  return true;
                }
                return false;
              });
            }
            filteredMockComments = filteredMockComments.map(comment => {
              let matchCount = 0;
              regexes.forEach(re => {
                const matches = comment.body.match(re);
                if (matches) {
                  matchCount += matches.length;
                }
              });
              comment.score = matchCount + (comment.upvotes / 100);
              return comment;
            });
            filteredMockComments.sort((a, b) => (b.score || 0) - (a.score || 0));
            saveToCache(query, filterType, filteredMockComments);
            resolve(filteredMockComments.slice(0, limit));
            return;
          }

          let filteredComments = allComments;

          if (query) {
            switch (filterType) {
              case 'keyword':
                filteredComments = allComments.filter(comment => {
                  let matchCount = 0;
                  regexes.forEach(re => {
                    const matches = comment.body.match(re);
                    if (matches) matchCount += matches.length;
                  });
                  if (matchCount > 0) {
                    comment.matchScore = matchCount;
                    comment.score = matchCount + (comment.upvotes / 100);
                    return true;
                  }
                  return false;
                });
                break;
              case 'subreddit':
                filteredComments = allComments.filter(comment =>
                  comment.subreddit.toLowerCase() === query.toLowerCase()
                );
                filteredComments = filteredComments.map(comment => {
                  comment.score = comment.upvotes / 100;
                  return comment;
                });
                break;
              case 'author':
                filteredComments = allComments.filter(comment =>
                  comment.author.toLowerCase().includes(query.toLowerCase())
                );
                filteredComments = filteredComments.map(comment => {
                  comment.score = comment.upvotes / 100;
                  return comment;
                });
                break;
              case 'all':
              default:
                filteredComments = allComments.filter(comment => {
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
                    comment.score = matchCount + (comment.upvotes / 100);
                    return true;
                  }
                  return false;
                });
                break;
            }
          }

          filteredComments.sort((a, b) => ((b.score || 0) - (a.score || 0)));
          saveToCache(query, filterType, filteredComments);
          resolve(filteredComments.slice(0, limit));
        } catch (error) {
          console.error('Error during comment processing:', error);
          resolve(mockComments.slice(0, limit));
        }
      }, timeout);

      const safetyTimeout = setTimeout(() => {
        clearTimeout(timeoutId);
        console.warn('Safety timeout triggered, returning available results');
        const results = allComments.length > 0 ? allComments.slice(0, limit) : mockComments.slice(0, limit);
        resolve(results);
      }, timeout + 5000);
    });
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    const filteredMockComments = mockComments.slice(0, limit);
    filteredMockComments.forEach(comment => {
      comment.score = comment.upvotes / 100;
    });
    return filteredMockComments;
  }
}

// CommentList Component
const CommentList = ({ fetchComments }: { fetchComments: (page: number) => Promise<RedditComment[]> }) => {
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadMoreComments();
  }, []);

  const loadMoreComments = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const newComments = await fetchComments(page);
      setComments(prev => [...prev, ...newComments]);
      setPage(prev => prev + 1);
    } catch (error) {
      console.error('Error loading comments:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {comments.map(comment => (
        <div key={comment.id}>
          <h3>{comment.author}</h3>
          <p>{comment.body}</p>
        </div>
      ))}
      <button onClick={loadMoreComments} disabled={loading}>
        {loading ? 'Loading...' : 'Load More'}
      </button>
    </div>
  );
};

// Main App Component
const App = () => {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');

  const handleSearch = async (page: number) => {
    try {
      const results = await searchComments(query, filterType, 20, 2000, page);
      return results;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Search..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <select value={filterType} onChange={e => setFilterType(e.target.value)}>
        <option value="all">All</option>
        <option value="keyword">Keyword</option>
        <option value="subreddit">Subreddit</option>
        <option value="author">Author</option>
      </select>
      <CommentList fetchComments={handleSearch} />
    </div>
  );
};

export default App;
