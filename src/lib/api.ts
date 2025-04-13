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

// Save results to cache
function saveToCache(query: string, filterType: string, page: number, results: RedditComment[]): void {
  const key = getCacheKey(query, filterType, page);
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
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Authorization': `Basic ${authString}`,
        'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)'
      },
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
      headers: { 
        'Authorization': `Bearer ${token}`, 
        'User-Agent': 'web:CommentHarvester:v1.0 (by /u/commentharvester)'
      },
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

// Modified function to fetch comments from posts with depth control
async function fetchCommentsFromPost(postId: string, subreddit: string): Promise<RedditComment[]> {
  try {
    // Add depth parameter to get more nested comments and sort by various methods
    // Alternate between different sort methods based on postId to get variety
    const sortMethod = postId.charCodeAt(0) % 3 === 0 ? 'confidence' : 
                      (postId.charCodeAt(0) % 3 === 1 ? 'top' : 'new');
    
    const response = await redditApiRequest(
      `${REDDIT_API_BASE}/r/${subreddit}/comments/${postId}.json?limit=100&depth=5&sort=${sortMethod}`
    );
    
    if (!response || !Array.isArray(response) || response.length < 2) {
      return [];
    }
    
    // Process comment thread
    const commentData = response[1].data.children;
    return extractComments(commentData, subreddit);
  } catch (error) {
    console.error(`Error fetching comments for post ${postId}:`, error);
    return [];
  }
}

