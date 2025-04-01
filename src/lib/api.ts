import axios from 'axios';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
  matchScore?: number; // Score for matching search terms
}

// Reddit API credentials
const REDDIT_CLIENT_ID = 'xmNNjvzBns1KvnjE5M7WEg';
// We'll use Application-Only OAuth flow which is safer than including the secret in the client
// The secret is not included in the client-side code

// Mock data to use when Reddit API fails
const FALLBACK_COMMENTS: RedditComment[] = [
  {
    id: 'mock1',
    author: 'tech_enthusiast',
    body: 'I think React is a great library for building user interfaces. The component-based architecture makes it easy to reuse code and build complex UIs.',
    subreddit: 'programming',
    upvotes: 42,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock2',
    author: 'code_master',
    body: 'Python is becoming increasingly popular for machine learning and data science. Libraries like TensorFlow and PyTorch have made it much easier to implement complex neural networks.',
    subreddit: 'technology',
    upvotes: 78,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock3',
    author: 'web_developer',
    body: 'CSS Grid and Flexbox have revolutionized web layout. Remember when we had to use float for everything? Those were dark times.',
    subreddit: 'webdev',
    upvotes: 121,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock4',
    author: 'system_architect',
    body: 'Microservices architecture has its place, but not every application needs to be broken down to that level. Sometimes a monolith is the right choice, especially for smaller teams.',
    subreddit: 'programming',
    upvotes: 56,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock5',
    author: 'data_scientist',
    body: 'The field of artificial intelligence is advancing rapidly. Large language models like GPT-4 are demonstrating capabilities that seemed impossible just a few years ago.',
    subreddit: 'technology',
    upvotes: 205,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock6',
    author: 'security_expert',
    body: 'Always implement proper authentication and authorization in your applications. Security should never be an afterthought.',
    subreddit: 'cybersecurity',
    upvotes: 89,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock7',
    author: 'mobile_dev',
    body: 'React Native is a good choice if you want to target both iOS and Android with a single codebase. The performance has improved significantly in recent years.',
    subreddit: 'reactnative',
    upvotes: 34,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock8',
    author: 'ux_designer',
    body: 'Good design isn\'t just about making things look pretty. It\'s about creating interfaces that are intuitive and efficient for users.',
    subreddit: 'design',
    upvotes: 112,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock9',
    author: 'backend_engineer',
    body: 'GraphQL can be a good alternative to REST APIs, especially when clients need to fetch data with complex relationships or when you want to avoid over-fetching.',
    subreddit: 'programming',
    upvotes: 67,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock10',
    author: 'devops_specialist',
    body: 'Containerization with Docker and orchestration with Kubernetes have transformed how we deploy and scale applications. The learning curve is worth it.',
    subreddit: 'devops',
    upvotes: 93,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock11',
    author: 'student_coder',
    body: 'Learning to code can be overwhelming at first. Start with the fundamentals and build up from there. Consistency is key.',
    subreddit: 'learnprogramming',
    upvotes: 45,
    timestamp: new Date().toISOString()
  },
  {
    id: 'mock12',
    author: 'database_admin',
    body: 'NoSQL databases like MongoDB are great for certain use cases, but traditional relational databases still have their place. Choose the right tool for the job.',
    subreddit: 'database',
    upvotes: 72,
    timestamp: new Date().toISOString()
  }
];

// Flag to track API failures
let useRedditAPI = true;
let failureCount = 0;
const MAX_FAILURES = 3;
let accessToken: string | null = null;
let tokenExpiration: number = 0;

// Function to get an OAuth token for Reddit API
async function getRedditAccessToken(): Promise<string> {
  // Check if we have a valid token
  if (accessToken && tokenExpiration > Date.now()) {
    return accessToken;
  }

  try {
    // For application-only OAuth, we use a special endpoint with our client ID
    const response = await axios({
      method: 'post',
      url: 'https://www.reddit.com/api/v1/access_token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'web:reddit-comment-viewer:v1.0 (by /u/lovable-user)'
      },
      auth: {
        username: REDDIT_CLIENT_ID,
        password: '' // Empty password for app-only auth
      },
      data: 'grant_type=client_credentials'
    });

    accessToken = response.data.access_token;
    // Set expiration (typically 1 hour, but we'll use 50 minutes to be safe)
    tokenExpiration = Date.now() + (50 * 60 * 1000);
    return accessToken;
  } catch (error) {
    console.error('Error getting Reddit access token:', error);
    throw new Error('Failed to authenticate with Reddit');
  }
}

