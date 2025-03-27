
import axios from 'axios';

// Mock API for frontend development (replace with real Reddit API integration)
const API_URL = 'https://jsonplaceholder.typicode.com/comments';

export interface RedditComment {
  id: string;
  author: string;
  body: string;
  subreddit: string;
  upvotes: number;
  timestamp: string;
}

export async function searchComments(query: string): Promise<RedditComment[]> {
  // For demo purposes, we'll use jsonplaceholder and transform the data
  try {
    const response = await axios.get(`${API_URL}?postId=1`);
    
    // Transform the data to match our RedditComment interface
    const comments: RedditComment[] = response.data.slice(0, 10).map((comment: any, index: number) => ({
      id: comment.id.toString(),
      author: comment.email.split('@')[0],
      body: comment.body,
      subreddit: ['technology', 'design', 'apple', 'programming', 'minimalism'][Math.floor(Math.random() * 5)],
      upvotes: Math.floor(Math.random() * 1000),
      timestamp: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString()
    }));
    
    // Simple filtering based on query
    return query 
      ? comments.filter(comment => 
          comment.body.toLowerCase().includes(query.toLowerCase()) ||
          comment.author.toLowerCase().includes(query.toLowerCase()) ||
          comment.subreddit.toLowerCase().includes(query.toLowerCase())
        )
      : comments;
  } catch (error) {
    console.error('Error fetching comments:', error);
    throw new Error('Failed to fetch comments');
  }
}
