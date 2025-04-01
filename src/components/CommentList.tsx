
import React, { useState } from 'react';
import CommentCard from './CommentCard';
import { RedditComment } from '../lib/api';
import { IconLoader } from './ui/icons';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/pagination';

interface CommentListProps {
  comments: RedditComment[];
  isLoading: boolean;
  error: string | null;
  filterType?: string;
}

const COMMENTS_PER_PAGE = 10; // Show more comments per page

const CommentList: React.FC<CommentListProps> = ({ 
  comments, 
  isLoading, 
  error,
  filterType = 'all'
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  
  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(comments.length / COMMENTS_PER_PAGE));
  
  // Get current page's comments
  const indexOfLastComment = currentPage * COMMENTS_PER_PAGE;
  const indexOfFirstComment = indexOfLastComment - COMMENTS_PER_PAGE;
  const currentComments = comments.slice(indexOfFirstComment, indexOfLastComment);
  
  // Handle page changes
  const goToPage = (pageNumber: number) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  };

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
    <div className="flex flex-col items-center">
      {comments.length > 0 && (
        <div className="text-sm text-muted-foreground mb-4">
          Showing {indexOfFirstComment + 1}-{Math.min(indexOfLastComment, comments.length)} of {comments.length} comments
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 px-4 pb-8 max-w-6xl mx-auto w-full">
        {currentComments.map((comment, index) => (
          <CommentCard key={comment.id} comment={comment} index={index} />
        ))}
      </div>
      
      {comments.length > COMMENTS_PER_PAGE && (
        <Pagination className="my-6">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious 
                onClick={goToPreviousPage}
                className={currentPage === 1 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} 
              />
            </PaginationItem>
            
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              // Show first page, last page, current page, and pages around current
              const pageToShow = i === 0 
                ? 1 
                : i === 4 
                  ? totalPages 
                  : currentPage - 1 + i;
                  
              // Only show if page is within range
              if (pageToShow <= totalPages && pageToShow > 0) {
                return (
                  <PaginationItem key={pageToShow}>
                    <PaginationLink 
                      isActive={currentPage === pageToShow}
                      onClick={() => goToPage(pageToShow)}
                    >
                      {pageToShow}
                    </PaginationLink>
                  </PaginationItem>
                );
              }
              return null;
            }).filter(Boolean)}
            
            <PaginationItem>
              <PaginationNext 
                onClick={goToNextPage}
                className={currentPage === totalPages ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} 
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};

export default CommentList;
