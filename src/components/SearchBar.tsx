
import React, { useState, useRef, useEffect } from 'react';
import { IconSearch, IconFilter } from './ui/icons';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue 
} from './ui/select';
import { Input } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface SearchBarProps {
  onSearch: (query: string, filterType: string) => void;
  isLoading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ onSearch, isLoading = false }) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoading) {
      onSearch(query.trim(), filterType);
    }
  };

  useEffect(() => {
    // Auto-focus the search input on mount for desktop
    if (inputRef.current && window.innerWidth > 768) {
      inputRef.current.focus();
    }
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto mb-8 px-4">
      <form 
        onSubmit={handleSubmit}
        className="space-y-3"
      >
        <div className={`search-container ${isFocused ? 'ring-2 ring-primary/30 shadow-lg' : 'shadow-md'} rounded-full transition-apple flex`}>
          <div className="relative flex-grow">
            <Input
              ref={inputRef}
              type="text"
              className="search-input text-lg border-0 shadow-none"
              placeholder="Search for comments..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={isLoading}
            />
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger className="px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors border-l border-border">
              <IconFilter className="w-4 h-4 mr-1" />
              <span className="text-sm mr-1 hidden sm:inline">Filter</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Filter by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setFilterType('all')} className={filterType === 'all' ? 'bg-accent' : ''}>
                All
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterType('keyword')} className={filterType === 'keyword' ? 'bg-accent' : ''}>
                Keyword
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterType('subreddit')} className={filterType === 'subreddit' ? 'bg-accent' : ''}>
                Subreddit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFilterType('author')} className={filterType === 'author' ? 'bg-accent' : ''}>
                Author
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button 
            type="submit"
            className="search-icon"
            disabled={isLoading}
          >
            <IconSearch 
              className={`w-5 h-5 ${isLoading ? 'animate-pulse-light' : ''}`} 
              strokeWidth={1.5} 
            />
          </button>
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Filtering by: <span className="font-medium text-foreground">{filterType.charAt(0).toUpperCase() + filterType.slice(1)}</span>
          </div>
          
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Try searching for "design", "technology", or "apple"
            </p>
          </div>
        </div>
      </form>
    </div>
  );
};

export default SearchBar;
