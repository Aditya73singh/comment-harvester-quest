
import React from 'react';
import CommentCard from './CommentCard';
import { RedditComment } from '../lib/api';
import { IconLoader } from './ui/icons';

interface CommentListProps {
  comments: RedditComment[];
  isLoading: boolean;
  error: string | null;
  filterType?: string;
}

const CommentList: React.FC<CommentListProps> = ({ 
  comments, 
  isLoading, 
  error,
  filterType = 'all'
}) => {
  // Empty state - no search performed yet
  if (!isLoading && !error && comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center animate-fade-in">
        <div className="glass p-8 rounded-2xl max-w-md">
          <h3 className="text-xl font-medium mb-2">No comments found</h3>
          <p className="text-muted-foreground">
            Try different search terms or filters. If Reddit API is unavailable, the app will show sample data for common search terms.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center animate-fade-in">
        <div className="glass p-8 rounded-2xl max-w-md border-destructive/20">
          <h3 className="text-xl font-medium mb-2 text-destructive">Error</h3>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm mt-2">Reddit API authentication may be limited. Sample data will be shown instead.</p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 animate-fade-in">
        <IconLoader className="w-8 h-8 text-primary animate-spin-slow" />
        <p className="mt-4 text-muted-foreground">
          {filterType === 'subreddit' 
            ? 'Searching across Reddit subreddits...' 
            : filterType === 'keyword' 
              ? 'Searching by keywords...' 
              : filterType === 'author'
                ? 'Searching by author...'
                : 'Searching comments across Reddit...'}
        </p>
      </div>
    );
  }

  // Results state
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-4 pb-12 max-w-6xl mx-auto">
      {comments.map((comment, index) => (
        <CommentCard key={comment.id} comment={comment} index={index} />
      ))}
    </div>
  );
};

export default CommentList;