export async function searchComments(query: string, filterType: string = 'all'): Promise<RedditComment[]> {
  try {
    // If we've had too many failures, use mock data
    if (!useRedditAPI) {
      console.log('Using mock data due to previous API failures');
      return filterMockComments(query, filterType);
    }
    
    // Parse the query into individual words for multi-word searching
    const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
    
    // Get OAuth token for authenticated requests
    let token;
    try {
      token = await getRedditAccessToken();
    } catch (error) {
      console.error('Authentication failed:', error);
      // Fall back to unauthenticated requests if auth fails
      token = null;
    }
    
    // Starting point - search across all of Reddit
    let subreddits: string[] = [];
    let useDefaultSubreddits = true;
    
    // If searching by subreddit, prioritize the query as a subreddit
    if (filterType === 'subreddit' && query) {
      // For subreddit search, use the query directly as a subreddit name
      subreddits = [query];
      useDefaultSubreddits = false;
    } 
    
    // If we should use defaults or query is empty
    if (useDefaultSubreddits) {
      // Search across all of Reddit
      subreddits = ['all'];
      
      // Include some popular subreddits as fallbacks
      if (filterType !== 'subreddit') {
        subreddits = subreddits.concat([
          'technology', 'programming', 'AskReddit', 'explainlikeimfive', 
          'science', 'todayilearned', 'worldnews'
        ]);
      }
    }
    
    // Make requests to each subreddit with timeout to prevent hanging
    const requests = subreddits.map(subreddit => {
      const headers: Record<string, string> = {
        'User-Agent': 'web:reddit-comment-viewer:v1.0 (by /u/lovable-user)'
      };
      
      // Add authorization header if we have a token
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      return axios.get(`https://www.reddit.com/r/${subreddit}.json?limit=25`, {
        headers,
        timeout: 5000 // 5 second timeout
      });
    });
    
    // Use Promise.allSettled to handle partial failures
    const responses = await Promise.allSettled(requests);
    
    // Check if all promises were rejected
    const allFailed = responses.every(response => response.status === 'rejected');
    if (allFailed) {
      failureCount++;
      if (failureCount >= MAX_FAILURES) {
        useRedditAPI = false;
      }
      throw new Error('All Reddit API requests failed');
    }
    
    // Transform Reddit's API response into our RedditComment format
    const allComments: RedditComment[] = [];
    
    responses.forEach(response => {
      if (response.status === 'fulfilled') {
        const posts = response.value.data.data.children;
        
        posts.forEach((post: any) => {
          // Create a comment directly from the post data
          const commentData: RedditComment = {
            id: post.data.id,
            author: post.data.author || 'unknown',
            body: post.data.selftext || post.data.title,
            subreddit: post.data.subreddit,
            upvotes: post.data.ups,
            timestamp: new Date(post.data.created_utc * 1000).toISOString()
          };
          
          allComments.push(commentData);
        });
      }
    });
    
    // Apply filtering based on the filter type
    let filteredComments = allComments;
    
    if (query) {
      switch (filterType) {
        case 'keyword':
          filteredComments = allComments.filter(comment => {
            const commentText = comment.body.toLowerCase();
            const matchCount = searchTerms.filter(term => commentText.includes(term)).length;
            if (matchCount > 0) {
              comment.matchScore = matchCount;
              return true;
            }
            return false;
          });
          break;
        case 'subreddit':
          filteredComments = allComments.filter(comment => 
            comment.subreddit.toLowerCase() === query.toLowerCase()
          );
          break;
        case 'author':
          filteredComments = allComments.filter(comment => 
            comment.author.toLowerCase().includes(query.toLowerCase())
          );
          break;
        case 'all':
        default:
          filteredComments = allComments.filter(comment => {
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
          break;
      }
    }
    
    // Sort results by match score, putting comments with more matching terms first
    filteredComments.sort((a, b) => {
      const scoreA = a.matchScore || 0;
      const scoreB = b.matchScore || 0;
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      return b.upvotes - a.upvotes;
    });
    
    // Reset failure count on successful request
    failureCount = 0;
    
    return filteredComments;
    
  } catch (error) {
    console.error('Error fetching Reddit data:', error);
    
    // Increment failure count and check if we should switch to mock data
    failureCount++;
    if (failureCount >= MAX_FAILURES) {
      useRedditAPI = false;
      console.log('Switching to mock data after multiple failures');
    }
    
    // Return filtered mock data as fallback
    return filterMockComments(query, filterType);
  }
}

// Function to filter mock comments with the same logic as real comments
function filterMockComments(query: string, filterType: string): RedditComment[] {
  const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(term => term.length > 0);
  let filteredComments = [...FALLBACK_COMMENTS];
  
  if (query) {
    switch (filterType) {
      case 'keyword':
        filteredComments = FALLBACK_COMMENTS.filter(comment => {
          const commentText = comment.body.toLowerCase();
          const matchCount = searchTerms.filter(term => commentText.includes(term)).length;
          if (matchCount > 0) {
            comment.matchScore = matchCount;
            return true;
          }
          return false;
        });
        break;
      case 'subreddit':
        filteredComments = FALLBACK_COMMENTS.filter(comment => 
          comment.subreddit.toLowerCase() === query.toLowerCase()
        );
        break;
      case 'author':
        filteredComments = FALLBACK_COMMENTS.filter(comment => 
          comment.author.toLowerCase().includes(query.toLowerCase())
        );
        break;
      case 'all':
      default:
        filteredComments = FALLBACK_COMMENTS.filter(comment => {
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
        break;
    }
  }
  
  // Sort results by match score and upvotes
  filteredComments.sort((a, b) => {
    const scoreA = a.matchScore || 0;
    const scoreB = b.matchScore || 0;
    
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    
    return b.upvotes - a.upvotes;
  });
  
  return filteredComments;
}