// Helper function to extract comments recursively
function extractComments(commentData: any[], subreddit: string): RedditComment[] {
  const comments: RedditComment[] = [];
  
  function processComments(data: any[]) {
    for (const item of data) {
      if (item.kind === 't1' && item.data) {
        const comment: RedditComment = {
          id: item.data.id,
          author: item.data.author || '[deleted]',
          body: item.data.body || '',
          subreddit: subreddit,
          upvotes: item.data.ups || 0,
          timestamp: new Date(item.data.created_utc * 1000).toISOString()
        };
        
        if (comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]') {
          comments.push(comment);
        }
      }
      
      // Process replies recursively
      if (item.data && item.data.replies && item.data.replies.data && item.data.replies.data.children) {
        processComments(item.data.replies.data.children);
      }
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

// Search for Reddit comments based on query and filter type
export async function searchComments(
  query: string,
  filterType: string = 'all',
  limit: number = 20,
  timeout: number = 8000, // Increased timeout for wider search
  page: number = 1
): Promise<RedditComment[]> {
  try {
    const cachedResults = await getFromCache(query, filterType, page);
    if (cachedResults) {
      console.log('Using cached results for', query, filterType, page);
      return cachedResults.slice(0, limit);
    }

    if (typeof query !== 'string') {
      throw new Error('Query must be a string');
    }
    
    limit = Math.max(1, Math.min(limit, 100));
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    const regexes = searchTerms.map(term => new RegExp(escapeRegex(term), 'gi'));

    let subreddits: string[] = [];
    
    // Determine which subreddits to search based on filter type
    if (filterType === 'subreddit' && query.trim()) {
      // If filter type is 'subreddit', use the query as a subreddit name
      subreddits = [query.trim()];
    } else {
      // Use Reddit's /r/all to get results from all subreddits
      subreddits = ['all']; 
      
      // Also search popular and trending subreddits to increase comment variety
      if (page === 1) {
        subreddits.push('popular', 'trending');
      }
    }

    // Calculate offset based on page
    const offset = (page - 1) * limit;
    const postsPerSubreddit = Math.ceil(limit / subreddits.length);
    
    const allComments: RedditComment[] = [];
    const allResponses: any[] = [];
    
    // Fetch posts from each subreddit using different sort methods for variety
    for (let i = 0; i < subreddits.length; i++) {
      const subreddit = subreddits[i];
      try {
        // Use different sorting methods to get more diverse content
        const sortMethods = subreddit === 'all' ? ['hot', 'top', 'rising', 'new'] : ['hot', 'top'];
        
        for (const sortMethod of sortMethods) {
          // Calculate time parameter for "top" posts
          let timeParam = '';
          if (sortMethod === 'top') {
            // For page 1, use day/week, for other pages use month/all to get more variety
            timeParam = page === 1 ? '&t=week' : '&t=month';
          }
          
          // Fetch posts with the current sort method
          const postsData = await redditApiRequest(
            `${REDDIT_API_BASE}/r/${subreddit}/${sortMethod}.json?limit=${Math.ceil(postsPerSubreddit/sortMethods.length)}${timeParam}`
          );
        
        if (postsData && postsData.data && postsData.data.children) {
          allResponses.push(postsData);
          
          // Process each post to fetch its comments
          const postsToProcess = postsData.data.children.slice(0, postsPerSubreddit);
          const postPromises = postsToProcess.map(async (post: any) => {
            if (post.kind === 't3' && post.data && post.data.id) {
              const comments = await fetchCommentsFromPost(post.data.id, subreddit);
              return comments;
            }
            return [];
          });
          
          // Wait for all comment fetching to complete for this subreddit's posts
          const commentsArrays = await Promise.all(postPromises);
          
          // Flatten comments and add to allComments
          commentsArrays.flat().forEach(comment => {
            allComments.push(comment);
          });
          
          // Add delay between requests to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error fetching from r/${subreddit}:`, error);
      }
    }
    
    // If we still don't have enough comments, fetch from Reddit search API
    if (allComments.length < limit * 2 && searchTerms.length > 0) {
      try {
        // Use Reddit's search API to find comments containing the search terms
        const searchQuery = searchTerms.join('+');
        const searchData = await redditApiRequest(
          `${REDDIT_API_BASE}/search.json?q=${encodeURIComponent(searchQuery)}&type=comment&limit=25&sort=relevance`
        );
        
        if (searchData && searchData.data && searchData.data.children) {
          const commentData = searchData.data.children;
          
          // Process comment results from search
          commentData.forEach((item: any) => {
            if (item.kind === 't1' && item.data) {
              const comment: RedditComment = {
                id: item.data.id,
                author: item.data.author || '[deleted]',
                body: item.data.body || '',
                subreddit: item.data.subreddit || '',
                upvotes: item.data.ups || 0,
                timestamp: new Date(item.data.created_utc * 1000).toISOString()
              };
              
              if (comment.body && comment.body !== '[deleted]' && comment.body !== '[removed]') {
                allComments.push(comment);
              }
            }
          });
        }
      } catch (error) {
        console.error('Error using Reddit search API:', error);
      }
    }

    return new Promise((resolve) => {
      // Set timeout to handle long-running processing
      const timeoutId = setTimeout(() => {
        processResults();
      }, timeout);

      // Function to process and filter results
      const processResults = () => {
        try {
          if (allComments.length === 0) {
            console.log('Using mock data as fallback since API returned no comments');
            const filteredMockComments = processCommentsWithSearchTerms(mockComments, searchTerms, regexes, filterType, query);
            saveToCache(query, filterType, page, filteredMockComments);
            resolve(filteredMockComments.slice(0, limit));
            return;
          }

          // Filter and score comments based on search query and filter type
          const processedComments = processCommentsWithSearchTerms(allComments, searchTerms, regexes, filterType, query);
          
          // Save to cache and return results
          saveToCache(query, filterType, page, processedComments);
          resolve(processedComments.slice(0, limit));
        } catch (error) {
          console.error('Error during comment processing:', error);
          resolve(mockComments.slice(0, limit));
        }
      };

      // Safety timeout in case the processing takes too long
      const safetyTimeout = setTimeout(() => {
        clearTimeout(timeoutId);
        console.warn('Safety timeout triggered, returning available results');
        const results = allComments.length > 0 ? 
          processCommentsWithSearchTerms(allComments, searchTerms, regexes, filterType, query).slice(0, limit) : 
          mockComments.slice(0, limit);
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

// Helper function to process comments with search terms
function processCommentsWithSearchTerms(
  comments: RedditComment[],
  searchTerms: string[],
  regexes: RegExp[],
  filterType: string,
  query: string
): RedditComment[] {
  let filteredComments = [...comments];
  
  if (searchTerms.length === 0 && filterType === 'all') {
    // No search terms and no filtering, just score by upvotes
    filteredComments = filteredComments.map(comment => {
      comment.score = comment.upvotes / 100;
      return comment;
    });
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
            comment.score = matchCount + (comment.upvotes / 100);
            return true;
          }
          return false;
        });
        break;
        
      case 'subreddit':
        filteredComments = filteredComments.filter(comment =>
          comment.subreddit.toLowerCase() === query.toLowerCase()
        );
        filteredComments = filteredComments.map(comment => {
          comment.score = comment.upvotes / 100;
          return comment;
        });
        break;
        
      case 'author':
        filteredComments = filteredComments.filter(comment =>
          comment.author.toLowerCase().includes(query.toLowerCase())
        );
        filteredComments = filteredComments.map(comment => {
          comment.score = comment.upvotes / 100;
          return comment;
        });
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
            comment.score = matchCount + (comment.upvotes / 100);
            return true;
          }
          return false;
        });
        break;
    }
  }

  // Sort by score (match score + upvotes)
  filteredComments.sort((a, b) => ((b.score || 0) - (a.score || 0)));
  
  // Remove duplicates based on comment ID
  const uniqueComments = filteredComments.filter((comment, index, self) =>
    index === self.findIndex(c => c.id === comment.id)
  );
  
  return uniqueComments;
}

// CommentList Component with improved rendering and loading
const CommentList = ({ fetchComments }: { fetchComments: (page: number) => Promise<RedditComment[]> }) => {
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    loadMoreComments();
  }, []);

  const loadMoreComments = async () => {
    if (loading || !hasMore) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const newComments = await fetchComments(page);
      
      if (newComments.length === 0) {
        setHasMore(false);
      } else {
        setComments(prev => {
          // Filter out duplicates when adding new comments
          const existingIds = new Set(prev.map(c => c.id));
          const filteredNew = newComments.filter(c => !existingIds.has(c.id));
          return [...prev, ...filteredNew];
        });
        setPage(prev => prev + 1);
      }
    } catch (error) {
      console.error('Error loading comments:', error);
      setError('Failed to load comments. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to highlight search terms in comment text
  const highlightSearchTerms = (text: string, query: string): JSX.Element => {
    if (!query.trim()) return <>{text}</>;
    
    const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term.length > 0);
    if (terms.length === 0) return <>{text}</>;
    
    const parts = [];
    let lastIndex = 0;
    
    // Create a single regex with all terms for better performance
    const combinedRegex = new RegExp(terms.map(term => escapeRegex(term)).join('|'), 'gi');
    const matches = Array.from(text.matchAll(combinedRegex));
    
    for (const match of matches) {
      const matchIndex = match.index || 0;
      
      // Add text before the match
      if (matchIndex > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, matchIndex)}</span>);
      }
      
      // Add the highlighted match
      parts.push(
        <span key={`highlight-${matchIndex}`} className="highlight" style={{ backgroundColor: '#FFFF00' }}>
          {match[0]}
        </span>
      );
      
      lastIndex = matchIndex + match[0].length;
    }
    
    // Add any remaining text
    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex)}</span>);
    }
    
    return <>{parts}</>;
  };

  return (
    <div className="comment-list">
      {comments.length === 0 && !loading ? (
        <div className="no-results">No comments found. Try a different search.</div>
      ) : (
        comments.map(comment => (
          <div key={comment.id} className="comment-card">
            <div className="comment-header">
              <span className="author">u/{comment.author}</span>
              <span className="subreddit">r/{comment.subreddit}</span>
              <span className="upvotes">↑ {comment.upvotes}</span>
            </div>
            <div className="comment-body">
              {highlightSearchTerms(comment.body, '')}
            </div>
            {comment.matchScore !== undefined && (
              <div className="match-score">
                Match score: {comment.matchScore}
              </div>
            )}
          </div>
        ))
      )}
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="load-more-container">
        {hasMore ? (
          <button 
            onClick={loadMoreComments} 
            disabled={loading}
            className="load-more-button"
          >
            {loading ? 'Loading...' : 'Load More Comments'}
          </button>
        ) : (
          <div className="end-message">No more comments to load.</div>
        )}
      </div>
    </div>
  );
};

