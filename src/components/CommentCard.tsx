
import React, { useState } from 'react';
import { IconUser, IconSubreddit, IconUpvote, IconDate } from './ui/icons';
import { RedditComment } from '../lib/api';

interface CommentCardProps {
  comment: RedditComment;
  index: number;
}

const CommentCard: React.FC<CommentCardProps> = ({ comment, index }) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Format the timestamp to a readable date
  const formattedDate = new Date(comment.timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  // Format upvotes (e.g., 1.5k)
  const formatUpvotes = (num: number): string => {
    return num >= 1000 ? `${(num / 1000).toFixed(1)}k` : num.toString();
  };

  return (
    <div 
      className={`comment-card card-hover animate-slide-up`}
      style={{ animationDelay: `${index * 0.05}s` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="bg-secondary rounded-full p-1">
            <IconUser className="w-4 h-4 text-primary" strokeWidth={1.5} />
          </div>
          <span className="font-medium text-sm">{comment.author}</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="bg-secondary rounded-full p-1">
            <IconSubreddit className="w-4 h-4 text-primary" strokeWidth={1.5} />
          </div>
          <span className="font-medium text-sm">r/{comment.subreddit}</span>
        </div>
      </div>
      
      <div className="mb-4">
        <p className="text-base leading-relaxed text-card-foreground">{comment.body}</p>
      </div>
      
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className={`flex items-center space-x-1 ${isHovered ? 'text-primary' : ''} transition-apple`}>
          <IconUpvote className={`w-4 h-4 ${isHovered ? 'text-primary' : ''} transition-apple`} strokeWidth={1.5} />
          <span>{formatUpvotes(comment.upvotes)}</span>
        </div>
        <div className="flex items-center space-x-1">
          <IconDate className="w-4 h-4" strokeWidth={1.5} />
          <span>{formattedDate}</span>
        </div>
      </div>
    </div>
  );
};

export default CommentCard;