// Main App Component with improved UI and error handling
const App = () => {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchExecuted, setSearchExecuted] = useState(false);
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [page, setPage] = useState(1);

  // Reset comments and page when search parameters change
  const resetSearch = () => {
    setComments([]);
    setPage(1);
    setSearchExecuted(false);
  };

  useEffect(() => {
    resetSearch();
  }, [query, filterType]);

  const handleSearch = async (currentPage: number) => {
    setIsSearching(true);
    
    try {
      const results = await searchComments(query, filterType, 20, 5000, currentPage);
      setSearchExecuted(true);
      return results;
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    } finally {
      setIsSearching(false);
    }
  };

  const executeSearch = () => {
    resetSearch();
    handleSearch(1);
  };

  return (
    <div className="reddit-comment-app">
      <div className="search-container">
        <h1>Reddit Comment Search</h1>
        <p className="search-description">
          Search across all of Reddit for matching comments
        </p>
        <div className="search-controls">
          <input
            type="text"
            placeholder="Search for comments across all of Reddit..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && executeSearch()}
            className="search-input"
          />
          
          <select 
            value={filterType} 
            onChange={e => setFilterType(e.target.value)}
            className="filter-select"
          >
            <option value="all">All Fields</option>
            <option value="keyword">Comment Text Only</option>
            <option value="subreddit">Specific Subreddit</option>
            <option value="author">By Author</option>
          </select>
          
          <button 
            onClick={executeSearch} 
            disabled={isSearching}
            className="search-button"
          >
            {isSearching ? 'Searching All Reddit...' : 'Search All Reddit'}
          </button>
        </div>
        
        {searchExecuted && filterType === 'subreddit' && (
          <div className="search-info">
            Showing comments from r/{query}
          </div>
        )}
      </div>
      
      <div className="results-container">
        <CommentList fetchComments={handleSearch} />
      </div>
    </div>
  );
};

export default App;
